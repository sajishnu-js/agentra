from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from app.domains.contacts.models import Channel
from app.domains.inboxes.models import InboxStatus


class AgentSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str


class InboxRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    channel: Channel
    status: InboxStatus
    account_identifier: str | None = None
    last_synced_at: datetime | None = None
    created_at: datetime
    default_agent_id: UUID | None = None
    default_agent: AgentSummary | None = None


class InboxUpdate(BaseModel):
    """Only the routing rule is editable today — connecting/syncing a
    channel is not yet a real flow (see the disabled Connect/Sync button on
    the frontend), so this is deliberately the one field, not a general
    partial-update schema."""

    default_agent_id: UUID | None = None


class InboxCreate(BaseModel):
    name: str
    channel: Channel
    # A phone number, a bot username, a Page handle, an address — whatever
    # this channel's account identifier looks like. Optional: naming the
    # inbox and picking its channel is enough to create it; the identifier
    # can be filled in once the underlying account is actually connected.
    account_identifier: str | None = None
    default_agent_id: UUID | None = None
