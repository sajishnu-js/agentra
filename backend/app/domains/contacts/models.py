"""People messaging the business from a channel."""

import enum
from uuid import UUID

from sqlalchemy import Enum, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, CreatedAtMixin, UUIDMixin


class Channel(str, enum.Enum):
    telegram = "telegram"
    whatsapp = "whatsapp"
    instagram = "instagram"
    email = "email"


class Contact(Base, UUIDMixin, CreatedAtMixin):
    __tablename__ = "contacts"

    name: Mapped[str] = mapped_column(String(200), nullable=False)

    # Nullable on purpose: WhatsApp identifies people by phone number, but a
    # Telegram user only shares one if they choose to.
    phone_number: Mapped[str | None] = mapped_column(String(32))

    channel: Mapped[Channel] = mapped_column(
        Enum(Channel, name="channel", native_enum=False, create_constraint=True, validate_strings=True),
        nullable=False,
    )

    # Auto-detected from what the contact writes, so NULL until we have seen
    # enough to guess. BCP-47 short code — 'en', 'ar', 'hi', 'ur'.
    language: Mapped[str | None] = mapped_column(String(8))

    # The channel's own identifier for this person: a Telegram user id, later a
    # WhatsApp phone number. Unique per channel, and the key the orchestrator
    # uses to find an existing contact rather than creating a duplicate on
    # every message. Nullable because seeded contacts have no channel identity.
    external_id: Mapped[str | None] = mapped_column(String(120))

    __table_args__ = (
        # Inbound routing looks a contact up by channel + number on every
        # message, so this pair is the hot path.
        Index("ix_contacts_channel_phone_number", "channel", "phone_number"),
        # One row per person per channel. This is what makes find-or-create
        # safe when two messages arrive at once.
        UniqueConstraint(
            "channel", "external_id", name="uq_contacts_channel_external_id"
        ),
    )


class ContactNote(Base, UUIDMixin, CreatedAtMixin):
    """Private staff context about a person — "VIP, escalate anything from
    them", "prefers Arabic" — distinct from Conversation.tags, which label a
    *thread*, not who is on the other end of it. Visible to any signed-in
    staff member; only the author or an admin/super_admin may delete one
    (see contacts/router.py)."""

    __tablename__ = "contact_notes"

    contact_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("contacts.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # SET NULL rather than CASCADE: the note is about the contact, not its
    # author — someone leaving the workspace must not erase context the rest
    # of staff still relies on.
    author_user_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), index=True
    )

    text: Mapped[str] = mapped_column(Text, nullable=False)
