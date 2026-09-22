import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.domains.agents.models import Agent, AgentStatus
from app.domains.agents.schemas import (
    AgentCreate,
    AgentRead,
    AgentTestRequest,
    AgentTestResponse,
    AgentUpdate,
)
from app.domains.audit.service import record_audit
from app.domains.auth.dependencies import require_permission
from app.domains.knowledge_base.models import KnowledgeBase
from app.domains.users.models import User

log = logging.getLogger(__name__)

router = APIRouter(prefix="/agents", tags=["agents"])


async def _assert_knowledge_base_available(
    db: AsyncSession, knowledge_base_id: UUID, *, excluding_agent_id: UUID | None = None
) -> None:
    """The two checks backing the DB's own unique constraint, raised as
    clean 4xxs instead of letting a stale/duplicate id surface as a raw
    IntegrityError — same pattern as knowledge_base/router.py's delete guard."""
    kb = await db.get(KnowledgeBase, knowledge_base_id)
    if kb is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Knowledge base not found")

    query = select(Agent.name).where(Agent.knowledge_base_id == knowledge_base_id)
    if excluding_agent_id is not None:
        query = query.where(Agent.id != excluding_agent_id)
    other_owner = await db.scalar(query.limit(1))
    if other_owner is not None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"{kb.name} is already the dedicated knowledge base for {other_owner}.",
        )


async def _next_copy_name(db: AsyncSession, source_name: str) -> str:
    """Appends (Copy), then (Copy 2), (Copy 3)... — there is no uniqueness
    constraint on Agent.name, but two agents named identically is confusing
    regardless, so a clone always gets a name of its own."""
    candidate = f"{source_name} (Copy)"
    suffix = 2
    while await db.scalar(select(Agent.id).where(Agent.name == candidate).limit(1)):
        candidate = f"{source_name} (Copy {suffix})"
        suffix += 1
    return candidate


@router.get("", response_model=list[AgentRead])
async def list_agents(db: AsyncSession = Depends(get_db)) -> list[Agent]:
    """Open to any signed-in user, not just admins: Inboxes' routing picker
    (open to both roles) needs this list too. "Agents config" being
    admin-only (see the mutating endpoints below) is about editing an
    agent, not knowing agents exist."""
    # `name` is a tie-breaker, not decoration: created_at alone is not unique
    # (agents created in the same batch share a timestamp), and an unbroken
    # tie lets Postgres return them in physical row order — which changes the
    # moment one is updated, so saving an agent would visibly reshuffle the
    # whole grid.
    result = await db.execute(select(Agent).order_by(Agent.created_at, Agent.name))
    return list(result.scalars())


# Declared before /agents/{agent_id}: FastAPI matches GETs in order, and this
# is a different route (no id segment) so there is no actual collision today,
# but keeping literal paths above param paths is the standing convention in
# this codebase (see conversations/router.py's /conversations/tags) and it
# costs nothing to follow it here too.
@router.get("/{agent_id}", response_model=AgentRead)
async def read_agent(agent_id: UUID, db: AsyncSession = Depends(get_db)) -> Agent:
    """Single-agent fetch — the dedicated config page is reached by direct
    URL, not handed an already-fetched row from the list."""
    agent = await db.get(Agent, agent_id)
    if agent is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"No agent with id {agent_id}"
        )
    return agent


@router.post("", response_model=AgentRead, status_code=status.HTTP_201_CREATED)
async def create_agent(
    payload: AgentCreate,
    admin: User = Depends(require_permission("manage_agents")),
    db: AsyncSession = Depends(get_db),
) -> Agent:
    await _assert_knowledge_base_available(db, payload.knowledge_base_id)
    agent = Agent(**payload.model_dump())
    db.add(agent)
    await db.flush()
    await record_audit(
        db,
        actor=admin,
        action="create",
        entity_type="agent",
        entity_id=agent.id,
        summary=f"{admin.name} created agent {agent.name}",
    )
    return agent


