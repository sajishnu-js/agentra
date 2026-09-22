"""Threads between a contact and the business."""

import enum
from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import DateTime, Enum, ForeignKey, Index, Integer, String, Text
from sqlalchemy import text as sa_text  # `text` is a column name below
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base, CreatedAtMixin, UUIDMixin

if TYPE_CHECKING:
    from app.domains.contacts.models import Contact


class ConversationStatus(str, enum.Enum):
    open = "open"
    pending = "pending"
    resolved = "resolved"


class MessageDirection(str, enum.Enum):
    incoming = "incoming"
    outgoing = "outgoing"


class HandoverReason(str, enum.Enum):
    """Why a conversation is waiting on a person.

    Stored so staff opening the Conversations screen can see *why* something
    needs them, not just that it does.
    """

    #: A hard keyword rule fired. The AI was never called.
    keyword = "keyword"
    #: The model answered but reported it could not do so confidently.
    ai_uncertain = "ai_uncertain"
    #: The model could not be reached at all — quota, outage, bad key.
    llm_error = "llm_error"
    #: A human took the thread over from the dashboard.
    manual = "manual"


class MessageStatus(str, enum.Enum):
    """Delivery state.

    Incoming messages land as `received`. Outgoing ones walk
    queued → sent → delivered → read, or stop at `failed`.
    """

    received = "received"
    queued = "queued"
    sent = "sent"
    delivered = "delivered"
    read = "read"
    failed = "failed"


class Conversation(Base, UUIDMixin, CreatedAtMixin):
    __tablename__ = "conversations"

    contact_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("contacts.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    status: Mapped[ConversationStatus] = mapped_column(
        Enum(
            ConversationStatus,
            name="conversation_status",
            native_enum=False, create_constraint=True,
            validate_strings=True,
        ),
        default=ConversationStatus.open,
        nullable=False,
        index=True,
    )

    # The human who owns this thread. Named assigned_agent_id because "agent"
    # is the staff-facing word; it points at users.id.
    assigned_agent_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), index=True
    )

    # The AI agent that answers this thread — points at agents.id, a wholly
    # separate table from the human assignee above despite the similar name.
    # Resolved once (from the contact's inbox, see orchestrator._resolve_agent)
    # and left alone after: reassigning an inbox's default agent, or pausing
    # or deleting the agent itself, must not retroactively change a
    # conversation already under way, mirroring how assigned_agent_id already
    # behaves. NULL means never resolved — either no inbox/agent was
    # configured for this channel yet, or the conversation predates this
    # column; either way generation falls back to today's defaults.
    agent_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("agents.id", ondelete="SET NULL"), index=True
    )

    # Timestamp of the most recent *incoming* message. WhatsApp only allows a
    # free-form reply within 24 hours of this, after which a template is
    # required, so it is stored rather than derived on every read.
    last_incoming_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), index=True
    )

    # Why this thread needs a person. NULL whenever status is not `pending`.
    handover_reason: Mapped[HandoverReason | None] = mapped_column(
        Enum(
            HandoverReason,
            name="handover_reason",
            native_enum=False,
            create_constraint=True,
            validate_strings=True,
        )
    )

    # The specifics behind the reason — which keywords matched, or the
    # confidence the model reported. Free text because it is for a human to
    # read, not for the application to branch on.
    handover_detail: Mapped[str | None] = mapped_column(Text)

    # When the handover was raised, so a queue can be aged and sorted.
    handover_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Free-form staff labels: "billing", "follow-up", "vip".
    #
    # A text array rather than a tags table. Tags here are labels, not
    # entities: nothing needs to hang off a tag, and the only query is "which
    # conversations have this one", which a GIN index answers directly. A join
    # table would be two more tables and a migration for zero gain. If tags
    # ever need colours, owners or descriptions, that is when they earn a table.
    tags: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, server_default=sa_text("'{}'::text[]")
    )

    # Defaults true: a conversation almost always starts from an inbound
    # message nobody has looked at yet (see orchestrator._find_or_create_
    # conversation, which stamps it explicitly on every new inbound message
    # for that same reason). Cleared by read_conversation the first time the
    # thread is opened — see that function's own comment.
    is_unread: Mapped[bool] = mapped_column(
        nullable=False, default=True, server_default=sa_text("true")
    )
    is_pinned: Mapped[bool] = mapped_column(
        nullable=False, default=False, server_default=sa_text("false")
    )

    contact: Mapped["Contact"] = relationship(lazy="raise")
    messages: Mapped[list["Message"]] = relationship(
        back_populates="conversation",
        cascade="all, delete-orphan",
        order_by="Message.created_at",
        lazy="raise",
    )

    __table_args__ = (
        # GIN, because the only tag query is containment ("has this tag"), and
        # a btree cannot answer that on an array.
        Index("ix_conversations_tags", "tags", postgresql_using="gin"),
    )


