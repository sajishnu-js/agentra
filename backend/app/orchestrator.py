"""The message pipeline.

    inbound → contact → conversation → log → embed → retrieve → generate
            → log reply (with sources) → send

Cross-domain by nature: it touches contacts, conversations and knowledge_base,
so it lives above the domains rather than inside one.

It names no channel and no model. It asks a registry for the adapter that
matches the message's channel and a registry for the configured LLM provider.
Adding WhatsAppAdapter or a local model means registering a class, not editing
this file — which is the whole reason the abstractions exist.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

# Registers every ORM model on Base.metadata. Not optional: the RQ worker
# imports this module and nothing else, so without it the `users` table is
# never registered and conversations.assigned_agent_id cannot resolve its
# foreign key at flush time. The API avoids it only by accident, because its
# routers happen to import every model.
import app.models  # noqa: F401
from app.channels.base import ChannelAdapter, InternalMessage
from app.core.config import settings
from app.domains.agents.models import Agent
from app.domains.contacts.models import Channel, Contact
from app.domains.conversations.assignment import auto_assign
from app.domains.conversations.models import (
    Conversation,
    ConversationStatus,
    HandoverReason,
    Message,
    MessageDirection,
    MessageStatus,
)
from app.domains.inboxes.models import Inbox
from app.domains.knowledge_base.models import KBChunk, KBDocument
from app.domains.notifications.service import notify
from app.domains.requests.service import create_from_extraction
from app.handover.policy import (
    HandoverDecision,
    confidence_is_sufficient,
    holding_reply,
    match_keywords,
)
from app.jobs.session import worker_session
from app.llm.base import ContextChunk
from app.llm.registry import get_provider

log = logging.getLogger(__name__)


def get_adapter(channel: Channel) -> ChannelAdapter:
    """The adapter for a channel.

    A plain if/else rather than a plugin system: there will be two or three of
    these, and a registry that reads config would be more machinery than it
    saves.
    """
    if channel is Channel.telegram:
        from app.channels.telegram import TelegramAdapter

        return TelegramAdapter()
    if channel is Channel.whatsapp:
        from app.channels.whatsapp import WhatsAppAdapter

        return WhatsAppAdapter()
    if channel is Channel.instagram:
        from app.channels.instagram import InstagramAdapter

        return InstagramAdapter()
    if channel is Channel.email:
        from app.channels.email import EmailAdapter

        return EmailAdapter()
    raise NotImplementedError(f"No adapter for channel {channel.value!r} yet")


async def _find_or_create_contact(
    session: AsyncSession, message: InternalMessage
) -> Contact:
    """Look the sender up by channel + external id, creating them if new."""
    contact = await session.scalar(
        select(Contact).where(
            Contact.channel == message.channel,
            Contact.external_id == message.external_contact_id,
        )
    )
    if contact is not None:
        # Telegram users can change their display name. Keep it current, but
        # never overwrite a name with nothing.
        if message.sender_name and contact.name != message.sender_name:
            contact.name = message.sender_name
        return contact

    contact = Contact(
        name=message.sender_name or f"{message.channel.value} {message.external_contact_id}",
        channel=message.channel,
        external_id=message.external_contact_id,
        # Telegram does not hand over a phone number, and the language is not
        # known until there is text to judge.
        phone_number=None,
        language=None,
    )
    session.add(contact)
    await session.flush()
    log.info("created contact %s (%s)", contact.name, contact.id)
    return contact


async def _find_or_create_conversation(
    session: AsyncSession, contact: Contact, now: datetime
) -> Conversation:
    """The contact's open thread, or a new one.

    A resolved conversation is not reopened: a customer coming back a week later
    is a new thread, which keeps `resolved` meaning something.
    """
    conversation = await session.scalar(
        select(Conversation)
        .where(
            Conversation.contact_id == contact.id,
            Conversation.status != ConversationStatus.resolved,
        )
        .order_by(Conversation.last_incoming_at.desc().nulls_last())
        .limit(1)
    )
    if conversation is None:
        conversation = Conversation(
            contact_id=contact.id,
            status=ConversationStatus.open,
            last_incoming_at=now,
        )
        session.add(conversation)
        await session.flush()
        log.info("opened conversation %s", conversation.id)
    else:
        conversation.last_incoming_at = now
    return conversation


async def _resolve_agent(session: AsyncSession, contact: Contact) -> Agent | None:
    """The AI agent that should answer this contact, or None.

    Routed through the contact's channel's inbox: `Inbox.default_agent_id` is
    the admin-configured rule, set from the Inboxes page. Ties among several
    inboxes on the same channel break on name, matching the tie-break style
    `assignment.py` already uses for human assignment. No inbox, or an inbox
    with no default agent configured, both mean "no agent yet" — the caller
    falls back to this app's pre-agent-routing defaults, not an error.
    """
    inbox = await session.scalar(
        select(Inbox)
        .where(Inbox.channel == contact.channel)
        .order_by(Inbox.name)
        .limit(1)
    )
    if inbox is None or inbox.default_agent_id is None:
        return None
    return await session.get(Agent, inbox.default_agent_id)


async def retrieve_context(
    session: AsyncSession, question: str, knowledge_base_id: UUID | None
) -> list[ContextChunk]:
    """Top matching knowledge base chunks, above the similarity floor.

    Scoped to `knowledge_base_id` when one is given. With none — no agent
    resolved for this conversation, an agent with no knowledge_base_id set,
    or a test-environment draft with no KB picked — this searches
    everything, the same behaviour as before agents and knowledge bases
    existed. Takes the id directly rather than an Agent so the test-agent
    endpoint (app/domains/agents/router.py) can reuse this exact function
    against a draft config with no persisted Agent row at all.
    """
    # Imported here so that importing the orchestrator does not load the
    # embedding model — the web process imports this module for its typing.
    from app.domains.knowledge_base.embedding import embed_query

    vector = embed_query(question)
    distance = KBChunk.embedding.cosine_distance(vector).label("distance")

    query = (
        select(KBChunk, KBDocument, distance)
        .join(KBDocument, KBDocument.id == KBChunk.kb_document_id)
        .where(KBChunk.embedding.isnot(None))
    )
    if knowledge_base_id is not None:
        query = query.where(KBDocument.knowledge_base_id == knowledge_base_id)
    query = query.order_by(distance).limit(settings.retrieval_top_k)

    rows = await session.execute(query)

    chunks: list[ContextChunk] = []
    for chunk, document, chunk_distance in rows.all():
        similarity = 1.0 - float(chunk_distance)
        # A weak match is worse than no match: it invites a confident answer
        # built on something unrelated.
        if similarity < settings.retrieval_min_similarity:
            continue
        chunks.append(
            ContextChunk(
                chunk_id=str(chunk.id),
                kb_document_id=str(chunk.kb_document_id),
                document_title=document.title,
                content=chunk.content,
                similarity=similarity,
            )
        )
    return chunks


def sources_payload(chunks: list[ContextChunk]) -> list[dict[str, Any]] | None:
    """What goes in messages.kb_chunks_used.

    Same shape the seed writes, so anything reading the audit trail does not
    need to care whether a reply came from a real model or a fixture.
    """
    if not chunks:
        return None
    return [
        {
            "chunk_id": chunk.chunk_id,
            "kb_document_id": chunk.kb_document_id,
            "score": round(chunk.similarity, 4),
        }
        for chunk in chunks
    ]


async def _recent_history(
    session: AsyncSession, conversation_id: UUID, limit: int
) -> list[tuple[str, str]]:
    """The last `limit` messages, oldest first, as (speaker, text).

    Excludes the message being classified — the caller passes that separately.
    Speakers are named in plain words rather than as roles, so the model reads
    it as a transcript rather than as instructions to continue.
    """
    result = await session.execute(
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.created_at.desc())
        .limit(limit)
    )
    messages = list(result.scalars())[::-1]
    return [
        ("customer" if m.direction is MessageDirection.incoming else "business", m.text)
        for m in messages
        if m.text
    ]


async def _extract_request(
    conversation_id: UUID, latest_text: str
) -> dict[str, Any] | None:
    """Classify the turn and store any actionable request.

    A second, separate model call with its own prompt — see
    app/llm/prompts/extraction.py. Runs after the customer has already been
    replied to, so classification latency never delays an answer.

    Takes an id rather than a Conversation, and opens its OWN session, so it is
    completely isolated from the turn. That is not tidiness: rolling back a
    shared session here would expire the caller's already-committed objects,
    and the next attribute access on them would raise MissingGreenlet — turning
    a failed classification into a failed conversation turn, which is exactly
    backwards. A missed request row is a nuisance; a crashed turn makes RQ
    retry a message the customer has already been answered.
    """
    if not settings.request_extraction_enabled:
        return None

    try:
        async with worker_session() as session:
            history = await _recent_history(
                session, conversation_id, settings.extraction_history_messages
            )
            # Drop the message being classified from the tail of the history.
            if history and history[-1][1] == latest_text:
                history = history[:-1]

            provider = get_provider()
            extracted = await provider.extract_request(history, latest_text)
            if extracted is None:
                log.info("no actionable request in message on %s", conversation_id)
                return None

            request, outcome = await create_from_extraction(
                session, conversation_id, extracted
            )
            await session.commit()

            if outcome == "created":
                from app.domains.workflows import engine as workflow_engine

                conversation = await session.get(Conversation, conversation_id)
                contact = (
                    await session.get(Contact, conversation.contact_id)
                    if conversation is not None
                    else None
                )
                await workflow_engine.fire(
                    session,
                    "request_created",
                    event={"category": request.category.value},
                    conversation=conversation,
                    contact=contact,
                    request=request,
                )
                await session.commit()

            log.info(
                "request %s: %s / %s — %r",
                outcome,
                request.category.value,
                request.priority.value,
                request.title,
            )
            return {
                "outcome": outcome,
                "request_id": str(request.id),
                "category": request.category.value,
                "priority": request.priority.value,
                "title": request.title,
            }
    except Exception:
        log.exception("request extraction failed; the conversation turn stands")
        return None


async def process_inbound(message: InternalMessage) -> dict[str, Any]:
    """Handle one inbound message. Returns a summary for the job result."""
    async with worker_session() as session:
        now = datetime.now(UTC)

        contact = await _find_or_create_contact(session, message)
        conversation = await _find_or_create_conversation(session, contact, now)

        # Resolve which AI agent answers this conversation, once. An
        # already-resolved conversation (including one just re-touched by a
        # retried duplicate below) keeps whatever it was first stamped with —
        # see Conversation.agent_id's docstring for why this must not
        # silently drift if an inbox's default agent changes later.
        if conversation.agent_id is None:
            resolved_agent = await _resolve_agent(session, contact)
            if resolved_agent is not None:
                conversation.agent_id = resolved_agent.id
        agent = (
            await session.get(Agent, conversation.agent_id)
            if conversation.agent_id is not None
            else None
        )

        # Idempotency, in two parts, because "already seen" and "already
        # answered" are different questions.
        #
        # The inbound message is committed on its own before any slow work, so
        # that a failing embed or LLM call cannot lose what the customer said.
        # That means a retried job will find its own inbound row. Skipping on
        # that alone would be a bug: a transient Gemini 503 would leave the
        # customer permanently unanswered. So a retry is only a no-op once a
        # reply actually exists.
        existing_inbound = await session.scalar(
            select(Message).where(
                Message.conversation_id == conversation.id,
                Message.external_id == message.external_message_id,
            )
        )

        if existing_inbound is not None:
            already_answered = await session.scalar(
                select(Message.id)
                .where(
                    Message.conversation_id == conversation.id,
                    Message.direction == MessageDirection.outgoing,
                    Message.created_at >= existing_inbound.created_at,
                )
                .limit(1)
            )
            if already_answered is not None:
                await session.commit()
                log.info(
                    "message %s already answered, skipping",
                    message.external_message_id,
                )
                return {
                    "status": "duplicate",
                    "conversation_id": str(conversation.id),
                    "message_id": str(existing_inbound.id),
                }
            log.info(
                "message %s was logged but never answered, retrying the reply",
                message.external_message_id,
            )
        else:
            session.add(
                Message(
                    conversation_id=conversation.id,
                    direction=MessageDirection.incoming,
                    text=message.text,
                    status=MessageStatus.received,
                    external_id=message.external_message_id,
                    kb_chunks_used=None,
                    created_at=now,
                )
            )
            # Redundant with the column's own default for a brand-new
            # conversation, but not for an existing open thread the contact
            # is writing back into — that row's is_unread may have already
            # been cleared by someone opening it, and this new message makes
            # it unread again regardless of who is assigned to it.
            conversation.is_unread = True

        await session.commit()

        # Cheap heuristic, same one the ingestion pipeline uses. Needed before
        # any handover, because a holding reply has to be in the customer's
        # language and on that path there is no model call to work it out.
        from app.domains.knowledge_base.parsing import detect_language

        message_language = detect_language(message.text or "")

        # The contact's language is a rolling preference, updated whenever a
        # message gives a clear signal. The *holding reply* below deliberately
        # uses message_language instead: a bilingual customer who switches to
        # Arabic mid-thread should be answered in Arabic, not in whatever they
        # happened to open with.
        if message_language and contact.language != message_language:
            contact.language = message_language
            await session.commit()

        # ---- Layer 1: hard keyword rules ----------------------------------
        # Deliberately before retrieval and before the model. If a customer is
        # raising something urgent or safety/legal-flavoured, no amount of
        # confidence from an LLM makes it appropriate to answer.
        decision = HandoverDecision.none()
        context_chunks: list[ContextChunk] = []
        reply_text: str | None = None
        reply_model: str | None = None

        keyword_match = (
            match_keywords(message.text or "")
            if settings.keyword_handover_enabled
            else None
        )

        if keyword_match:
            decision = HandoverDecision.from_keywords(keyword_match)
            log.info(
                "keyword handover on message %s (%s) — skipping the model entirely",
                message.external_message_id,
                decision.detail,
            )
        else:
            # ---- Layer 2: the model's own self-assessment -----------------
            context_chunks = await retrieve_context(
                session,
                message.text or "",
                agent.knowledge_base_id if agent else None,
            )
            log.info(
                "retrieved %d chunk(s) above similarity %.2f",
                len(context_chunks),
                settings.retrieval_min_similarity,
            )

            # Only fetched when the agent actually wants memory — the common
            # case (context_history_limit=0, e.g. every conversation before
            # this setting existed) skips the query entirely rather than
            # fetching zero rows for nothing.
            history: list[tuple[str, str]] = []
            if agent and agent.context_history_limit > 0:
                history = await _recent_history(
                    session, conversation.id, agent.context_history_limit + 1
                )
                # The inbound message committed above is already the newest
                # row, so a plain limit-N fetch would include the very
                # message being answered as its own "history" — drop it the
                # same way _extract_request already does.
                if history and history[-1][1] == message.text:
                    history = history[:-1]

            try:
                provider = get_provider()
                draft = await provider.generate_reply(
                    context_chunks,
                    message.text or "",
                    system_prompt=agent.system_prompt if agent else None,
                    model=agent.model if agent else None,
                    temperature=agent.temperature if agent else 0.2,
                    history=history,
                    guardrails=agent.guardrails if agent else None,
                    response_behaviour=agent.response_behaviour if agent else None,
                    max_output_tokens=agent.max_output_tokens if agent else 2048,
                )
            except Exception as error:
                # Quota exhausted, a 503, a bad key, a model that no longer
                # exists — none of those should leave the customer with nothing.
                log.exception("LLM provider failed; handing over to a human")
                decision = HandoverDecision.from_llm_error(
                    f"{type(error).__name__}: {error}"
                )
            else:
                reply_model = draft.model
                if confidence_is_sufficient(
                    draft.confidence, draft.context_sufficient
                ):
                    reply_text = draft.text
                else:
                    # The draft is deliberately NOT sent. It is still worth
                    # logging so a staff member can see what the model would
                    # have said, which is often most of a usable answer.
                    decision = HandoverDecision.from_confidence(
                        draft.confidence, draft.context_sufficient
                    )
                    log.info(
                        "ai_uncertain on message %s (%s) — draft withheld",
                        message.external_message_id,
                        decision.detail,
                    )

        # ---- Send, and record why -----------------------------------------
        if decision.needed:
            # An agent's own fallback_message overrides the app-wide bilingual
            # default when set — NULL/empty means "use the app default", not
            # "send nothing" (see Agent.fallback_message's docstring).
            outbound_text = (
                agent.fallback_message
                if agent and agent.fallback_message
                else holding_reply(message_language or contact.language)
            )
            # Sources are recorded even on a handover: it is the evidence for
            # why the model was unsure.
            sources = sources_payload(context_chunks)
        else:
            outbound_text = reply_text or ""
            sources = sources_payload(context_chunks)

        # get_adapter is inside the try, not above it: it raises for a channel
        # with no credentials configured (*NotConfigured) and for one with no
        # adapter at all (NotImplementedError). Left outside, either of those
        # escaped this whole coroutine — so the reply that was just generated
        # was never written, the conversation kept an inbound message with no
        # response and no handover flag, and RQ retried the job three times,
        # paying for the LLM call again on each attempt. A channel we cannot
        # send on is a delivery failure like any other: record the reply,
        # mark it failed, and let the turn finish.
        try:
            adapter = get_adapter(message.channel)
            sent_id = await adapter.send(message.reply_to, outbound_text)
            send_status = MessageStatus.sent
        except Exception:
            log.exception("failed to send reply on %s", message.channel.value)
            sent_id = None
            send_status = MessageStatus.failed

        session.add(
            Message(
                conversation_id=conversation.id,
                direction=MessageDirection.outgoing,
                text=outbound_text,
                status=send_status,
                external_id=sent_id,
                kb_chunks_used=sources,
                created_at=datetime.now(UTC),
            )
        )

        if decision.needed:
            conversation.status = ConversationStatus.pending
            conversation.handover_reason = decision.reason
            conversation.handover_detail = decision.detail
            conversation.handover_at = datetime.now(UTC)
            # A thread that needs a person should arrive with an owner. The
            # rule itself lives in assignment.py and can be replaced there
            # without touching this path.
            await auto_assign(session, conversation)
            if conversation.assigned_agent_id is not None:
                await notify(
                    session,
                    user_id=conversation.assigned_agent_id,
                    title=f"{contact.name} needs a person",
                    body=decision.detail or "The AI could not confidently handle this one.",
                    link=f"/app/conversations/{conversation.id}",
                )
        else:
            # A confident answer clears any previous handover flag, so a thread
            # does not stay marked forever because of one earlier question.
            conversation.status = ConversationStatus.open
            conversation.handover_reason = None
            conversation.handover_detail = None
            conversation.handover_at = None

        await session.commit()

        # Workflow triggers, after the turn is safely committed: an
        # automation must never be able to fail the conversation it reacts
        # to (engine.fire swallows its own errors for the same reason).
        from app.domains.workflows import engine as workflow_engine

        inbound_message = await session.scalar(
            select(Message)
            .where(
                Message.conversation_id == conversation.id,
                Message.direction == MessageDirection.incoming,
            )
            .order_by(Message.created_at.desc())
            .limit(1)
        )
        await workflow_engine.fire(
            session,
            "message_received",
            event={"channel": message.channel.value},
            conversation=conversation,
            contact=contact,
            message=inbound_message,
        )
        if decision.needed:
            await workflow_engine.fire(
                session,
                "handover_raised",
                conversation=conversation,
                contact=contact,
                message=inbound_message,
            )
        await session.commit()

        # Everything the summary needs, read before extraction runs, so the
        # return value cannot depend on session state that extraction touches.
        conversation_id = conversation.id
        contact_id = contact.id

        return_value = {
            "status": "ok" if send_status is MessageStatus.sent else "send_failed",
            "conversation_id": str(conversation_id),
            "contact_id": str(contact_id),
            "chunks_used": len(context_chunks),
            "handover": decision.reason.value if decision.reason else None,
            "handover_detail": decision.detail,
            "model": reply_model,
        }

    # Outside the turn's session entirely: its own session, its own model call,
    # and its own failure domain.
    return_value["request"] = await _extract_request(
        conversation_id, message.text or ""
    )
    return return_value