@router.post("/{agent_id}/duplicate", response_model=AgentRead, status_code=status.HTTP_201_CREATED)
async def duplicate_agent(
    agent_id: UUID,
    admin: User = Depends(require_permission("manage_agents")),
    db: AsyncSession = Depends(get_db),
) -> Agent:
    """Copy every config field except name (see _next_copy_name), status
    (a clone always starts in draft — never live the moment it's created),
    and knowledge_base_id (left unset: the source keeps its own dedicated
    KB under the uq_agents_knowledge_base_id constraint, so the clone must
    get one assigned explicitly rather than inherit a copy that would
    either violate that constraint or silently break the 1:1 mapping)."""
    source = await db.get(Agent, agent_id)
    if source is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"No agent with id {agent_id}"
        )

    clone = Agent(
        name=await _next_copy_name(db, source.name),
        description=source.description,
        status=AgentStatus.draft,
        model=source.model,
        system_prompt=source.system_prompt,
        temperature=source.temperature,
        knowledge_base_id=None,
        icon=source.icon,
        guardrails=source.guardrails,
        tools_enabled=list(source.tools_enabled),
        response_behaviour=source.response_behaviour,
        fallback_message=source.fallback_message,
        context_history_limit=source.context_history_limit,
        max_output_tokens=source.max_output_tokens,
        owner_user_id=source.owner_user_id,
    )
    db.add(clone)
    await db.flush()
    await record_audit(
        db,
        actor=admin,
        action="create",
        entity_type="agent",
        entity_id=clone.id,
        summary=f"{admin.name} duplicated {source.name} as {clone.name}",
    )
    return clone


@router.post("/test", response_model=AgentTestResponse)
async def test_agent(
    payload: AgentTestRequest,
    _: User = Depends(require_permission("manage_agents")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Run one turn through the real generation pipeline against a draft
    config that may not be saved anywhere — this is what makes "test before
    saving" actually test the edit rather than the last-saved row.

    Reuses orchestrator.retrieve_context/sources_payload directly rather than
    re-implementing retrieval here: a test run must see exactly the pipeline
    a real message would, not a parallel approximation of it. Writes nothing
    to conversations, messages or contacts — a pure dry run, same reasoning
    as the dashboard composer's honest failure handling (it does not
    fabricate a Message row for something that did not happen).
    """
    # Local import: same reasoning as elsewhere in this codebase (e.g.
    # conversations/router.py's send_message) — avoids the orchestrator's
    # heavier import graph (embedding model, KB models) on every request
    # that isn't this one.
    from app.llm.registry import get_provider
    from app.orchestrator import retrieve_context, sources_payload

    config = payload.config
    context_chunks = await retrieve_context(db, payload.message, config.knowledge_base_id)
    history = [(turn.role, turn.text) for turn in payload.history]

    provider = get_provider()
    try:
        draft = await provider.generate_reply(
            context_chunks,
            payload.message,
            system_prompt=config.system_prompt or None,
            model=config.model or None,
            temperature=config.temperature,
            history=history,
            guardrails=config.guardrails or None,
            response_behaviour=config.response_behaviour or None,
            max_output_tokens=config.max_output_tokens,
        )
    except Exception as exc:
        log.warning("test_agent generation failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Could not generate a test reply: {exc}",
        ) from exc

    return {
        "reply": draft.text,
        "confidence": draft.confidence.value,
        "context_sufficient": draft.context_sufficient,
        "model": draft.model,
        "sources": sources_payload(context_chunks),
    }


@router.patch("/{agent_id}", response_model=AgentRead)
async def update_agent(
    agent_id: UUID,
    payload: AgentUpdate,
    admin: User = Depends(require_permission("manage_agents")),
    db: AsyncSession = Depends(get_db),
) -> Agent:
    agent = await db.get(Agent, agent_id)
    if agent is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"No agent with id {agent_id}"
        )
    changes = payload.model_dump(exclude_unset=True)
    if "knowledge_base_id" in changes:
        if changes["knowledge_base_id"] is None:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "An agent must have a knowledge base — reassign it rather than clearing it.",
            )
        if changes["knowledge_base_id"] != agent.knowledge_base_id:
            await _assert_knowledge_base_available(
                db, changes["knowledge_base_id"], excluding_agent_id=agent.id
            )

    for field, value in changes.items():
        setattr(agent, field, value)
    await db.flush()
    if changes:
        await record_audit(
            db,
            actor=admin,
            action="update",
            entity_type="agent",
            entity_id=agent.id,
            summary=f"{admin.name} updated {agent.name} ({', '.join(sorted(changes))})",
            context=changes,
        )
    await db.refresh(agent)
    return agent


@router.delete("/{agent_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_agent(
    agent_id: UUID,
    admin: User = Depends(require_permission("manage_agents")),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete an agent. Safe: Conversation.agent_id and
    Inbox.default_agent_id are both ON DELETE SET NULL, so this cleanly
    unassigns rather than cascading into conversations or inboxes."""
    agent = await db.get(Agent, agent_id)
    if agent is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"No agent with id {agent_id}"
        )
    await record_audit(
        db,
        actor=admin,
        action="delete",
        entity_type="agent",
        entity_id=agent.id,
        summary=f"{admin.name} deleted agent {agent.name}",
    )
    await db.delete(agent)
    await db.flush()
