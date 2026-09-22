from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status as http_status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.domains.contacts.models import Contact
from app.domains.conversations.models import Conversation
from app.domains.requests.models import Request, RequestStatus
from app.domains.requests.schemas import RequestRead, RequestUpdate
from app.domains.users.models import User

router = APIRouter(prefix="/requests", tags=["requests"])


def _serialize(request: Request, contact: Contact, assignee: User | None) -> dict:
    return {
        "id": request.id,
        "conversation_id": request.conversation_id,
        "category": request.category,
        "priority": request.priority,
        "title": request.title,
        "status": request.status,
        "created_at": request.created_at,
        "completed_at": request.completed_at,
        "contact": contact,
        "assigned_agent": assignee,
    }


@router.get("", response_model=list[RequestRead])
async def list_requests(
    status: RequestStatus | None = Query(default=None),
    assigned_to: UUID | None = Query(default=None),
    unassigned: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    stmt = (
        select(Request, Contact, User)
        .join(Conversation, Conversation.id == Request.conversation_id)
        .join(Contact, Contact.id == Conversation.contact_id)
        .outerjoin(User, User.id == Request.assigned_agent_id)
        .order_by(Request.created_at.desc())
    )
    if status is not None:
        stmt = stmt.where(Request.status == status)
    if unassigned:
        stmt = stmt.where(Request.assigned_agent_id.is_(None))
    elif assigned_to is not None:
        stmt = stmt.where(Request.assigned_agent_id == assigned_to)

    result = await db.execute(stmt)
    return [_serialize(request, contact, assignee) for request, contact, assignee in result.all()]


@router.patch("/{request_id}", response_model=RequestRead)
async def update_request(
    request_id: UUID,
    payload: RequestUpdate,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Change a request's status and/or owner from the Requests Hub."""
    result = await db.execute(
        select(Request, Contact)
        .join(Conversation, Conversation.id == Request.conversation_id)
        .join(Contact, Contact.id == Conversation.contact_id)
        .where(Request.id == request_id)
    )
    row = result.one_or_none()
    if row is None:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND, detail="Request not found"
        )

    request, contact = row
    sent = payload.model_dump(exclude_unset=True)
    status_changed = "status" in sent and sent["status"] is not request.status

    if "status" in sent:
        # completed_at is derived from the status transition, never set by
        # the caller. Reopening clears it, so a request that bounces between
        # states cannot report a closing time measured from an earlier
        # attempt.
        if sent["status"] is RequestStatus.completed:
            if request.completed_at is None:
                request.completed_at = datetime.now(UTC)
        else:
            request.completed_at = None
        request.status = sent["status"]

    if "assigned_agent_id" in sent:
        assignee_id = sent["assigned_agent_id"]
        if assignee_id is not None:
            assignee = await db.get(User, assignee_id)
            if assignee is None or not assignee.is_active:
                raise HTTPException(
                    status_code=http_status.HTTP_400_BAD_REQUEST,
                    detail="That user cannot be assigned requests",
                )
        request.assigned_agent_id = assignee_id

    await db.flush()

    if status_changed:
        from app.domains.workflows import engine as workflow_engine

        conversation = await db.get(Conversation, request.conversation_id)
        # Before the generic trigger: an approval node is waiting on this
        # exact request, and resuming it is the direct consequence of the
        # status change, not a side effect of some other workflow reacting.
        await workflow_engine.resume_approval(db, request)
        await workflow_engine.fire(
            db,
            "request_status_changed",
            event={"to_status": request.status.value},
            conversation=conversation,
            contact=contact,
            request=request,
        )

    assignee = (
        await db.get(User, request.assigned_agent_id)
        if request.assigned_agent_id is not None
        else None
    )
    return _serialize(request, contact, assignee)
