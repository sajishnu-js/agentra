"""Runs a workflow graph: match triggers, evaluate conditions, do actions.

The whole engine is one pass over a linked list of nodes. `fire` finds the
workflows whose trigger matches an event and starts an execution for each;
`advance` walks from a node to whichever node comes next, recording a step
row per node, until it reaches the end, an error, or a durable pause (a
delay or an approval). Resuming is the same `advance` call with the node the
run stopped at — there is no separate resume path to keep in sync.

Every action here does something real to the database or the outside world.
None of them are placeholders.
"""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domains.agents.models import Agent, AgentStatus
from app.domains.contacts.models import Contact, ContactNote
from app.domains.conversations.models import (
    Conversation,
    ConversationStatus,
    Message,
    MessageDirection,
    MessageStatus,
)
from app.domains.notifications.service import notify
from app.domains.requests.models import Request, RequestCategory, RequestPriority, RequestStatus
from app.domains.users.models import User
from app.domains.workflows.models import (
    StepStatus,
    Workflow,
    WorkflowExecution,
    WorkflowExecutionStep,
    WorkflowExecutionStatus,
    WorkflowStatus,
)

log = logging.getLogger(__name__)

#: A run that revisits this many nodes is looping — a cycle the graph
#: validator warns about but does not forbid (a cycle through a delay node is
#: a legitimate polling pattern). This is the backstop that keeps one from
#: running forever.
MAX_STEPS_PER_ADVANCE = 50

#: How many times a failed run is retried before it is left failed. Applied
#: by the scheduler tick, not inline: an action that failed because an
#: external API was down deserves a later attempt, not an immediate one.
MAX_RETRIES = 3
RETRY_BACKOFF_MINUTES = [1, 5, 15]


# --------------------------------------------------------------------------
# Context
# --------------------------------------------------------------------------


async def build_context(
    db: AsyncSession,
    *,
    conversation: Conversation | None = None,
    contact: Contact | None = None,
    message: Message | None = None,
    request: Request | None = None,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """The flat, JSON-safe snapshot every condition and action reads from.

    Built once when a run starts and stored on the execution, so a run that
    resumes hours later evaluates against what was true when it was
    triggered — not whatever the row looks like now. Actions still act on
    live rows; only the *decisions* are frozen.
    """
    context: dict[str, Any] = {"payload": payload or {}}

    if contact is None and conversation is not None:
        contact = await db.get(Contact, conversation.contact_id)

    if contact is not None:
        context["contact"] = {
            "id": str(contact.id),
            "name": contact.name,
            "channel": contact.channel.value,
            "language": contact.language,
            "external_id": contact.external_id,
        }

    if conversation is not None:
        message_count = await db.scalar(
            select(func.count(Message.id)).where(Message.conversation_id == conversation.id)
        )
        agent = (
            await db.get(Agent, conversation.agent_id)
            if conversation.agent_id is not None
            else None
        )
        context["conversation"] = {
            "id": str(conversation.id),
            "status": conversation.status.value,
            "tags": list(conversation.tags or []),
            "message_count": message_count or 0,
            "is_unread": conversation.is_unread,
            "is_pinned": conversation.is_pinned,
            "assigned": conversation.assigned_agent_id is not None,
            "assigned_agent_id": str(conversation.assigned_agent_id)
            if conversation.assigned_agent_id
            else None,
        }
        if agent is not None:
            context["agent"] = {
                "id": str(agent.id),
                "name": agent.name,
                "status": agent.status.value,
                "model": agent.model,
            }

    if message is not None:
        context["message"] = {
            "id": str(message.id),
            "text": message.text or "",
            "direction": message.direction.value,
        }

    if request is not None:
        context["request"] = {
            "id": str(request.id),
            "title": request.title,
            "category": request.category.value,
            "priority": request.priority.value,
            "status": request.status.value,
        }

    if payload:
        # Exposed as text as well as structure: the condition catalog offers
        # "webhook.body contains X", which is the realistic no-code way to
        # branch on an arbitrary third-party payload without a JSON-path UI.
        context["webhook"] = {"body": json.dumps(payload, default=str)}

    return context


def resolve_path(context: dict[str, Any], path: str) -> Any:
    """`conversation.status` → context["conversation"]["status"], or None."""
    current: Any = context
    for part in path.split("."):
        if not isinstance(current, dict):
            return None
        current = current.get(part)
    return current


# --------------------------------------------------------------------------
# Conditions
# --------------------------------------------------------------------------


def _as_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, list):
        return " ".join(str(item) for item in value)
    return str(value)


