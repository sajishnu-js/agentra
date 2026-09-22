"""user timezone override

Revision ID: 55c129c086a2
Revises: 375680310da3
Create Date: 2026-08-30 02:15:15.895212

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '55c129c086a2'
down_revision: Union[str, None] = '375680310da3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("timezone", sa.String(length=64), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "timezone")
