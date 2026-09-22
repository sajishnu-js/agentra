"""add instagram and email channels

Hand-written on purpose. alembic/env.py filters Enum-generated CHECK
constraints out of autogenerate — see the note there — because Alembic
otherwise proposes dropping every one of them. The cost of that decision is
exactly this: adding a value to an enum means swapping the constraint by hand.

Two tables share the `channel` enum (contacts.channel, inboxes.channel), each
with its own CHECK constraint named `channel` (constraint names only need to
be unique within a table) — both need the resize-and-swap.

Revision ID: dd2d51562ce6
Revises: 87f6209f54f7
Create Date: 2026-08-29

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'dd2d51562ce6'
down_revision: Union[str, None] = '87f6209f54f7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Keep in sync with Channel in app/domains/contacts/models.py.
_OLD = ("telegram", "whatsapp")
_NEW = _OLD + ("instagram", "email")

_CONSTRAINT = "channel"
_TABLES = ("contacts", "inboxes")


def _swap(values: tuple[str, ...]) -> None:
    width = max(len(value) for value in values)
    allowed = ", ".join(f"'{value}'" for value in values)
    for table in _TABLES:
        op.alter_column(
            table, "channel", type_=sa.String(length=width), existing_nullable=False
        )
        op.drop_constraint(_CONSTRAINT, table, type_="check")
        op.create_check_constraint(_CONSTRAINT, table, f"channel IN ({allowed})")


def upgrade() -> None:
    _swap(_NEW)


def downgrade() -> None:
    # Any row already using a new value would violate the old constraint and
    # would not fit the narrower column, so fold those back first. There is
    # no sensible old-channel equivalent for either — falling back to
    # 'telegram' just keeps the row valid, the same choice the human_request
    # downgrade made for an equally un-mappable value.
    for table in _TABLES:
        op.execute(
            f"UPDATE {table} SET channel = 'telegram' WHERE channel IN ('instagram', 'email')"
        )
    _swap(_OLD)
