"""agent configuration studio fields

Revision ID: 22ee72c82914
Revises: 0741053308c6
Create Date: 2026-08-29 16:02:27.441549

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import pgvector.sqlalchemy
from sqlalchemy.dialects import postgresql


revision: str = '22ee72c82914'
down_revision: Union[str, None] = '0741053308c6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "agents",
        sa.Column("icon", sa.String(length=40), nullable=False, server_default="Bot"),
    )
    op.add_column(
        "agents",
        sa.Column("guardrails", sa.Text(), nullable=False, server_default=""),
    )
    op.add_column(
        "agents",
        sa.Column(
            "tools_enabled",
            postgresql.ARRAY(sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::text[]"),
        ),
    )
    op.add_column(
        "agents",
        sa.Column("response_behaviour", sa.Text(), nullable=False, server_default=""),
    )
    op.add_column(
        "agents",
        sa.Column("fallback_message", sa.Text(), nullable=True),
    )
    op.add_column(
        "agents",
        sa.Column(
            "context_history_limit", sa.Integer(), nullable=False, server_default="0"
        ),
    )
    op.add_column(
        "agents",
        sa.Column(
            "max_output_tokens", sa.Integer(), nullable=False, server_default="2048"
        ),
    )


def downgrade() -> None:
    op.drop_column("agents", "max_output_tokens")
    op.drop_column("agents", "context_history_limit")
    op.drop_column("agents", "fallback_message")
    op.drop_column("agents", "response_behaviour")
    op.drop_column("agents", "tools_enabled")
    op.drop_column("agents", "guardrails")
    op.drop_column("agents", "icon")
