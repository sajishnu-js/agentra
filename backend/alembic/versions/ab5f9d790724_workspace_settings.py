"""workspace settings

Revision ID: ab5f9d790724
Revises: d8a3964501d9
Create Date: 2026-08-29

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'ab5f9d790724'
down_revision: Union[str, None] = 'd8a3964501d9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "workspace_settings",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("workspace_name", sa.String(length=120), nullable=False, server_default="Agentra"),
        sa.Column("support_email", sa.String(length=255), nullable=True),
        sa.Column("default_language", sa.String(length=10), nullable=False, server_default="en"),
        sa.Column("timezone", sa.String(length=60), nullable=False, server_default="UTC"),
        sa.Column("notify_new_request", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("notify_handover", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("notify_agent_error", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("notify_daily_summary", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("session_idle_timeout_minutes", sa.Integer(), nullable=False, server_default="43200"),
        sa.Column("audit_log_retention_days", sa.Integer(), nullable=False, server_default="90"),
        sa.Column(
            "require_confirmation_for_deletes",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column("ip_allowlist", sa.Text(), nullable=True),
        sa.Column("default_model", sa.String(length=120), nullable=False, server_default="gemini-3.6-flash"),
        sa.Column("default_temperature", sa.Float(), nullable=False, server_default="0.2"),
        sa.Column("default_max_output_tokens", sa.Integer(), nullable=False, server_default="2048"),
    )


def downgrade() -> None:
    op.drop_table("workspace_settings")
