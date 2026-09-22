"""Who should handle a conversation.

One rule today: the active agent with the fewest open or pending conversations.

`pick_assignee` is the whole seam. Swapping it for department routing, skills
matching, shift awareness or a queue-per-inbox means rewriting this one
function; the orchestrator calls it and stores whatever it returns. Nothing
else in the conversation path knows how the decision is made.

Two properties worth keeping in whatever replaces it:

  * It must be safe to return None. No available agent is a normal state at
    3am, and an unassigned conversation is still visible in the dashboard.
  * It must not raise into the caller. A failed assignment should never cost a
    customer their reply.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domains.conversations.models import Conversation, ConversationStatus
from app.domains.requests.models import Request, RequestStatus
from app.domains.users.models import User, UserRole

log = logging.getLogger(__name__)

#: Statuses that count as work in progress. A resolved conversation is not load.
ACTIVE_STATUSES = (ConversationStatus.open, ConversationStatus.pending)


@dataclass
class AgentLoad:
    user_id: UUID
    name: str
    open_conversations: int
    #: Pending requests owned by this person — a second, independent kind of
    #: load (see Request.assigned_agent_id). Unused by pick_assignee below,
    #: which only ever routes conversations; carried here so the one
    #: /users/assignable query serves both the conversation and the request
    #: assignment pickers without a second round trip.
    open_requests: int


async def agent_workloads(session: AsyncSession) -> list[AgentLoad]:
    """Every assignable user with their current active conversation and
    pending request counts.

    Includes admins: at a business this size the admin answers customers too.
    Includes agents with zero of either, which a plain GROUP BY would miss —
    and those are exactly the ones to assign to.
    """
    conversation_load = (
        select(func.count(Conversation.id))
        .where(
            Conversation.assigned_agent_id == User.id,
            Conversation.status.in_(ACTIVE_STATUSES),
        )
        .scalar_subquery()
    )
    request_load = (
        select(func.count(Request.id))
        .where(
            Request.assigned_agent_id == User.id,
            Request.status == RequestStatus.pending,
        )
        .scalar_subquery()
    )

    result = await session.execute(
        select(User, conversation_load.label("conversation_load"), request_load.label("request_load"))
        .where(User.is_active.is_(True), User.role.in_((UserRole.agent, UserRole.admin)))
        .order_by(User.name)
    )
    return [
        AgentLoad(
            user_id=user.id,
            name=user.name,
            open_conversations=conversation_count,
            open_requests=request_count,
        )
        for user, conversation_count, request_count in result.all()
    ]


async def pick_assignee(session: AsyncSession) -> UUID | None:
    """The least-busy active agent, or None if there is nobody to assign to.

    Ties break on name, so the choice is stable and testable rather than
    whatever order Postgres happened to return.
    """
    workloads = await agent_workloads(session)
    if not workloads:
        return None

    chosen = min(workloads, key=lambda entry: (entry.open_conversations, entry.name))
    log.info(
        "auto-assign -> %s (%d active) from %d candidate(s)",
        chosen.name,
        chosen.open_conversations,
        len(workloads),
    )
    return chosen.user_id


async def auto_assign(session: AsyncSession, conversation: Conversation) -> UUID | None:
    """Assign a conversation if it does not already have an owner.

    Never reassigns. Someone who has already picked a thread up keeps it, even
    if a later message triggers another handover.
    """
    if conversation.assigned_agent_id is not None:
        return conversation.assigned_agent_id

    try:
        assignee = await pick_assignee(session)
    except Exception:
        # Assignment is a convenience. A customer's reply is not.
        log.exception("auto-assignment failed; leaving the conversation unassigned")
        return None

    if assignee is not None:
        conversation.assigned_agent_id = assignee
    return assignee
