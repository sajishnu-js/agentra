from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.core.database import get_db
from app.domains.audit.service import record_audit
from app.domains.auth.dependencies import get_current_user
from app.domains.contacts.models import Contact, ContactNote
from app.domains.contacts.schemas import ContactNoteCreate, ContactNoteRead, ContactRead
from app.domains.users.models import User, UserRole

router = APIRouter(prefix="/contacts", tags=["contacts"])


@router.get("", response_model=list[ContactRead])
async def list_contacts(db: AsyncSession = Depends(get_db)) -> list[Contact]:
    result = await db.execute(select(Contact).order_by(Contact.created_at.desc()))
    return list(result.scalars())


async def _get_contact_or_404(db: AsyncSession, contact_id: UUID) -> Contact:
    contact = await db.get(Contact, contact_id)
    if contact is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Contact not found")
    return contact


@router.get("/{contact_id}/notes", response_model=list[ContactNoteRead])
async def list_contact_notes(
    contact_id: UUID, db: AsyncSession = Depends(get_db)
) -> list[dict]:
    await _get_contact_or_404(db, contact_id)

    author = aliased(User)
    result = await db.execute(
        select(ContactNote, author)
        .outerjoin(author, author.id == ContactNote.author_user_id)
        .where(ContactNote.contact_id == contact_id)
        .order_by(ContactNote.created_at.desc())
    )
    return [
        {
            "id": note.id,
            "contact_id": note.contact_id,
            "author": author_row,
            "text": note.text,
            "created_at": note.created_at,
        }
        for note, author_row in result.all()
    ]


@router.post(
    "/{contact_id}/notes",
    response_model=ContactNoteRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_contact_note(
    contact_id: UUID,
    payload: ContactNoteCreate,
    actor: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    contact = await _get_contact_or_404(db, contact_id)

    note = ContactNote(contact_id=contact.id, author_user_id=actor.id, text=payload.text.strip())
    db.add(note)
    await db.flush()
    await record_audit(
        db,
        actor=actor,
        action="create",
        entity_type="contact_note",
        entity_id=note.id,
        summary=f"{actor.name} added a note on {contact.name}",
    )
    return {
        "id": note.id,
        "contact_id": note.contact_id,
        "author": actor,
        "text": note.text,
        "created_at": note.created_at,
    }


@router.delete(
    "/{contact_id}/notes/{note_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def delete_contact_note(
    contact_id: UUID,
    note_id: UUID,
    actor: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    note = await db.get(ContactNote, note_id)
    if note is None or note.contact_id != contact_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Note not found")

    # Same author-or-admin-tier boundary as everywhere else a person's own
    # content can be removed by someone else — see require_staff's docstring
    # in auth/dependencies.py. No new permission string: this isn't an
    # admin-configurable grant, just "you wrote it, or you outrank it."
    is_author = note.author_user_id == actor.id
    is_staff = actor.role in (UserRole.super_admin, UserRole.admin)
    if not is_author and not is_staff:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Only the note's author or an admin can delete it",
        )

    await record_audit(
        db,
        actor=actor,
        action="delete",
        entity_type="contact_note",
        entity_id=note.id,
        summary=f"{actor.name} deleted a note",
    )
    await db.delete(note)
    await db.flush()
