"""Connected channel accounts that conversations arrive on."""

import enum
from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, Enum, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, CreatedAtMixin, UUIDMixin
from app.domains.contacts.models import Channel


class InboxStatus(str, enum.Enum):
    connected = "connected"
    disconnected = "disconnected"
    # Configured but never handshaked — what a channel looks like before the
    # connector for it exists.
    pending = "pending"


class Inbox(Base, UUIDMixin, CreatedAtMixin):
    __tablename__ = "inboxes"

    name: Mapped[str] = mapped_column(String(120), nullable=False)
    # Reuses the contacts Channel enum so a conversation's channel and its
    # inbox's channel can never drift apart.
    channel: Mapped[Channel] = mapped_column(
        Enum(Channel, name="channel", native_enum=False, create_constraint=True),
        nullable=False,
    )
    status: Mapped[InboxStatus] = mapped_column(
        Enum(InboxStatus, name="inbox_status", native_enum=False, create_constraint=True),
        default=InboxStatus.pending,
        nullable=False,
    )
    # Free-text account identifier — a phone number, a bot username.
    account_identifier: Mapped[str | None] = mapped_column(String(200))
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # The AI agent new conversations on this inbox are routed to. Nullable:
    # a channel with no agent configured just falls back to today's defaults
    # (see orchestrator._resolve_agent) rather than failing. SET NULL on
    # delete so removing an agent disconnects the inbox instead of taking it
    # down with it.
    default_agent_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("agents.id", ondelete="SET NULL"), index=True
    )
