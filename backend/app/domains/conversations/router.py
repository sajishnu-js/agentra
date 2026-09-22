import logging
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased, selectinload

from app.core.database import get_db
from app.core.storage import (
    UploadTooLarge,
    delete_upload,
    path_from_url,
    public_url,
    save_upload,
)
from app.domains.agents.models import Agent, AgentStatus
from app.domains.audit.service import record_audit
from app.domains.auth.dependencies import get_current_user
from app.domains.contacts.models import Channel, Contact
from app.domains.conversations.models import (
    Conversation,
    ConversationStatus,
    Message,
    MessageDirection,
    MessageStatus,
)
from app.domains.conversations.schemas import (
    ConversationCreate,
    ConversationDetail,
    ConversationListItem,
    ConversationUpdate,
    MessageCreate,
    MessageRead,
    MessageUpdate,
)
from app.domains.requests.models import Request
from app.domains.users.models import User

log = logging.getLogger(__name__)

router = APIRouter(tags=["conversations"])


def _message_count_subquery():
    return (
        select(func.count(Message.id))
        .where(Message.conversation_id == Conversation.id)
        .scalar_subquery()
    )


@router.get("/conversations", response_model=list[ConversationListItem])
async def list_conversations(
    conversation_status: ConversationStatus | None = Query(default=None, alias="status"),
    tag: str | None = Query(default=None),
    assigned_to: UUID | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    # DISTINCT ON is the cheap way to get the newest message per conversation
    # in one pass; the alternative is a window function or N+1 queries.
    latest = (
        select(Message)
        .distinct(Message.conversation_id)
        .order_by(Message.conversation_id, Message.created_at.desc())
        .subquery()
    )
    latest_message = aliased(Message, latest)
    assignee_user = aliased(User)
    ai_agent = aliased(Agent)

    stmt = (
        select(
            Conversation,
            latest_message,
            assignee_user,
            ai_agent,
            _message_count_subquery().label("message_count"),
        )
        .options(selectinload(Conversation.contact))
        .outerjoin(latest_message, latest_message.conversation_id == Conversation.id)
        .outerjoin(assignee_user, assignee_user.id == Conversation.assigned_agent_id)
        .outerjoin(ai_agent, ai_agent.id == Conversation.agent_id)
        # Pinned first, without disturbing the recency order within either
        # group — True sorts before False under desc(), so this is a second
        # sort key applied ahead of the existing one rather than a rewrite.
        .order_by(
            Conversation.is_pinned.desc(),
            Conversation.last_incoming_at.desc().nulls_last(),
        )
    )

    if conversation_status is not None:
        stmt = stmt.where(Conversation.status == conversation_status)
    if tag is not None:
        # `contains` renders the array containment operator @>, which the GIN
        # index on tags can serve.
        stmt = stmt.where(Conversation.tags.contains([tag]))
    if assigned_to is not None:
        stmt = stmt.where(Conversation.assigned_agent_id == assigned_to)

    result = await db.execute(stmt)

    return [
        {
            "id": conversation.id,
            "status": conversation.status,
            "assigned_agent_id": conversation.assigned_agent_id,
            "last_incoming_at": conversation.last_incoming_at,
            "created_at": conversation.created_at,
            "handover_reason": conversation.handover_reason,
            "handover_detail": conversation.handover_detail,
            "handover_at": conversation.handover_at,
            "tags": conversation.tags or [],
            "is_unread": conversation.is_unread,
            "is_pinned": conversation.is_pinned,
            "contact": conversation.contact,
            "assigned_agent": assignee,
            "agent": ai_agent_row,
            "last_message": message,
            "message_count": count,
        }
        for conversation, message, assignee, ai_agent_row, count in result.all()
    ]


@router.post(
    "/conversations", response_model=ConversationDetail, status_code=status.HTTP_201_CREATED
)
async def create_conversation(
    payload: ConversationCreate,
    actor: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Start a conversation from the dashboard rather than an inbound message
    — logging a phone call, opening a thread with someone who has not
    messaged in yet, etc."""
    if payload.contact_id is not None:
        contact = await db.get(Contact, payload.contact_id)
        if contact is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Contact not found")
    else:
        if not payload.contact_name or payload.channel is None:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Provide an existing contact_id, or a contact_name and channel to create one.",
            )
        contact = Contact(
            name=payload.contact_name,
            channel=payload.channel,
            external_id=payload.external_id,
        )
        db.add(contact)
        await db.flush()

    if payload.assigned_agent_id is not None:
        assignee = await db.get(User, payload.assigned_agent_id)
        if assignee is None or not assignee.is_active:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "That user cannot be assigned conversations"
            )

    if payload.agent_id is not None:
        ai_agent = await db.get(Agent, payload.agent_id)
        if ai_agent is None or ai_agent.status != AgentStatus.active:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "That agent cannot be assigned to a conversation"
            )

    conversation = Conversation(
        contact_id=contact.id,
        status=ConversationStatus.open,
        assigned_agent_id=payload.assigned_agent_id,
        agent_id=payload.agent_id,
    )
    db.add(conversation)
    await db.flush()
    await record_audit(
        db,
        actor=actor,
        action="create",
        entity_type="conversation",
        entity_id=conversation.id,
        summary=f"{actor.name} started a new conversation with {contact.name}",
    )

    from app.domains.workflows import engine as workflow_engine

    await workflow_engine.fire(
        db,
        "conversation_created",
        event={"channel": contact.channel.value},
        conversation=conversation,
        contact=contact,
    )
    return await read_conversation(conversation.id, db)


# Declared before /conversations/{conversation_id}: FastAPI matches in order,
# and "tags" would otherwise be parsed as a conversation UUID and 422.
@router.get("/conversations/tags", response_model=list[str])
async def list_tags(db: AsyncSession = Depends(get_db)) -> list[str]:
    """Every tag in use, for the filter control.

    unnest + distinct rather than a tags table — the set is small and this
    keeps tags from needing their own lifecycle.
    """
    result = await db.execute(
        select(func.distinct(func.unnest(Conversation.tags))).order_by(None)
    )
    return sorted(tag for tag in result.scalars() if tag)


async def _conversation_detail(
    db: AsyncSession, conversation: Conversation, message_count: int
) -> dict:
    """Build the response dict from an already-loaded conversation, with no
    side effects — the one thing both the real GET endpoint (which also
    marks the thread read) and an internal caller like update_conversation
    (whose own explicit is_unread change must not be clobbered by that same
    marking) can both build their response from."""
    assignee = None
    if conversation.assigned_agent_id is not None:
        assignee = await db.get(User, conversation.assigned_agent_id)

    ai_agent = None
    if conversation.agent_id is not None:
        ai_agent = await db.get(Agent, conversation.agent_id)

    requests = await db.execute(
        select(Request)
        .where(Request.conversation_id == conversation.id)
        .order_by(Request.created_at.desc())
    )

    return {
        "id": conversation.id,
        "status": conversation.status,
        "last_incoming_at": conversation.last_incoming_at,
        "created_at": conversation.created_at,
        "handover_reason": conversation.handover_reason,
        "handover_detail": conversation.handover_detail,
        "handover_at": conversation.handover_at,
        "tags": conversation.tags or [],
        "is_unread": conversation.is_unread,
        "is_pinned": conversation.is_pinned,
        "contact": conversation.contact,
        "assigned_agent": assignee,
        "agent": ai_agent,
        "requests": list(requests.scalars()),
        "message_count": message_count,
    }


@router.get("/conversations/{conversation_id}", response_model=ConversationDetail)
async def read_conversation(
    conversation_id: UUID, db: AsyncSession = Depends(get_db)
) -> dict:
    result = await db.execute(
        select(Conversation, _message_count_subquery().label("message_count"))
        .options(selectinload(Conversation.contact))
        .where(Conversation.id == conversation_id)
    )
    row = result.one_or_none()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found"
        )
    conversation, message_count = row

    # Opening a thread is what "read" means here. Gated on the flag actually
    # being set so a screen that polls this endpoint every few seconds (see
    # DetailPanel) only ever writes once per unread message, not on every
    # poll — this stays a read from the caller's point of view even though it
    # has one narrow, idempotent side effect.
    if conversation.is_unread:
        conversation.is_unread = False
        await db.flush()

    return await _conversation_detail(db, conversation, message_count)


@router.patch("/conversations/{conversation_id}", response_model=ConversationDetail)
async def update_conversation(
    conversation_id: UUID,
    payload: ConversationUpdate,
    actor: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Assign, re-status, re-tag or re-route a conversation."""
    conversation = await db.get(Conversation, conversation_id)
    if conversation is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found"
        )

    sent = payload.model_dump(exclude_unset=True)
    changes: list[str] = []

    if "assigned_agent_id" in sent:
        assignee_id = sent["assigned_agent_id"]
        if assignee_id is not None:
            assignee = await db.get(User, assignee_id)
            if assignee is None or not assignee.is_active:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="That user cannot be assigned conversations",
                )
        conversation.assigned_agent_id = assignee_id
        changes.append("assignee")

    if "agent_id" in sent:
        ai_agent_id = sent["agent_id"]
        if ai_agent_id is not None:
            ai_agent = await db.get(Agent, ai_agent_id)
            if ai_agent is None or ai_agent.status != AgentStatus.active:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="That agent cannot be assigned to a conversation",
                )
        conversation.agent_id = ai_agent_id
        changes.append("AI agent")

    if "status" in sent:
        conversation.status = sent["status"]
        changes.append(f"status → {sent['status'].value}")
        # Resolving a thread clears the handover flag; leaving it set would
        # keep a finished conversation looking like outstanding work.
        if sent["status"] is ConversationStatus.resolved:
            conversation.handover_reason = None
            conversation.handover_detail = None
            conversation.handover_at = None

    if "is_unread" in sent:
        conversation.is_unread = sent["is_unread"]
        changes.append(f"unread → {sent['is_unread']}")

    if "is_pinned" in sent:
        conversation.is_pinned = sent["is_pinned"]
        changes.append(f"pinned → {sent['is_pinned']}")

    added_tags: list[str] = []
    if "tags" in sent and sent["tags"] is not None:
        # Normalised here rather than trusting the client: lowercase, trimmed,
        # deduplicated, order preserved. Otherwise "Billing" and "billing "
        # become two tags in the filter list.
        seen: list[str] = []
        for raw in sent["tags"]:
            tag = raw.strip().lower()
            if tag and tag not in seen:
                seen.append(tag)
        added_tags = [tag for tag in seen if tag not in (conversation.tags or [])]
        conversation.tags = seen
        changes.append("tags")

    await db.flush()

    if added_tags:
        from app.domains.workflows import engine as workflow_engine

        contact = await db.get(Contact, conversation.contact_id)
        for tag in added_tags:
            await workflow_engine.fire(
                db, "tag_added", event={"tag": tag},
                conversation=conversation, contact=contact,
            )

    if changes:
        await record_audit(
            db,
            actor=actor,
            action="update",
            entity_type="conversation",
            entity_id=conversation.id,
            summary=f"{actor.name} updated {', '.join(changes)} on a conversation",
        )

    # Not read_conversation: its own auto-clear-on-open would immediately
    # revert an is_unread=True this same request may have just set — see
    # _conversation_detail's docstring. Same identity-mapped `conversation`
    # object, just re-fetched with the eager-load its response needs.
    result = await db.execute(
        select(Conversation, _message_count_subquery().label("message_count"))
        .options(selectinload(Conversation.contact))
        .where(Conversation.id == conversation_id)
    )
    conversation, message_count = result.one()
    return await _conversation_detail(db, conversation, message_count)


