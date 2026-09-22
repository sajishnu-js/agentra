from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from app.domains.contacts.models import Channel
from app.domains.requests.models import RequestCategory, RequestPriority, RequestStatus


class RequestContact(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    channel: Channel


class RequestAssignee(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str


class RequestRead(BaseModel):
    """A row of the Requests Hub table.

    The contact is joined in because a request with no name attached to it is
    not actionable.
    """

    id: UUID
    conversation_id: UUID
    category: RequestCategory
    priority: RequestPriority
    title: str
    status: RequestStatus
    created_at: datetime
    completed_at: datetime | None = None
    contact: RequestContact
    assigned_agent: RequestAssignee | None = None


class RequestUpdate(BaseModel):
    """What a staff member may change from the Requests Hub.

    Status and ownership only. Category and priority are the model's
    classification and the title is its summary — correcting those is a
    separate feature, and conflating it with "mark this done" or "assign
    this" would make the audit trail ambiguous. Both fields are independently
    optional so a pure claim/assign action does not have to resend a status,
    and vice versa.
    """

    status: RequestStatus | None = None
    assigned_agent_id: UUID | None = None
