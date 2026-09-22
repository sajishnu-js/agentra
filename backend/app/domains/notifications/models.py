"""In-app notifications — the bell icon's real content.

One row per recipient per event, not a broadcast table fanned out at read
time: a workspace this size (a handful of staff) makes per-recipient rows
trivial in volume, and it keeps "mark this one read" a single-row update
instead of a join against some separate read-state table.
"""

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy import text as sa_text
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column
from uuid import UUID

from app.core.database import Base, CreatedAtMixin, UUIDMixin


class Notification(Base, UUIDMixin, CreatedAtMixin):
    __tablename__ = "notifications"

    user_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str | None] = mapped_column(Text)

    # Where clicking this notification should take you — a frontend route
    # such as "/app/conversations/{id}". Nullable: a purely informational
    # notification (e.g. a future digest) has nowhere to go.
    link: Mapped[str | None] = mapped_column(String(300))

    is_read: Mapped[bool] = mapped_column(
        nullable=False, default=False, server_default=sa_text("false")
    )