def _as_number(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def evaluate_rule(context: dict[str, Any], rule: dict[str, Any]) -> bool:
    """One `field operator value` check.

    Text comparisons are case-insensitive throughout: this is a no-code
    builder for support staff, where "Urgent" and "urgent" meaning different
    things would be a bug report, not a feature.
    """
    actual = resolve_path(context, str(rule.get("field", "")))
    operator = str(rule.get("operator", "equals"))
    expected = rule.get("value", "")

    if operator == "is_empty":
        return not _as_text(actual).strip()
    if operator == "is_not_empty":
        return bool(_as_text(actual).strip())
    if operator == "is_true":
        return actual is True
    if operator == "is_false":
        return actual is False

    if operator in ("greater_than", "less_than"):
        left, right = _as_number(actual), _as_number(expected)
        if left is None or right is None:
            return False
        return left > right if operator == "greater_than" else left < right

    left_text = _as_text(actual).lower()
    right_text = _as_text(expected).lower()
    if operator == "equals":
        return left_text == right_text
    if operator == "not_equals":
        return left_text != right_text
    if operator == "contains":
        return right_text in left_text
    if operator == "not_contains":
        return right_text not in left_text
    if operator == "starts_with":
        return left_text.startswith(right_text)
    return False


def evaluate_condition(context: dict[str, Any], config: dict[str, Any]) -> bool:
    """A condition node's full expression.

    Shape: {"match": "all"|"any", "groups": [{"match": ..., "rules": [...]}]}.
    One level of nesting — groups of rules, combined by the outer match — is
    what makes AND/OR usable in a visual builder without turning into a
    parenthesised expression editor nobody can read. A bare `rules` list with
    no groups is also accepted, which is what a simple single-check node
    produces.
    """
    outer_match = str(config.get("match", "all")).lower()
    groups = config.get("groups")

    if not groups:
        rules = config.get("rules") or []
        if not rules:
            # A condition with nothing configured passes — the node is a
            # pass-through rather than a silent dead end, which is what
            # someone mid-build expects while they wire the shape up first.
            return True
        results = [evaluate_rule(context, rule) for rule in rules]
        return all(results) if outer_match == "all" else any(results)

    group_results: list[bool] = []
    for group in groups:
        rules = group.get("rules") or []
        if not rules:
            group_results.append(True)
            continue
        inner_match = str(group.get("match", "all")).lower()
        results = [evaluate_rule(context, rule) for rule in rules]
        group_results.append(all(results) if inner_match == "all" else any(results))

    return all(group_results) if outer_match == "all" else any(group_results)


# --------------------------------------------------------------------------
# Graph helpers
# --------------------------------------------------------------------------


def _nodes_by_id(graph: dict) -> dict[str, dict]:
    return {node["id"]: node for node in graph.get("nodes", [])}


def next_node_id(graph: dict, node_id: str, branch: str | None = None) -> str | None:
    for edge in graph.get("edges", []):
        if edge.get("source") != node_id:
            continue
        edge_branch = edge.get("branch")
        if branch is None:
            # A non-condition node's single output. An edge that carries a
            # branch label is a leftover from when this node *was* a
            # condition; ignoring it here is what keeps a mid-edit graph from
            # dead-ending.
            if edge_branch in (None, "", "true"):
                return edge.get("target")
        elif edge_branch == branch:
            return edge.get("target")
    return None


def trigger_nodes(graph: dict, trigger_type: str) -> list[dict]:
    return [
        node
        for node in graph.get("nodes", [])
        if node.get("kind") == "trigger" and node.get("type") == trigger_type
    ]


def validate_graph(graph: dict) -> list[dict[str, Any]]:
    """Structural problems, as the builder's Validate button reports them."""
    issues: list[dict[str, Any]] = []
    nodes = graph.get("nodes", [])
    edges = graph.get("edges", [])
    by_id = _nodes_by_id(graph)

    triggers = [node for node in nodes if node.get("kind") == "trigger"]
    if not triggers:
        issues.append({"level": "error", "message": "Add at least one trigger to start this workflow.", "node_id": None})

    actionable = [node for node in nodes if node.get("kind") in ("action", "condition", "delay", "approval")]
    if triggers and not actionable:
        issues.append({"level": "error", "message": "This workflow has a trigger but nothing to do.", "node_id": None})

    # Anything a trigger can't reach will never run — the single most common
    # way a visual graph silently does nothing.
    reachable: set[str] = set()
    frontier = [node["id"] for node in triggers]
    while frontier:
        current = frontier.pop()
        if current in reachable:
            continue
        reachable.add(current)
        for edge in edges:
            if edge.get("source") == current and edge.get("target") in by_id:
                frontier.append(edge["target"])

    for node in nodes:
        if node["id"] not in reachable:
            issues.append({
                "level": "warning",
                "message": "Nothing connects to this node, so it will never run.",
                "node_id": node["id"],
            })

    for node in nodes:
        kind = node.get("kind")
        config = node.get("config") or {}
        if kind == "condition":
            has_rules = bool(config.get("rules")) or any(
                group.get("rules") for group in (config.get("groups") or [])
            )
            if not has_rules:
                issues.append({
                    "level": "warning",
                    "message": "This condition has no checks, so it always takes the true branch.",
                    "node_id": node["id"],
                })
            if not any(e.get("source") == node["id"] for e in edges):
                issues.append({
                    "level": "error",
                    "message": "This condition has no outgoing branches.",
                    "node_id": node["id"],
                })
        elif kind == "action":
            action_type = node.get("type")
            if action_type == "send_message" and not str(config.get("text", "")).strip():
                issues.append({"level": "error", "message": "This message has no text.", "node_id": node["id"]})
            if action_type in ("add_tag", "remove_tag") and not str(config.get("tag", "")).strip():
                issues.append({"level": "error", "message": "This tag action has no tag.", "node_id": node["id"]})
            if action_type == "http_request" and not str(config.get("url", "")).strip():
                issues.append({"level": "error", "message": "This API call has no URL.", "node_id": node["id"]})
            if action_type in ("assign_user", "notify_user") and not config.get("user_id"):
                issues.append({"level": "error", "message": "No person selected.", "node_id": node["id"]})
            if action_type in ("assign_agent", "update_agent_config") and not config.get("agent_id"):
                issues.append({"level": "error", "message": "No agent selected.", "node_id": node["id"]})
        elif kind == "delay":
            if _as_number(config.get("minutes")) in (None, 0):
                issues.append({
                    "level": "warning",
                    "message": "This wait has no duration, so it continues immediately.",
                    "node_id": node["id"],
                })
        elif kind == "approval":
            # An approval forks the same true/false way a condition does (see
            # resume_approval) — a run that reaches one with no matching
            # branch simply ends, which is almost never what was meant.
            branches = {
                e.get("branch") for e in edges if e.get("source") == node["id"]
            }
            if not branches:
                issues.append({
                    "level": "error",
                    "message": "This approval has no outgoing branches.",
                    "node_id": node["id"],
                })
            elif "false" not in branches:
                issues.append({
                    "level": "warning",
                    "message": "Nothing happens if this approval is rejected.",
                    "node_id": node["id"],
                })

    return issues


# --------------------------------------------------------------------------
# Template interpolation
# --------------------------------------------------------------------------


def render(template: str, context: dict[str, Any]) -> str:
    """Substitutes {{ contact.name }} style placeholders.

    Deliberately not a template engine: string replacement over the same
    dotted paths conditions already use. An unknown placeholder is left as
    written rather than blanked, so a typo is visible in the output instead
    of silently producing an empty message.
    """
    if "{{" not in template:
        return template
    result = template
    # Bounded scan rather than a regex over arbitrary user input.
    for _ in range(20):
        start = result.find("{{")
        if start == -1:
            break
        end = result.find("}}", start)
        if end == -1:
            break
        raw = result[start + 2 : end].strip()
        value = resolve_path(context, raw)
        if value is None:
            # Leave it in place, but stop rescanning this one — otherwise the
            # loop finds the same unresolvable placeholder forever.
            placeholder = result[start : end + 2]
            result = result.replace(placeholder, f"[{raw}]", 1)
        else:
            result = result[:start] + _as_text(value) + result[end + 2 :]
    return result


# --------------------------------------------------------------------------
# Actions
# --------------------------------------------------------------------------


class ActionSkipped(Exception):
    """The action could not apply here — not a failure of the workflow.

    A send_message node in a schedule-triggered run has no contact to send
    to; that is a modelling mistake worth showing in the log, but it should
    not mark the whole run failed.
    """


async def _load_conversation(db: AsyncSession, context: dict[str, Any]) -> Conversation:
    conversation_id = resolve_path(context, "conversation.id")
    if not conversation_id:
        raise ActionSkipped("This run has no conversation attached.")
    conversation = await db.get(Conversation, UUID(str(conversation_id)))
    if conversation is None:
        raise ActionSkipped("The conversation this run started from no longer exists.")
    return conversation


async def run_action(
    db: AsyncSession, node: dict, context: dict[str, Any], execution: WorkflowExecution
) -> str:
    """Performs one action and returns a one-line description for the log."""
    action_type = node.get("type", "")
    config = node.get("config") or {}

    if action_type == "send_message":
        conversation = await _load_conversation(db, context)
        contact = await db.get(Contact, conversation.contact_id)
        text = render(str(config.get("text", "")).strip(), context)
        if not text:
            raise ActionSkipped("No message text configured.")
        if contact is None or not contact.external_id:
            raise ActionSkipped("This contact has no channel identity to reply to.")

        from app.orchestrator import get_adapter

        external_id = None
        status = MessageStatus.sent
        try:
            adapter = get_adapter(contact.channel)
            external_id = await adapter.send(reply_to=contact.external_id, text=text)
        except Exception as exc:  # noqa: BLE001 — recorded, see below
            # Unlike the dashboard composer (which refuses to log an
            # undelivered message), a workflow records the attempt as failed:
            # the run's own log is the only place a staff member would ever
            # find out an automation couldn't reach someone.
            status = MessageStatus.failed
            log.warning("workflow send_message failed on %s: %s", conversation.id, exc)

        db.add(
            Message(
                conversation_id=conversation.id,
                direction=MessageDirection.outgoing,
                text=text,
                status=status,
                external_id=external_id,
                is_staff_reply=False,
            )
        )
        await db.flush()
        if status is MessageStatus.failed:
            raise RuntimeError("The channel rejected this message.")
        return f"Sent: {text[:80]}"

    if action_type in ("add_tag", "remove_tag"):
        conversation = await _load_conversation(db, context)
        tag = render(str(config.get("tag", "")).strip().lower(), context)
        if not tag:
            raise ActionSkipped("No tag configured.")
        tags = list(conversation.tags or [])
        if action_type == "add_tag":
            if tag in tags:
                return f"Already tagged {tag}"
            tags.append(tag)
        else:
            if tag not in tags:
                return f"Not tagged {tag}"
            tags.remove(tag)
        conversation.tags = tags
        await db.flush()
        return f"{'Added' if action_type == 'add_tag' else 'Removed'} tag {tag}"

    if action_type == "set_conversation_status":
        conversation = await _load_conversation(db, context)
        raw = str(config.get("status", "open"))
        try:
            new_status = ConversationStatus(raw)
        except ValueError as exc:
            raise ActionSkipped(f"Unknown status {raw!r}") from exc
        conversation.status = new_status
        if new_status is ConversationStatus.resolved:
            # Same rule the conversations router applies: resolving clears
            # the handover flags rather than leaving a closed thread looking
            # like outstanding work.
            conversation.handover_reason = None
            conversation.handover_detail = None
            conversation.handover_at = None
        await db.flush()
        return f"Status → {new_status.value}"

    if action_type == "assign_user":
        conversation = await _load_conversation(db, context)
        user = await db.get(User, UUID(str(config["user_id"]))) if config.get("user_id") else None
        if user is None or not user.is_active:
            raise ActionSkipped("That person can't be assigned conversations.")
        conversation.assigned_agent_id = user.id
        await db.flush()
        return f"Assigned to {user.name}"

    if action_type == "assign_agent":
        conversation = await _load_conversation(db, context)
        agent = await db.get(Agent, UUID(str(config["agent_id"]))) if config.get("agent_id") else None
        if agent is None or agent.status is not AgentStatus.active:
            raise ActionSkipped("That agent isn't active.")
        conversation.agent_id = agent.id
        await db.flush()
        return f"Routed to {agent.name}"

    if action_type == "update_agent_config":
        agent = await db.get(Agent, UUID(str(config["agent_id"]))) if config.get("agent_id") else None
        if agent is None:
            raise ActionSkipped("That agent no longer exists.")
        field = str(config.get("field", ""))
        raw_value = render(str(config.get("value", "")).strip(), context)
        # A closed set, matching catalog.ACTIONS["update_agent_config"] — a
        # workflow must not be able to rewrite an agent's prompt or
        # guardrails, which are exactly the fields a person reviews by hand.
        if field == "status":
            try:
                agent.status = AgentStatus(raw_value)
            except ValueError as exc:
                raise ActionSkipped(f"Unknown agent status {raw_value!r}") from exc
        elif field == "temperature":
            number = _as_number(raw_value)
            if number is None or not 0 <= number <= 2:
                raise ActionSkipped("Temperature must be between 0 and 2.")
            agent.temperature = number
        elif field == "model":
            if not raw_value:
                raise ActionSkipped("No model given.")
            agent.model = raw_value
        elif field == "knowledge_base_id":
            from app.domains.knowledge_base.models import KnowledgeBase

            kb = await db.get(KnowledgeBase, UUID(raw_value)) if raw_value else None
            if kb is None:
                raise ActionSkipped("That knowledge base doesn't exist.")
            # The 1:1 agent<->KB uniqueness constraint would otherwise
            # surface as an IntegrityError that fails the whole run.
            other = await db.scalar(
                select(Agent.name).where(
                    Agent.knowledge_base_id == kb.id, Agent.id != agent.id
                )
            )
            if other is not None:
                raise ActionSkipped(f"{kb.name} is already dedicated to {other}.")
            agent.knowledge_base_id = kb.id
        elif field in ("max_output_tokens", "context_history_limit"):
            number = _as_number(raw_value)
            if number is None or number < 0:
                raise ActionSkipped(f"{field} must be a non-negative number.")
            setattr(agent, field, int(number))
        else:
            raise ActionSkipped(f"{field!r} can't be changed by a workflow.")
        await db.flush()
        return f"{agent.name}: {field} → {raw_value}"

    if action_type == "create_request":
        conversation = await _load_conversation(db, context)
        title = render(str(config.get("title", "")).strip(), context)
        if not title:
            raise ActionSkipped("No request title configured.")
        request = Request(
            conversation_id=conversation.id,
            title=title[:300],
            category=RequestCategory(str(config.get("category", "other"))),
            priority=RequestPriority(str(config.get("priority", "normal"))),
            status=RequestStatus.pending,
        )
        db.add(request)
        await db.flush()
        return f"Raised request: {title[:80]}"

    if action_type == "update_request_status":
        request_id = resolve_path(context, "request.id")
        if not request_id:
            raise ActionSkipped("This run didn't start from a request.")
        request = await db.get(Request, UUID(str(request_id)))
        if request is None:
            raise ActionSkipped("That request no longer exists.")
        new_status = RequestStatus(str(config.get("status", "completed")))
        # completed_at is derived from the transition, exactly as the
        # requests router does it — a workflow must not produce rows the
        # analytics closing-time panel can't measure.
        if new_status is RequestStatus.completed:
            if request.completed_at is None:
                request.completed_at = datetime.now(UTC)
        else:
            request.completed_at = None
        request.status = new_status
        await db.flush()
        return f"Request → {new_status.value}"

    if action_type == "notify_user":
        user = await db.get(User, UUID(str(config["user_id"]))) if config.get("user_id") else None
        if user is None:
            raise ActionSkipped("That person no longer exists.")
        title = render(str(config.get("title", "")).strip(), context) or "Workflow notification"
        body = render(str(config.get("body", "")).strip(), context) or None
        conversation_id = resolve_path(context, "conversation.id")
        await notify(
            db,
            user_id=user.id,
            title=title[:200],
            body=body,
            link=f"/app/conversations/{conversation_id}" if conversation_id else "/app/workflows",
        )
        return f"Notified {user.name}"

    if action_type == "add_contact_note":
        contact_id = resolve_path(context, "contact.id")
        if not contact_id:
            raise ActionSkipped("This run has no contact attached.")
        text = render(str(config.get("text", "")).strip(), context)
        if not text:
            raise ActionSkipped("No note text configured.")
        db.add(
            ContactNote(
                contact_id=UUID(str(contact_id)),
                # No author: a workflow is not a person, and the column is
                # ON DELETE SET NULL precisely so a note can outlive (or
                # never have had) one.
                author_user_id=None,
                text=text[:2000],
            )
        )
        await db.flush()
        return f"Noted: {text[:80]}"

    if action_type == "http_request":
        import httpx

        url = render(str(config.get("url", "")).strip(), context)
        if not url.startswith(("http://", "https://")):
            raise ActionSkipped("The URL must start with http:// or https://")
        method = str(config.get("method", "POST")).upper()
        raw_body = render(str(config.get("body", "")).strip(), context)
        json_body: Any = None
        if raw_body:
            try:
                json_body = json.loads(raw_body)
            except json.JSONDecodeError:
                # Sending it as a plain string field beats failing the run:
                # plenty of endpoints take {"text": "..."} shaped payloads,
                # and a no-code user typing prose into a body box means that.
                json_body = {"text": raw_body}

        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.request(method, url, json=json_body)
        # Raised rather than returned, so a 500 from the far end marks the
        # run failed and becomes eligible for the retry backoff.
        response.raise_for_status()
        return f"{method} {url} → {response.status_code}"

    if action_type == "ai_reply":
        conversation = await _load_conversation(db, context)
        contact = await db.get(Contact, conversation.contact_id)
        if contact is None or not contact.external_id:
            raise ActionSkipped("This contact has no channel identity to reply to.")

        last_incoming = await db.scalar(
            select(Message)
            .where(
                Message.conversation_id == conversation.id,
                Message.direction == MessageDirection.incoming,
            )
            .order_by(Message.created_at.desc())
            .limit(1)
        )
        question = (last_incoming.text if last_incoming else None) or ""
        instruction = render(str(config.get("instruction", "")).strip(), context)
        if instruction:
            question = f"{question}\n\n[Staff instruction: {instruction}]" if question else instruction
        if not question.strip():
            raise ActionSkipped("There's nothing for the agent to answer yet.")

        agent = (
            await db.get(Agent, conversation.agent_id)
            if conversation.agent_id is not None
            else None
        )

        # Same retrieval + generation path the orchestrator uses, so a
        # workflow-authored reply is grounded exactly like an automatic one.
        from app.llm.registry import get_provider
        from app.orchestrator import get_adapter, retrieve_context, sources_payload

        chunks = await retrieve_context(
            db, question, agent.knowledge_base_id if agent else None
        )
        provider = get_provider()
        draft = await provider.generate_reply(
            chunks,
            question,
            system_prompt=agent.system_prompt if agent else None,
            model=agent.model if agent else None,
            temperature=agent.temperature if agent else 0.2,
            guardrails=agent.guardrails if agent else None,
            response_behaviour=agent.response_behaviour if agent else None,
            max_output_tokens=agent.max_output_tokens if agent else 2048,
        )

        external_id = None
        status = MessageStatus.sent
        try:
            adapter = get_adapter(contact.channel)
            external_id = await adapter.send(reply_to=contact.external_id, text=draft.text)
        except Exception as exc:  # noqa: BLE001
            status = MessageStatus.failed
            log.warning("workflow ai_reply send failed on %s: %s", conversation.id, exc)

        db.add(
            Message(
                conversation_id=conversation.id,
                direction=MessageDirection.outgoing,
                text=draft.text,
                status=status,
                external_id=external_id,
                kb_chunks_used=sources_payload(chunks),
            )
        )
        await db.flush()
        if status is MessageStatus.failed:
            raise RuntimeError("The channel rejected the AI's reply.")
        return f"AI replied ({draft.confidence} confidence, {len(chunks)} source(s))"

    raise ActionSkipped(f"Unknown action {action_type!r}")


# --------------------------------------------------------------------------
# Execution
# --------------------------------------------------------------------------


async def _record_step(
    db: AsyncSession,
    execution: WorkflowExecution,
    node: dict,
    status: StepStatus,
    detail: str | None,
    started_at: datetime,
) -> None:
    db.add(
        WorkflowExecutionStep(
            execution_id=execution.id,
            node_id=node["id"],
            node_type=node.get("type") or node.get("kind", ""),
            status=status,
            detail=(detail or "")[:2000] or None,
            started_at=started_at,
            finished_at=datetime.now(UTC),
        )
    )
    await db.flush()


async def advance(
    db: AsyncSession, workflow: Workflow, execution: WorkflowExecution, from_node_id: str
) -> None:
    """Walks the graph from `from_node_id` until the run ends or pauses.

    Mutates `execution` in place and flushes as it goes; the caller owns the
    commit. Never raises for a failing node — a failure is recorded on the
    execution and the run stops, which is what makes the history readable.
    """
    graph = workflow.graph or {}
    by_id = _nodes_by_id(graph)
    context = execution.trigger_context or {}
    current_id: str | None = from_node_id

    for _ in range(MAX_STEPS_PER_ADVANCE):
        if current_id is None:
            execution.status = WorkflowExecutionStatus.success
            execution.current_node_id = None
            execution.finished_at = datetime.now(UTC)
            await db.flush()
            return

        node = by_id.get(current_id)
        if node is None:
            execution.status = WorkflowExecutionStatus.failed
            execution.error = f"Node {current_id} is no longer in this workflow."
            execution.finished_at = datetime.now(UTC)
            await db.flush()
            return

        kind = node.get("kind")
        started_at = datetime.now(UTC)
        execution.current_node_id = current_id

        if kind == "trigger":
            await _record_step(db, execution, node, StepStatus.success, "Triggered", started_at)
            current_id = next_node_id(graph, current_id)
            continue

        if kind == "condition":
            passed = evaluate_condition(context, node.get("config") or {})
            await _record_step(
                db, execution, node, StepStatus.success,
                f"Condition {'passed' if passed else 'failed'} → {'true' if passed else 'false'} branch",
                started_at,
            )
            current_id = next_node_id(graph, current_id, "true" if passed else "false")
            continue

        if kind == "delay":
            minutes = _as_number((node.get("config") or {}).get("minutes")) or 0
            following = next_node_id(graph, current_id)
            if minutes <= 0:
                await _record_step(db, execution, node, StepStatus.skipped, "No delay configured", started_at)
                current_id = following
                continue
            await _record_step(db, execution, node, StepStatus.success, f"Waiting {minutes:g} minute(s)", started_at)
            execution.status = WorkflowExecutionStatus.waiting_delay
            execution.resume_at = datetime.now(UTC) + timedelta(minutes=minutes)
            # The node to run *after* the wait — a resume picks up here, not
            # at the delay node itself, which would re-arm the timer forever.
            execution.current_node_id = following
            await db.flush()
            return

        if kind == "approval":
            config = node.get("config") or {}
            conversation_id = resolve_path(context, "conversation.id")
            if not conversation_id:
                await _record_step(
                    db, execution, node, StepStatus.skipped,
                    "No conversation to raise an approval against — continuing.",
                    started_at,
                )
                current_id = next_node_id(graph, current_id)
                continue
            title = render(str(config.get("title", "")).strip(), context) or "Workflow approval needed"
            request = Request(
                conversation_id=UUID(str(conversation_id)),
                title=title[:300],
                category=RequestCategory.human_request,
                priority=RequestPriority(str(config.get("priority", "normal"))),
                status=RequestStatus.pending,
            )
            db.add(request)
            await db.flush()
            if config.get("user_id"):
                approver = await db.get(User, UUID(str(config["user_id"])))
                if approver is not None:
                    request.assigned_agent_id = approver.id
                    await notify(
                        db,
                        user_id=approver.id,
                        title=title[:200],
                        body="A workflow is waiting on your approval.",
                        link="/app/requests",
                    )
            await _record_step(
                db, execution, node, StepStatus.success,
                f"Waiting for approval: {title[:80]}", started_at,
            )
            execution.status = WorkflowExecutionStatus.waiting_approval
            execution.pending_approval_request_id = request.id
            execution.current_node_id = current_id
            await db.flush()
            return

        if kind == "action":
            try:
                detail = await run_action(db, node, context, execution)
            except ActionSkipped as skipped:
                await _record_step(db, execution, node, StepStatus.skipped, str(skipped), started_at)
                current_id = next_node_id(graph, current_id)
                continue
            except Exception as error:  # noqa: BLE001 — recorded on the run
                log.exception("workflow %s action %s failed", workflow.id, node["id"])
                await _record_step(
                    db, execution, node, StepStatus.failed,
                    f"{type(error).__name__}: {error}", started_at,
                )
                execution.status = WorkflowExecutionStatus.failed
                execution.error = f"{node.get('type')}: {error}"
                execution.finished_at = datetime.now(UTC)
                await db.flush()
                return
            await _record_step(db, execution, node, StepStatus.success, detail, started_at)
            current_id = next_node_id(graph, current_id)
            continue

        await _record_step(db, execution, node, StepStatus.skipped, f"Unknown node kind {kind!r}", started_at)
        current_id = next_node_id(graph, current_id)

    execution.status = WorkflowExecutionStatus.failed
    execution.error = f"Stopped after {MAX_STEPS_PER_ADVANCE} steps — this graph may contain a loop."
    execution.finished_at = datetime.now(UTC)
    await db.flush()


async def start_run(
    db: AsyncSession,
    workflow: Workflow,
    trigger_node: dict,
    context: dict[str, Any],
    *,
    conversation_id: UUID | None = None,
) -> WorkflowExecution:
    execution = WorkflowExecution(
        workflow_id=workflow.id,
        status=WorkflowExecutionStatus.running,
        trigger_type=trigger_node.get("type", "manual"),
        trigger_context=context,
        trigger_node_id=trigger_node["id"],
        current_node_id=trigger_node["id"],
        conversation_id=conversation_id,
    )
    db.add(execution)
    await db.flush()
    await advance(db, workflow, execution, trigger_node["id"])
    return execution


def _trigger_matches(node: dict, event: dict[str, Any]) -> bool:
    """Per-trigger filters from the node's own config (channel, category...).

    "any" and an empty value both mean unfiltered — the builder's defaults.
    """
    config = node.get("config") or {}
    for key, expected in config.items():
        if key in ("interval_minutes",):
            continue
        if expected in (None, "", "any"):
            continue
        actual = event.get(key)
        if actual is None:
            continue
        if _as_text(actual).lower() != _as_text(expected).lower():
            return False
    return True


async def fire(
    db: AsyncSession,
    trigger_type: str,
    *,
    event: dict[str, Any] | None = None,
    conversation: Conversation | None = None,
    contact: Contact | None = None,
    message: Message | None = None,
    request: Request | None = None,
    payload: dict[str, Any] | None = None,
) -> list[WorkflowExecution]:
    """Runs every active workflow whose trigger matches this event.

    Called from the real application paths (orchestrator, conversations
    router, requests router). Never raises: a broken workflow must not take
    down the customer-facing operation that triggered it.
    """
    event = event or {}
    try:
        result = await db.execute(
            select(Workflow).where(Workflow.status == WorkflowStatus.active)
        )
        workflows = list(result.scalars())
    except Exception:
        log.exception("could not load workflows for trigger %s", trigger_type)
        return []

    matching: list[tuple[Workflow, dict]] = []
    for workflow in workflows:
        for node in trigger_nodes(workflow.graph or {}, trigger_type):
            if _trigger_matches(node, event):
                matching.append((workflow, node))
    if not matching:
        return []

    executions: list[WorkflowExecution] = []
    context = await build_context(
        db,
        conversation=conversation,
        contact=contact,
        message=message,
        request=request,
        payload=payload,
    )
    for workflow, node in matching:
        try:
            executions.append(
                await start_run(
                    db, workflow, node, context,
                    conversation_id=conversation.id if conversation else None,
                )
            )
        except Exception:
            log.exception("workflow %s failed to start on %s", workflow.id, trigger_type)
    return executions


async def resume_approval(db: AsyncSession, request: Request) -> None:
    """Continues any run parked on this request's approval node.

    Completed means approved (take the true branch); cancelled means
    rejected (false). A request still pending changes nothing.
    """
    if request.status is RequestStatus.pending:
        return

    result = await db.execute(
        select(WorkflowExecution).where(
            WorkflowExecution.pending_approval_request_id == request.id,
            WorkflowExecution.status == WorkflowExecutionStatus.waiting_approval,
        )
    )
    for execution in result.scalars():
        workflow = await db.get(Workflow, execution.workflow_id)
        if workflow is None or execution.current_node_id is None:
            continue
        approved = request.status is RequestStatus.completed
        following = next_node_id(
            workflow.graph or {}, execution.current_node_id, "true" if approved else "false"
        )
        execution.status = WorkflowExecutionStatus.running
        execution.pending_approval_request_id = None
        await db.flush()
        if following is None:
            execution.status = WorkflowExecutionStatus.success
            execution.current_node_id = None
            execution.finished_at = datetime.now(UTC)
            await db.flush()
        else:
            await advance(db, workflow, execution, following)


async def tick(db: AsyncSession) -> dict[str, int]:
    """One pass of the scheduler: due delays, due schedules, due retries.

    Driven by app.domains.workflows.scheduler's background loop rather than
    a cron dependency — see that module for why.
    """
    now = datetime.now(UTC)
    resumed = scheduled = retried = 0

    due_delays = await db.execute(
        select(WorkflowExecution).where(
            WorkflowExecution.status == WorkflowExecutionStatus.waiting_delay,
            WorkflowExecution.resume_at <= now,
        )
    )
    for execution in due_delays.scalars():
        workflow = await db.get(Workflow, execution.workflow_id)
        if workflow is None or execution.current_node_id is None:
            execution.status = WorkflowExecutionStatus.failed
            execution.error = "The workflow was deleted while this run was waiting."
            execution.finished_at = now
            continue
        execution.status = WorkflowExecutionStatus.running
        execution.resume_at = None
        await advance(db, workflow, execution, execution.current_node_id)
        resumed += 1

    due_schedules = await db.execute(
        select(Workflow).where(
            Workflow.status == WorkflowStatus.active,
            Workflow.schedule_interval_minutes.isnot(None),
            Workflow.schedule_next_run_at <= now,
        )
    )
    for workflow in due_schedules.scalars():
        interval = workflow.schedule_interval_minutes or 60
        workflow.schedule_next_run_at = now + timedelta(minutes=interval)
        for node in trigger_nodes(workflow.graph or {}, "schedule"):
            try:
                await start_run(db, workflow, node, await build_context(db))
                scheduled += 1
            except Exception:
                log.exception("scheduled workflow %s failed to start", workflow.id)

    stalled = await db.execute(
        select(WorkflowExecution).where(
            WorkflowExecution.status == WorkflowExecutionStatus.failed,
            WorkflowExecution.retry_count < MAX_RETRIES,
            WorkflowExecution.resume_at.isnot(None),
            WorkflowExecution.resume_at <= now,
        )
    )
    for execution in stalled.scalars():
        workflow = await db.get(Workflow, execution.workflow_id)
        if workflow is None or execution.current_node_id is None:
            execution.resume_at = None
            continue
        execution.retry_count += 1
        execution.status = WorkflowExecutionStatus.running
        execution.resume_at = None
        execution.error = None
        execution.finished_at = None
        await advance(db, workflow, execution, execution.current_node_id)
        if execution.status is WorkflowExecutionStatus.failed:
            schedule_retry(execution)
        retried += 1

    await db.flush()
    return {"resumed": resumed, "scheduled": scheduled, "retried": retried}


def schedule_retry(execution: WorkflowExecution) -> None:
    """Arms the next retry attempt, if there is one left."""
    if execution.retry_count >= MAX_RETRIES:
        execution.resume_at = None
        return
    minutes = RETRY_BACKOFF_MINUTES[min(execution.retry_count, len(RETRY_BACKOFF_MINUTES) - 1)]
    execution.resume_at = datetime.now(UTC) + timedelta(minutes=minutes)