@router.delete("/conversations/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_conversation(
    conversation_id: UUID,
    actor: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete a conversation and its full message history.

    Eagerly loads contact (for the audit summary) and messages before
    deleting: `lazy="raise"` blocks the ORM's own delete-orphan cascade from
    reading an unloaded collection just as it would any other unguarded
    access. The FK's ON DELETE CASCADE removes the message rows at the
    database level regardless; this just keeps them in sync with that.
    """
    result = await db.execute(
        select(Conversation)
        .options(selectinload(Conversation.contact), selectinload(Conversation.messages))
        .where(Conversation.id == conversation_id)
    )
    conversation = result.scalar_one_or_none()
    if conversation is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found"
        )

    await record_audit(
        db,
        actor=actor,
        action="delete",
        entity_type="conversation",
        entity_id=conversation.id,
        summary=f"{actor.name} deleted the conversation with {conversation.contact.name}",
    )
    await db.delete(conversation)
    await db.flush()


@router.get("/conversations/{conversation_id}/messages", response_model=list[MessageRead])
async def list_messages(
    conversation_id: UUID, db: AsyncSession = Depends(get_db)
) -> list[Message]:
    result = await db.execute(
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.created_at)
    )
    return list(result.scalars())


async def _load_conversation_with_contact(
    db: AsyncSession, conversation_id: UUID
) -> Conversation:
    result = await db.execute(
        select(Conversation)
        .options(selectinload(Conversation.contact))
        .where(Conversation.id == conversation_id)
    )
    conversation = result.scalar_one_or_none()
    if conversation is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found"
        )
    return conversation


def _clear_pending_handover(conversation: Conversation) -> None:
    """A reply from a person is exactly what a pending handover was waiting
    for — clear it the same way resolving the conversation already does,
    rather than leaving it flagged for a person who has, in fact, arrived."""
    if conversation.status is ConversationStatus.pending:
        conversation.status = ConversationStatus.open
        conversation.handover_reason = None
        conversation.handover_detail = None
        conversation.handover_at = None


@router.post(
    "/conversations/{conversation_id}/messages",
    response_model=MessageRead,
    status_code=status.HTTP_201_CREATED,
)
async def send_message(
    conversation_id: UUID,
    payload: MessageCreate,
    db: AsyncSession = Depends(get_db),
) -> Message:
    """A staff-authored reply — the dashboard composer's only write path.

    Delivers through the same ChannelAdapter the AI pipeline uses (see
    app.orchestrator.get_adapter), so this is not a second, divergent way of
    talking to Telegram — just a second *author*. The send happens
    synchronously in the request/response cycle rather than via the RQ queue:
    unlike the AI pipeline (which embeds and calls an LLM), this is one quick
    HTTP call to the channel, and a staff member clicking "send" expects to
    know immediately whether it worked.
    """
    conversation = await _load_conversation_with_contact(db, conversation_id)
    contact = conversation.contact
    if not contact.external_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This contact has no channel identity to reply to.",
        )

    # Local import: avoids a hard import-time dependency from every API
    # request on the orchestrator's own heavier import graph (KB models,
    # LLM registry, etc.) for the vast majority of requests that never send
    # a message.
    from app.orchestrator import get_adapter

    try:
        adapter = get_adapter(contact.channel)
        external_id = await adapter.send(reply_to=contact.external_id, text=payload.text)
    except NotImplementedError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc
    except Exception as exc:
        # Covers every adapter's own *NotConfigured (missing credentials in
        # this environment) and any error from the channel's API call itself
        # (bad chat id, blocked sender, network outage). Deliberately not
        # logged as a Message row: nothing was actually delivered, so there is
        # nothing true to record — the customer has no reply and the
        # dashboard should not claim otherwise.
        log.warning("Failed to send reply for conversation %s: %s", conversation_id, exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Could not deliver the message: {exc}",
        ) from exc

    message = Message(
        conversation_id=conversation.id,
        direction=MessageDirection.outgoing,
        text=payload.text,
        status=MessageStatus.sent,
        external_id=external_id,
        is_staff_reply=True,
    )
    db.add(message)
    _clear_pending_handover(conversation)

    await db.flush()
    await db.refresh(message)
    return message


@router.post(
    "/conversations/{conversation_id}/attachments",
    response_model=MessageRead,
    status_code=status.HTTP_201_CREATED,
)
async def send_attachment(
    conversation_id: UUID,
    file: UploadFile = File(...),
    caption: str | None = Form(default=None),
    db: AsyncSession = Depends(get_db),
) -> Message:
    """Upload a file and deliver it as an attachment — the composer's
    "attach a file" action. Same real-delivery-first discipline as
    send_message: the upload is cleaned up and nothing is recorded unless
    the channel actually accepted it.
    """
    conversation = await _load_conversation_with_contact(db, conversation_id)
    contact = conversation.contact
    if not contact.external_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This contact has no channel identity to reply to.",
        )

    filename = file.filename or "attachment"
    content_type = file.content_type or "application/octet-stream"
    try:
        saved_path, size = await save_upload(file, category="message_attachments")
    except UploadTooLarge as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc

    from app.orchestrator import get_adapter

    try:
        adapter = get_adapter(contact.channel)
        external_id = await adapter.send_attachment(
            reply_to=contact.external_id,
            file_path=saved_path,
            filename=filename,
            content_type=content_type,
            caption=caption,
        )
    except NotImplementedError as exc:
        delete_upload(saved_path)
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 — reported to the caller, see send_message
        delete_upload(saved_path)
        log.warning("Failed to send attachment for conversation %s: %s", conversation_id, exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Could not deliver the attachment: {exc}",
        ) from exc

    message = Message(
        conversation_id=conversation.id,
        direction=MessageDirection.outgoing,
        text=caption,
        status=MessageStatus.sent,
        external_id=external_id,
        is_staff_reply=True,
        attachment_url=public_url(saved_path),
        attachment_filename=filename,
        attachment_content_type=content_type,
        attachment_size=size,
    )
    db.add(message)
    _clear_pending_handover(conversation)

    await db.flush()
    await db.refresh(message)
    return message


async def _load_staff_message(
    db: AsyncSession, conversation_id: UUID, message_id: UUID
) -> Message:
    message = await db.get(Message, message_id)
    if message is None or message.conversation_id != conversation_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Message not found")
    if not message.is_staff_reply:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Only a staff-authored reply can be edited or deleted — a customer's "
            "own message is their historical record.",
        )
    return message


@router.patch(
    "/conversations/{conversation_id}/messages/{message_id}", response_model=MessageRead
)
async def update_message(
    conversation_id: UUID,
    message_id: UUID,
    payload: MessageUpdate,
    db: AsyncSession = Depends(get_db),
) -> Message:
    """Edit a staff reply's text.

    Also attempts a real edit on the channel itself where the protocol
    supports it (Telegram's editMessageText) — best-effort and silent on
    failure, because the local record is what Agentra's own dashboard shows
    and is updated regardless; WhatsApp/Instagram/email have no such API at
    all, so for those this is *always* local-only, which is the honest
    result of a real protocol limitation, not a bug.
    """
    message = await _load_staff_message(db, conversation_id, message_id)

    if message.external_id:
        conversation = await db.get(Conversation, conversation_id)
        contact = await db.get(Contact, conversation.contact_id) if conversation else None
        if contact and contact.external_id:
            from app.orchestrator import get_adapter

            try:
                adapter = get_adapter(contact.channel)
                await adapter.edit(
                    reply_to=contact.external_id,
                    external_id=message.external_id,
                    new_text=payload.text,
                )
            except Exception as exc:  # noqa: BLE001 — best-effort, see docstring
                log.info("Channel-side edit not applied for message %s: %s", message_id, exc)

    message.text = payload.text
    message.edited_at = datetime.now(UTC)
    await db.flush()
    await db.refresh(message)
    return message


@router.delete(
    "/conversations/{conversation_id}/messages/{message_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_message(
    conversation_id: UUID,
    message_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete a staff reply. Same best-effort channel-side attempt and same
    honesty about it as update_message above."""
    message = await _load_staff_message(db, conversation_id, message_id)

    conversation = await db.get(Conversation, conversation_id)
    contact = await db.get(Contact, conversation.contact_id) if conversation else None
    if message.external_id and contact and contact.external_id:
        from app.orchestrator import get_adapter

        try:
            adapter = get_adapter(contact.channel)
            await adapter.delete(reply_to=contact.external_id, external_id=message.external_id)
        except Exception as exc:  # noqa: BLE001 — best-effort, see update_message
            log.info("Channel-side delete not applied for message %s: %s", message_id, exc)

    if message.attachment_url:
        delete_upload(path_from_url(message.attachment_url))

    await db.delete(message)
    await db.flush()
