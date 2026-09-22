"""add human_request category

Hand-written on purpose. alembic/env.py filters Enum-generated CHECK
constraints out of autogenerate — see the note there — because Alembic
otherwise proposes dropping every one of them. The cost of that decision is
exactly this: adding a value to an enum means swapping the constraint by hand.

Revision ID: a1c4e7b93f52
Revises: f7a2a7d7db28
Create Date: 2026-08-21

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import pgvector.sqlalchemy

revision: str = 'a1c4e7b93f52'
down_revision: Union[str, None] = 'f7a2a7d7db28'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Keep in sync with RequestCategory in app/domains/requests/models.py.
_OLD = ("callback", "appointment", "reschedule", "cancellation",
        "insurance", "complaint", "other")
_NEW = ("human_request",) + _OLD

# The constraint is named after the Enum's `name=`, which is "request_category".
_CONSTRAINT = "request_category"


def _swap(values: tuple[str, ...]) -> None:
    """Resize the column and swap the CHECK constraint.

    The resize is easy to forget and fails at runtime rather than at migration
    time. Enum(native_enum=False) renders as VARCHAR sized to the longest
    member, so the column was VARCHAR(12) for "cancellation" and inserting the
    13-character "human_request" raises StringDataRightTruncationError long
    after this migration has apparently succeeded.
    """
    op.alter_column(
        "requests",
        "category",
        type_=sa.String(length=max(len(value) for value in values)),
        existing_nullable=False,
    )
    op.drop_constraint(_CONSTRAINT, "requests", type_="check")
    allowed = ", ".join(f"'{value}'" for value in values)
    op.create_check_constraint(
        _CONSTRAINT, "requests", f"category IN ({allowed})"
    )


def upgrade() -> None:
    _swap(_NEW)


def downgrade() -> None:
    # Any row already using the new value would violate the old constraint and
    # would not fit the narrower column, so fold those back first.
    op.execute(
        "UPDATE requests SET category = 'callback' WHERE category = 'human_request'"
    )
    _swap(_OLD)
