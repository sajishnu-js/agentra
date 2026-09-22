"""message is_staff_reply flag

Revision ID: 646905114f66
Revises: 04317b78608c
Create Date: 2026-08-28 21:45:20.272443

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import pgvector.sqlalchemy


revision: str = '646905114f66'
down_revision: Union[str, None] = '04317b78608c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "messages",
        sa.Column(
            "is_staff_reply",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("messages", "is_staff_reply")
