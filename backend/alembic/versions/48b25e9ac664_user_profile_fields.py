"""user profile fields

Revision ID: 48b25e9ac664
Revises: ab5f9d790724
Create Date: 2026-08-29

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '48b25e9ac664'
down_revision: Union[str, None] = 'ab5f9d790724'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("job_title", sa.String(length=120), nullable=True))
    op.add_column("users", sa.Column("phone", sa.String(length=40), nullable=True))
    op.add_column("users", sa.Column("theme_preference", sa.String(length=10), nullable=True))
    op.add_column("users", sa.Column("accent_preference", sa.String(length=20), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "accent_preference")
    op.drop_column("users", "theme_preference")
    op.drop_column("users", "phone")
    op.drop_column("users", "job_title")