class Message(Base, UUIDMixin, CreatedAtMixin):
    __tablename__ = "messages"

    conversation_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("conversations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    direction: Mapped[MessageDirection] = mapped_column(
        Enum(
            MessageDirection,
            name="message_direction",
            native_enum=False, create_constraint=True,
            validate_strings=True,
        ),
        nullable=False,
    )

    # Nullable so an image, voice note or document can be recorded before
    # there is any transcript for it.
    text: Mapped[str | None] = mapped_column(Text)

    status: Mapped[MessageStatus] = mapped_column(
        Enum(
            MessageStatus, name="message_status", native_enum=False, create_constraint=True, validate_strings=True
        ),
        nullable=False,
    )

    # The channel's own id for this message. For inbound messages this is what
    # makes a retried queue job idempotent; see the partial unique index below.
    external_id: Mapped[str | None] = mapped_column(String(120))

    # Audit trail for AI replies: which knowledge base chunks were retrieved
    # and how well each scored, e.g.
    #   [{"chunk_id": "…", "kb_document_id": "…", "score": 0.83}]
    # NULL means the message was not AI-generated, or used no retrieval —
    # which is exactly why this alone can't tell an AI reply with zero
    # matched chunks apart from a staff-typed one. See is_staff_reply.
    kb_chunks_used: Mapped[list[dict] | None] = mapped_column(JSONB)

    # True only for messages sent through the dashboard composer. Read
    # access is by session/permission (see auth/dependencies.py), but a
    # message itself does not record *which* staff member sent it — only
    # that a person, not the model, wrote it. Without this, the UI has no
    # way to avoid mislabelling a human's reply as coming from the AI.
    is_staff_reply: Mapped[bool] = mapped_column(
        nullable=False, default=False, server_default=sa_text("false")
    )

    # An uploaded file attached to this message. All four null together on
    # every message with no attachment; url is the only one a client
    # strictly needs, but keeping filename/content_type/size means the UI
    # never has to re-derive them from the URL's path.
    attachment_url: Mapped[str | None] = mapped_column(String(500))
    attachment_filename: Mapped[str | None] = mapped_column(String(300))
    attachment_content_type: Mapped[str | None] = mapped_column(String(120))
    attachment_size: Mapped[int | None] = mapped_column(Integer)

    # Set when a staff reply's text is edited after sending. NULL means
    # never edited — including for every incoming message, which this
    # column is never applied to (see router: edit/delete are staff-reply
    # only, a customer's own historical record is never rewritten).
    edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    conversation: Mapped[Conversation] = relationship(
        back_populates="messages", lazy="raise"
    )

    __table_args__ = (
        # Partial, and inbound only. The point of this index is idempotency:
        # the same inbound message must not be logged twice when the queue
        # retries. Applying it to outbound messages as well would mean a reply
        # that was successfully delivered could fail to be recorded — the
        # customer sees an answer the dashboard does not have, which is the
        # worst version of this bug. Outbound ids are the channel's to
        # guarantee, not ours to enforce.
        Index(
            "uq_messages_inbound_external_id",
            "conversation_id",
            "external_id",
            unique=True,
            postgresql_where=sa_text("direction = 'incoming'"),
        ),
    )
