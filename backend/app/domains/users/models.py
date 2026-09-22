"""Staff of the workspace."""

import enum

from sqlalchemy import Enum, String, Text, text as sa_text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, CreatedAtMixin, UUIDMixin


class UserRole(str, enum.Enum):
    # Full system access, unconditionally — cannot be restricted by
    # `granted_permissions` below. The only role allowed to create/edit/
    # delete another super_admin, or touch the login-requirement toggle.
    super_admin = "super_admin"
    # Settings/Agents/Knowledge Base access, scoped to whatever
    # `granted_permissions` a super_admin has assigned this specific person —
    # see auth/permissions.py.
    admin = "admin"
    agent = "agent"


class User(Base, UUIDMixin, CreatedAtMixin):
    """A workspace staff member.

    `agent` here means a human handling conversations, which is a different
    thing from the AI agents configured on the Agents screen. Those have no
    table yet.
    """

    __tablename__ = "users"

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    email: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    # Remote URL rather than an upload: no file storage in the stack yet.
    avatar_url: Mapped[str | None] = mapped_column(String(500))

    # Cleared instead of deleting a user, so their history stays intact.
    # Inactive users cannot log in and are skipped by auto-assignment.
    #
    # server_default as well as default: `default=True` is Python-side only, so
    # Alembic would emit a NOT NULL column with no default and Postgres would
    # reject it outright on a table that already has rows.
    is_active: Mapped[bool] = mapped_column(
        default=True, server_default=sa_text("true"), nullable=False
    )
    role: Mapped[UserRole] = mapped_column(
        Enum(UserRole, name="user_role", native_enum=False, create_constraint=True, validate_strings=True),
        default=UserRole.agent,
        nullable=False,
    )

    job_title: Mapped[str | None] = mapped_column(String(120))
    phone: Mapped[str | None] = mapped_column(String(40))

    # IANA name (e.g. "Asia/Dubai"). NULL means "use the workspace default"
    # (WorkspaceSettings.timezone) — an override, never a copy of that value,
    # so a later workspace-wide change is inherited automatically by anyone
    # who hasn't set their own.
    timezone: Mapped[str | None] = mapped_column(String(64))

    # Mirrors the frontend's own localStorage-persisted theme (see
    # theme/ThemeProvider.tsx) so a preference set on one device follows the
    # person to another rather than resetting to the app default. NULL means
    # "no preference recorded yet" — the frontend falls back to its existing
    # localStorage/default behaviour rather than treating NULL as a value.
    theme_preference: Mapped[str | None] = mapped_column(String(10))
    accent_preference: Mapped[str | None] = mapped_column(String(20))

    # Only meaningful for role == admin: which of auth.permissions'
    # GRANTABLE_PERMISSIONS a super_admin has assigned this person. Ignored
    # for super_admin (always everything) and agent (always nothing beyond
    # the base EVERYONE set) — see auth/permissions.py:permissions_for.
    granted_permissions: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, server_default=sa_text("'{}'::text[]")
    )
