from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_serializer

from app.domains.contacts.masking import mask_phone_number
from app.domains.contacts.models import Channel
from app.domains.conversations.models import (
    ConversationStatus,
    HandoverReason,
    MessageDirection,
    MessageStatus,
)
from app.domains.requests.models import RequestCategory, RequestPriority, RequestStatus


class ContactSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    phone_number: str | None = None

    @field_serializer("phone_number")
    def _mask_phone(self, value: str | None) -> str | None:
        """Masked on the way out — see contacts/masking.py. The raw number
        stays in the database for operational use; it never reaches a client."""
        return mask_phone_number(value)
    channel: Channel
    language: str | None = None


class UserSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    avatar_url: str | None = None


class AgentSummary(BaseModel):
    """The AI agent answering a thread — distinct from UserSummary above,
    which is the human who owns it."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str


class MessagePreview(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    text: str | None = None
    direction: MessageDirection
    created_at: datetime


class MessageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    conversation_id: UUID
    direction: MessageDirection
    text: str | None = None
    status: MessageStatus
    kb_chunks_used: list[dict] | None = None
    is_staff_reply: bool = False
    attachment_url: str | None = None
    attachment_filename: str | None = None
    attachment_content_type: str | None = None
    attachment_size: int | None = None
    edited_at: datetime | None = None
    created_at: datetime


class ConversationListItem(BaseModel):
    """Everything the conversation list pane needs, in one row.

    The contact and the last message are joined in server-side so the list
    does not turn into one request per thread.
    """

    id: UUID
    status: ConversationStatus
    assigned_agent_id: UUID | None = None
    last_incoming_at: datetime | None = None
    created_at: datetime
    handover_reason: HandoverReason | None = None
    handover_detail: str | None = None
    handover_at: datetime | None = None
    tags: list[str] = []
    is_unread: bool = False
    is_pinned: bool = False
    contact: ContactSummary
    assigned_agent: UserSummary | None = None
    agent: AgentSummary | None = None
    last_message: MessagePreview | None = None
    message_count: int


class RequestSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    category: RequestCategory
    priority: RequestPriority
    title: str
    status: RequestStatus
    created_at: datetime


class ConversationDetail(BaseModel):
    """The right-hand detail panel."""

    id: UUID
    status: ConversationStatus
    last_incoming_at: datetime | None = None
    created_at: datetime
    handover_reason: HandoverReason | None = None
    handover_detail: str | None = None
    handover_at: datetime | None = None
    tags: list[str] = []
    is_unread: bool = False
    is_pinned: bool = False
    contact: ContactSummary
    assigned_agent: UserSummary | None = None
    agent: AgentSummary | None = None
    requests: list[RequestSummary]
    message_count: int


class ConversationUpdate(BaseModel):
    """What a staff member may change on a conversation.

    All optional; only the fields sent are applied (`exclude_unset`, see the
    router) — setting assigned_agent_id or agent_id to null explicitly
    unassigns, which is why "sent but null" and "not sent" have to be
    distinguishable.
    """

    assigned_agent_id: UUID | None = None
    # The AI agent, distinct from assigned_agent_id's human — normally
    # resolved once from the inbox and left alone (see the model's own
    # comment), but a staff member reassigning it by hand is a deliberate,
    # explicit override of that default.
    agent_id: UUID | None = None
    status: ConversationStatus | None = None
    tags: list[str] | None = None
    is_unread: bool | None = None
    is_pinned: bool | None = None


class TagsUpdate(BaseModel):
    tags: list[str]


class ConversationCreate(BaseModel):
    """Starting a conversation from the dashboard rather than an inbound
    message — either with an existing contact, or a new one described
    inline. Exactly one of the two must be given; the router enforces it."""

    contact_id: UUID | None = None
    contact_name: str | None = Field(default=None, max_length=200)
    channel: Channel | None = None
    # The channel's own identifier for the new contact — a phone number, a
    # chat id. Optional even when creating a contact: a manually logged
    # conversation (a call, a walk-in) has a real person but no channel
    # identity to send an automated reply to, same as any contact seeded
    # without one.
    external_id: str | None = Field(default=None, max_length=120)
    assigned_agent_id: UUID | None = None
    agent_id: UUID | None = None


class MessageCreate(BaseModel):
    """A staff-authored reply, sent from the dashboard composer."""

    text: str = Field(min_length=1, max_length=4096)


class MessageUpdate(BaseModel):
    text: str = Field(min_length=1, max_length=4096)
