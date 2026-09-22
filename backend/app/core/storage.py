"""Local-disk storage for user-uploaded files (KB documents, message attachments).

Files are written under `UPLOAD_ROOT` with a random filename that keeps the
original extension — never the browser-supplied filename verbatim, so a
path-traversal attempt or a collision in that name can never reach the
filesystem. The original filename is preserved separately (a DB column) for
display. Anchored to this file's own location rather than the process's
working directory, so it resolves the same way whether uvicorn is started
from `backend/` or anywhere else.
"""

import uuid
from pathlib import Path

from fastapi import UploadFile

from app.core.config import settings

BACKEND_ROOT = Path(__file__).resolve().parent.parent.parent
UPLOAD_ROOT = (BACKEND_ROOT / settings.upload_dir).resolve()

# Generous but bounded: large enough for real business documents/attachments,
# small enough that one upload can't exhaust disk space.
MAX_UPLOAD_BYTES = 25 * 1024 * 1024


class UploadTooLarge(Exception):
    """The uploaded file exceeded MAX_UPLOAD_BYTES."""


def _subdir(category: str) -> Path:
    directory = UPLOAD_ROOT / category
    directory.mkdir(parents=True, exist_ok=True)
    return directory


async def save_upload(file: UploadFile, *, category: str) -> tuple[Path, int]:
    """Stream an uploaded file to disk under `category`.

    Returns the path it was written to and its size in bytes. Streamed in
    chunks rather than `await file.read()` in one call, so a very large
    upload cannot balloon memory — and aborted (over MAX_UPLOAD_BYTES) before
    a runaway file fills the disk, deleting the partial write on the way out.
    """
    suffix = Path(file.filename or "").suffix
    disk_name = f"{uuid.uuid4().hex}{suffix}"
    destination = _subdir(category) / disk_name
    size = 0
    with destination.open("wb") as out:
        while chunk := await file.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_UPLOAD_BYTES:
                out.close()
                destination.unlink(missing_ok=True)
                raise UploadTooLarge(
                    f"File exceeds the {MAX_UPLOAD_BYTES // (1024 * 1024)} MB upload limit"
                )
            out.write(chunk)
    return destination, size


def delete_upload(path: Path | str | None) -> None:
    """Best-effort delete — a missing file is not an error; the DB row (or
    its absence) is the source of truth, this is just reclaiming disk space.

    Silently refuses to touch anything outside UPLOAD_ROOT: `source_path` can
    point anywhere on disk for documents ingested by the CLI folder tool
    before this endpoint existed, and a delete action here must never be able
    to remove a file this app did not itself write.
    """
    if not path:
        return
    resolved = Path(path).resolve()
    try:
        resolved.relative_to(UPLOAD_ROOT)
    except ValueError:
        return
    try:
        resolved.unlink(missing_ok=True)
    except OSError:
        pass


def absolute_url(path: Path | str | None) -> str | None:
    """`public_url` prefixed with settings.public_base_url.

    None whenever either half is missing — a relative /uploads/... path
    means nothing to a customer's phone, so a channel adapter that needs a
    real, reachable URL (Instagram's Send API; any channel's plain-text
    attachment fallback) must treat this exactly like an unconfigured
    credential, not silently send a broken link.
    """
    relative = public_url(path)
    if not relative or not settings.public_base_url:
        return None
    return f"{settings.public_base_url}{relative}"


def path_from_url(url: str) -> Path:
    """The reverse of public_url — the real disk path a `/uploads/...` URL
    this app generated corresponds to, so a row that only stored the URL
    (message attachments) can still be found again on disk for cleanup."""
    return UPLOAD_ROOT / url.removeprefix("/uploads/")


def public_url(path: Path | str | None) -> str | None:
    """The `/uploads/...` URL StaticFiles serves this path at.

    Returns None for anything outside UPLOAD_ROOT — legacy documents ingested
    by the CLI from an arbitrary folder have a real `source_path` that was
    never written here, so there is genuinely no URL to serve them at.
    """
    if not path:
        return None
    try:
        relative = Path(path).resolve().relative_to(UPLOAD_ROOT)
    except ValueError:
        return None
    return f"/uploads/{relative.as_posix()}"
