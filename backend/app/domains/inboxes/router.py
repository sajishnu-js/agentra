import logging
from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.core.database import get_db
from app.domains.agents.models import Agent, AgentStatus
from app.domains.audit.service import record_audit
from app.domains.auth.dependencies import require_permission
from app.domains.inboxes.models import Inbox, InboxStatus
from app.domains.inboxes.schemas import InboxCreate, InboxRead, InboxUpdate
from app.domains.users.models import User

router = APIRouter(prefix="/inboxes", tags=["inboxes"])
log = logging.getLogger("agentra.inboxes")


def _inbox_read(inbox: Inbox, agent: Agent | None) -> dict:
    return {
        "id": inbox.id,
        "name": inbox.name,
        "channel": inbox.channel,
        "status": inbox.status,
        "account_identifier": inbox.account_identifier,
        "last_synced_at": inbox.last_synced_at,
        "created_at": inbox.created_at,
        "default_agent_id": inbox.default_agent_id,
        "default_agent": agent,
    }


@router.get("", response_model=list[InboxRead])
async def list_inboxes(db: AsyncSession = Depends(get_db)) -> list[dict]:
    default_agent = aliased(Agent)
    result = await db.execute(
        select(Inbox, default_agent)
        .outerjoin(default_agent, default_agent.id == Inbox.default_agent_id)
        .order_by(Inbox.created_at)
    )
    return [
        _inbox_read(inbox, agent)
        for inbox, agent in result.all()
    ]


@router.post("", response_model=InboxRead, status_code=status.HTTP_201_CREATED)
async def create_inbox(
    payload: InboxCreate,
    admin: User = Depends(require_permission("manage_integrations")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Register a new channel connection.

    Created `pending`, never `connected` — creating this row is naming the
    channel and (optionally) its routing agent; it says nothing about whether
    the underlying WhatsApp/Instagram/email account is actually reachable
    yet. See InboxStatus.pending's own docstring.
    """
    if payload.default_agent_id is not None:
        agent = await db.get(Agent, payload.default_agent_id)
        if agent is None or agent.status != AgentStatus.active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="That agent cannot be assigned to an inbox",
            )

    inbox = Inbox(
        name=payload.name,
        channel=payload.channel,
        status=InboxStatus.pending,
        account_identifier=payload.account_identifier,
        default_agent_id=payload.default_agent_id,
    )
    db.add(inbox)
    await db.flush()
    await record_audit(
        db,
        actor=admin,
        action="create",
        entity_type="inbox",
        entity_id=inbox.id,
        summary=f"{admin.name} connected a new {inbox.channel.value} inbox: {inbox.name}",
    )

    default_agent = (
        await db.get(Agent, inbox.default_agent_id)
        if inbox.default_agent_id is not None
        else None
    )
    return _inbox_read(inbox, default_agent)


@router.post("/{inbox_id}/sync", response_model=InboxRead)
async def sync_inbox(
    inbox_id: UUID,
    admin: User = Depends(require_permission("manage_integrations")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """The Connect/Sync button's real action, not a status it merely
    displays: attempts the channel's own cheapest real round trip (Telegram's
    getMe, a Graph API read, an SMTP handshake — see each adapter's
    test_connection) and persists what actually happened, rather than a
    button that looks like it does something and does not.
    """
    inbox = await db.get(Inbox, inbox_id)
    if inbox is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Inbox not found")

    # Local import: same reasoning as conversations/router.py — most
    # requests never need the orchestrator's heavier import graph.
    from app.orchestrator import get_adapter

    try:
        adapter = get_adapter(inbox.channel)
        await adapter.test_connection()
    except Exception as exc:  # noqa: BLE001 — reported to the caller, not fatal
        inbox.status = InboxStatus.disconnected
        # Committed, not just flushed: the HTTPException raised below
        # propagates out through get_db's dependency, whose own exception
        # handler rolls back anything merely flushed — this status change is
        # the entire point of a failed sync and must survive that rollback.
        await db.commit()
        log.warning("Sync failed for inbox %s (%s): %s", inbox.id, inbox.channel.value, exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Could not connect: {exc}",
        ) from exc

    inbox.status = InboxStatus.connected
    inbox.last_synced_at = datetime.now(UTC)
    await db.flush()
    await record_audit(
        db,
        actor=admin,
        action="update",
        entity_type="inbox",
        entity_id=inbox.id,
        summary=f"{admin.name} synced {inbox.name}",
    )

    default_agent = (
        await db.get(Agent, inbox.default_agent_id)
        if inbox.default_agent_id is not None
        else None
    )
    return _inbox_read(inbox, default_agent)


@router.patch("/{inbox_id}", response_model=InboxRead)
async def update_inbox(
    inbox_id: UUID,
    payload: InboxUpdate,
    admin: User = Depends(require_permission("manage_integrations")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Set (or clear) which agent answers new conversations on this inbox."""
    inbox = await db.get(Inbox, inbox_id)
    if inbox is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Inbox not found")

    if payload.default_agent_id is not None:
        agent = await db.get(Agent, payload.default_agent_id)
        if agent is None or agent.status != AgentStatus.active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="That agent cannot be assigned to an inbox",
            )
    inbox.default_agent_id = payload.default_agent_id

    await db.flush()
    await db.refresh(inbox)
    await record_audit(
        db,
        actor=admin,
        action="update",
        entity_type="inbox",
        entity_id=inbox.id,
        summary=f"{admin.name} updated routing for {inbox.name}",
    )

    default_agent = (
        await db.get(Agent, inbox.default_agent_id)
        if inbox.default_agent_id is not None
        else None
    )
    return _inbox_read(inbox, default_agent)
