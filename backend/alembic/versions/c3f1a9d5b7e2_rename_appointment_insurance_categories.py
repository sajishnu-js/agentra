"""rename appointment/insurance request categories to order/billing

Hand-written on purpose. alembic/env.py filters Enum-generated CHECK
constraints out of autogenerate — see the note there — because Alembic
otherwise proposes dropping every one of them. The cost of that decision is
exactly this: renaming an enum value means swapping the constraint by hand,
plus rewriting the rows that used the old value.

Revision ID: c3f1a9d5b7e2
Revises: 683d1c4f32fc
Create Date: 2026-08-28

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'c3f1a9d5b7e2'
down_revision: Union[str, None] = '683d1c4f32fc'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Keep in sync with RequestCategory in app/domains/requests/models.py.
_OLD = ("human_request", "callback", "appointment", "reschedule",
        "cancellation", "insurance", "complaint", "other")
_NEW = ("human_request", "callback", "order", "reschedule",
        "cancellation", "billing", "complaint", "other")

# The constraint is named after the Enum's `name=`, which is "request_category".
_CONSTRAINT = "request_category"

# Old value -> new value, for the row rewrite.
_RENAMES = (("appointment", "order"), ("insurance", "billing"))


def _set_width_and_constraint(values: tuple[str, ...]) -> None:
    """Resize the column and (re)create the CHECK constraint for `values`.

    Assumes the previous constraint has already been dropped. The resize is
    easy to forget and fails at runtime rather than at migration time:
    Enum(native_enum=False) renders as VARCHAR sized to the longest member, so
    getting the width wrong raises StringDataRightTruncationError long after
    this migration has apparently succeeded.
    """
    op.alter_column(
        "requests",
        "category",
        type_=sa.String(length=max(len(value) for value in values)),
        existing_nullable=False,
    )
    allowed = ", ".join(f"'{value}'" for value in values)
    op.create_check_constraint(
        _CONSTRAINT, "requests", f"category IN ({allowed})"
    )


def upgrade() -> None:
    # Drop the constraint first so the rename UPDATE below — which briefly
    # writes values ("order", "billing") the old constraint does not allow —
    # is not rejected. The column is already wide enough: the new values are
    # no longer than the old ones it was sized for.
    op.drop_constraint(_CONSTRAINT, "requests", type_="check")
    for old_value, new_value in _RENAMES:
        op.execute(
            f"UPDATE requests SET category = '{new_value}' "
            f"WHERE category = '{old_value}'"
        )
    _set_width_and_constraint(_NEW)


def downgrade() -> None:
    op.drop_constraint(_CONSTRAINT, "requests", type_="check")
    for old_value, new_value in _RENAMES:
        op.execute(
            f"UPDATE requests SET category = '{old_value}' "
            f"WHERE category = '{new_value}'"
        )
    _set_width_and_constraint(_OLD)
