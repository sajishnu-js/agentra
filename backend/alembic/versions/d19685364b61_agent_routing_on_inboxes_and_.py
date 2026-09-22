"""agent routing on inboxes and conversations

Revision ID: d19685364b61
Revises: 646905114f66
Create Date: 2026-08-29 00:34:49.685827

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import pgvector.sqlalchemy
from sqlalchemy.dialects import postgresql


revision: str = 'd19685364b61'
down_revision: Union[str, None] = '646905114f66'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "inboxes",
        sa.Column("default_agent_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_index(
        op.f("ix_inboxes_default_agent_id"), "inboxes", ["default_agent_id"]
    )
    op.create_foreign_key(
        "fk_inboxes_default_agent_id_agents",
        "inboxes",
        "agents",
        ["default_agent_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.add_column(
        "conversations",
        sa.Column("agent_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_index(
        op.f("ix_conversations_agent_id"), "conversations", ["agent_id"]
    )
    op.create_foreign_key(
        "fk_conversations_agent_id_agents",
        "conversations",
        "agents",
        ["agent_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_conversations_agent_id_agents", "conversations", type_="foreignkey"
    )
    op.drop_index(op.f("ix_conversations_agent_id"), table_name="conversations")
    op.drop_column("conversations", "agent_id")

    op.drop_constraint(
        "fk_inboxes_default_agent_id_agents", "inboxes", type_="foreignkey"
    )
    op.drop_index(op.f("ix_inboxes_default_agent_id"), table_name="inboxes")
    op.drop_column("inboxes", "default_agent_id")
