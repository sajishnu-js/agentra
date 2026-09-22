"""super admin role and workspace login toggle

Hand-written: alembic/env.py filters Enum-generated CHECK constraints out of
autogenerate (see the note there), so adding an enum value means swapping
the constraint by hand — same pattern as c3f1a9d5b7e2.

Revision ID: 87f6209f54f7
Revises: 273ae0fbf978
Create Date: 2026-08-29

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = '87f6209f54f7'
down_revision: Union[str, None] = '273ae0fbf978'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_OLD_ROLES = ("admin", "agent")
_NEW_ROLES = ("super_admin", "admin", "agent")
_CONSTRAINT = "user_role"


def _set_width_and_constraint(values: tuple[str, ...]) -> None:
    op.alter_column(
        "users",
        "role",
        type_=sa.String(length=max(len(value) for value in values)),
        existing_nullable=False,
    )
    allowed = ", ".join(f"'{value}'" for value in values)
    op.create_check_constraint(_CONSTRAINT, "users", f"role IN ({allowed})")


def upgrade() -> None:
    op.drop_constraint(_CONSTRAINT, "users", type_="check")
    _set_width_and_constraint(_NEW_ROLES)

    op.add_column(
        "users",
        sa.Column(
            "granted_permissions",
            postgresql.ARRAY(sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::text[]"),
        ),
    )
    # Anyone who was already `admin` before this migration keeps the same
    # access they had a moment ago — the default bundle, not a silent
    # downgrade to nothing just because the grants column didn't exist yet.
    # Keep in sync with auth/permissions.py:DEFAULT_ADMIN_PERMISSIONS.
    op.execute(
        "UPDATE users SET granted_permissions = ARRAY["
        "'manage_users','manage_agents','manage_knowledge_base',"
        "'manage_workspace_settings','manage_security','manage_integrations',"
        "'view_audit_log'] WHERE role = 'admin'"
    )
    op.add_column(
        "workspace_settings",
        sa.Column("require_login", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )


def downgrade() -> None:
    op.drop_column("workspace_settings", "require_login")
    op.drop_column("users", "granted_permissions")

    op.drop_constraint(_CONSTRAINT, "users", type_="check")
    # A CHECK constraint validates existing rows the moment it's (re)created,
    # so any super_admin row would reject the narrower constraint below —
    # demote first, same spirit as c3f1a9d5b7e2's row rewrite before its own
    # narrowing ALTER.
    op.execute("UPDATE users SET role = 'admin' WHERE role = 'super_admin'")
    _set_width_and_constraint(_OLD_ROLES)
