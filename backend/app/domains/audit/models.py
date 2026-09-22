"""An append-only record of who changed what."""

from typing import Any
from uuid import UUID

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, CreatedAtMixin, UUIDMixin


class AuditLog(Base, UUIDMixin, CreatedAtMixin):
    __tablename__ = "audit_logs"

    # SET NULL + a denormalised name snapshot: deleting a user must not erase
    # the historical fact that they did something — the entire point of an
    # audit trail is that it outlives the account it describes.
    actor_user_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    actor_name: Mapped[str | None] = mapped_column(String(200))
    action: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    entity_type: Mapped[str] = mapped_column(String(60), nullable=False, index=True)
    entity_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True), index=True)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    # Free-form detail (e.g. which fields changed, old/new role) — sanitised
    # to JSON-safe primitives by audit/service.py before it ever reaches here.
    context: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
