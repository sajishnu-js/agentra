"""Workspace-wide configuration that must be editable by an admin at runtime.

A deliberate exception to this codebase's usual "config file, not a table"
preference (see business_hours.py's own docstring on that choice): the whole
point of the Settings screen is that a non-developer can change these without
a deploy. Flat typed columns rather than a JSON blob, matching how Agent's own
configuration is modelled — keeps every field queryable and migratable
instead of opaque.
"""

from sqlalchemy import Boolean, Float, Integer, String, Text, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from app.core.config import settings as env_settings
from app.core.database import Base, UUIDMixin


class WorkspaceSettings(Base, UUIDMixin):
    __tablename__ = "workspace_settings"

    # ---- workspace ----
    workspace_name: Mapped[str] = mapped_column(String(120), default="Agentra", nullable=False)
    support_email: Mapped[str | None] = mapped_column(String(255))
    default_language: Mapped[str] = mapped_column(String(10), default="en", nullable=False)
    timezone: Mapped[str] = mapped_column(
        String(60), default=lambda: env_settings.business_timezone, nullable=False
    )

    # ---- notifications ----
    # Persisted preferences a notification-delivery feature can read once one
    # exists. notify_new_request is the one already wired to something real
    # today — see Topbar.tsx, which only pulses the bell for a nonzero
    # pending-requests count when this is on.
    notify_new_request: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    notify_handover: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    notify_agent_error: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    notify_daily_summary: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # ---- security ----
    session_idle_timeout_minutes: Mapped[int] = mapped_column(Integer, default=43200, nullable=False)
    audit_log_retention_days: Mapped[int] = mapped_column(Integer, default=90, nullable=False)
    require_confirmation_for_deletes: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # Comma-separated IPs. NULL/empty means "no restriction" — see
    # auth/dependencies.get_current_user for enforcement, which always
    # trusts loopback regardless of this list.
    ip_allowlist: Mapped[str | None] = mapped_column(Text)

    # Off by default: "Enter Workspace" on the opening page goes straight in
    # with no sign-in screen (auth/dependencies.get_current_user falls back
    # to an implicit identity — the highest-privilege active user — when
    # this is False). Turning it on requires everyone to sign in for real.
    # Deliberately excluded from WorkspaceSettingsRead/Update — only
    # super_admin can even see this value, let alone change it (its own
    # dedicated schema + endpoints, gated by manage_login_requirement).
    require_login: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # ---- AI / model defaults ----
    # What a newly created agent starts from — see agents/router.py.
    default_model: Mapped[str] = mapped_column(
        String(120), default=lambda: env_settings.gemini_model, nullable=False
    )
    default_temperature: Mapped[float] = mapped_column(Float, default=0.2, nullable=False)
    default_max_output_tokens: Mapped[int] = mapped_column(Integer, default=2048, nullable=False)


async def get_or_create_workspace_settings(db: AsyncSession) -> WorkspaceSettings:
    """The one row this table ever has.

    No migration data-insert for it: the first read (already needed on every
    authenticated request, for the idle timeout and IP allowlist) creates it
    with defaults, so there is exactly one code path that can ever produce
    this row instead of two that could disagree. Concurrent first-requests
    racing to create it is a theoretical duplicate-row risk this single
    self-hosted process doesn't need to defend against.
    """
    result = await db.execute(select(WorkspaceSettings).limit(1))
    row = result.scalar_one_or_none()
    if row is None:
        row = WorkspaceSettings()
        db.add(row)
        await db.flush()
    return row
