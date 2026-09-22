"""request assignment

Revision ID: 0741053308c6
Revises: d19685364b61
Create Date: 2026-08-29 02:09:40.475850

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import pgvector.sqlalchemy
from sqlalchemy.dialects import postgresql


revision: str = '0741053308c6'
down_revision: Union[str, None] = 'd19685364b61'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "requests",
        sa.Column("assigned_agent_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_index(
        op.f("ix_requests_assigned_agent_id"), "requests", ["assigned_agent_id"]
    )
    op.create_foreign_key(
        "fk_requests_assigned_agent_id_users",
        "requests",
        "users",
        ["assigned_agent_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_requests_assigned_agent_id_users", "requests", type_="foreignkey"
    )
    op.drop_index(op.f("ix_requests_assigned_agent_id"), table_name="requests")
    op.drop_column("requests", "assigned_agent_id")
