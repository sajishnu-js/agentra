"""Workspace sessions.

No passwords, no JWTs — that auth model was built once and then deliberately
removed (see migration 24e47bc3d88b: "Auth has been removed from the
application entirely"). This is not a security boundary against a hostile
network; it is an identity/session layer for a trusted, self-hosted internal
tool. Signing in means picking who you are from the active staff list — see
auth/router.py — after which every request is attributed to a real user
instead of nobody, and role-based authorization (auth/dependencies.py) has
something to check against. A future move to real credentials would replace
how a Session gets created, not this table.
"""

import secrets
from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, CreatedAtMixin, UUIDMixin


def generate_token() -> str:
    return secrets.token_urlsafe(32)


class Session(Base, UUIDMixin, CreatedAtMixin):
    __tablename__ = "sessions"

    user_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    token: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)

    # Touched on every authenticated request (see dependencies.get_current_user).
    # Idle-timeout enforcement compares against this, not created_at, so an
    # active user is never logged out mid-use — only a genuinely idle one.
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    user_agent: Mapped[str | None] = mapped_column(String(300))
    ip_address: Mapped[str | None] = mapped_column(String(64))
