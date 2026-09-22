"""agent owner and unique knowledge base

Revision ID: 273ae0fbf978
Revises: 48b25e9ac664
Create Date: 2026-08-29

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = '273ae0fbf978'
down_revision: Union[str, None] = '48b25e9ac664'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "agents",
        sa.Column("owner_user_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_index(op.f("ix_agents_owner_user_id"), "agents", ["owner_user_id"])
    op.create_foreign_key(
        "fk_agents_owner_user_id_users",
        "agents",
        "users",
        ["owner_user_id"],
        ["id"],
        ondelete="SET NULL",
    )
    # Safe against the live data: every agent already has a distinct,
    # non-null knowledge_base_id (the 5 UAE specialists, each 1:1 with its
    # own KB) — see the app-level checks in agents/router.py that keep it
    # that way going forward.
    op.create_unique_constraint("uq_agents_knowledge_base_id", "agents", ["knowledge_base_id"])


def downgrade() -> None:
    op.drop_constraint("uq_agents_knowledge_base_id", "agents", type_="unique")
    op.drop_constraint("fk_agents_owner_user_id_users", "agents", type_="foreignkey")
    op.drop_index(op.f("ix_agents_owner_user_id"), table_name="agents")
    op.drop_column("agents", "owner_user_id")
