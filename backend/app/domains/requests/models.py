"""The Requests Hub: structured tickets extracted from conversations."""

import enum
from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import DateTime, Enum, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base, CreatedAtMixin, UUIDMixin

if TYPE_CHECKING:
    from app.domains.conversations.models import Conversation


class RequestCategory(str, enum.Enum):
    """What the contact actually wants.

    A closed set so the extraction step has a fixed target to classify into.
    Adding a value means one migration that swaps the CHECK constraint.
    """

    #: The customer explicitly asked for a person rather than the agent. Kept
    #: separate from `callback`, which is a request for a phone call — someone
    #: can want a human on chat without wanting to be phoned.
    human_request = "human_request"
    callback = "callback"
    order = "order"
    reschedule = "reschedule"
    cancellation = "cancellation"
    billing = "billing"
    complaint = "complaint"
    other = "other"


class RequestPriority(str, enum.Enum):
    low = "low"
    normal = "normal"
    high = "high"
    urgent = "urgent"


class RequestStatus(str, enum.Enum):
    pending = "pending"
    completed = "completed"
    cancelled = "cancelled"


class Request(Base, UUIDMixin, CreatedAtMixin):
    __tablename__ = "requests"

    conversation_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("conversations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    category: Mapped[RequestCategory] = mapped_column(
        Enum(
            RequestCategory,
            name="request_category",
            native_enum=False, create_constraint=True,
            validate_strings=True,
        ),
        nullable=False,
    )
    priority: Mapped[RequestPriority] = mapped_column(
        Enum(
            RequestPriority,
            name="request_priority",
            native_enum=False, create_constraint=True,
            validate_strings=True,
        ),
        default=RequestPriority.normal,
        nullable=False,
    )
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    status: Mapped[RequestStatus] = mapped_column(
        Enum(
            RequestStatus, name="request_status", native_enum=False, create_constraint=True, validate_strings=True
        ),
        default=RequestStatus.pending,
        nullable=False,
        index=True,
    )

    # When the request was marked completed, so time-to-close is measurable.
    # Set and cleared by the status transition, never by hand — see the
    # requests router. NULL for anything not currently completed, which is why
    # the closing-time panel reports how many rows it could actually measure
    # rather than implying it measured all of them.
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # The staff member who owns this specific ticket. Independent of
    # Conversation.assigned_agent_id: a request can be claimed by someone
    # other than whoever owns the whole thread (a billing specialist takes a
    # billing request even though reception owns the conversation). Not
    # auto-assigned on creation — see requests router; a request starts
    # unowned and is claimed, unlike a conversation.
    assigned_agent_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), index=True
    )

    # Not decoration: SQLAlchemy orders INSERTs within a flush from the mapper
    # dependency graph, which is built from relationships rather than from FK
    # columns. Without this a Request can be inserted before the Conversation
    # it points at, which is a foreign key violation. Python-level only, so no
    # migration is needed.
    conversation: Mapped["Conversation"] = relationship(lazy="raise")
