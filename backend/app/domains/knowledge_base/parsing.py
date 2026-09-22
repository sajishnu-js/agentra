"""Document parsing via unstructured.

Only .docx and .pdf are handled. Anything else in a folder is reported as
skipped rather than guessed at.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from pathlib import Path

from app.domains.knowledge_base.models import SourceType

SUFFIX_TO_SOURCE_TYPE = {
    ".docx": SourceType.docx,
    ".pdf": SourceType.pdf,
}

# unstructured labels running heads, feet and page numbers. They repeat on
# every page and carry no answer, so they are dropped before chunking.
NOISE_CATEGORIES = {"Header", "Footer", "PageNumber", "PageBreak"}

# Arabic, Persian and Urdu ranges. Enough to tell an Arabic document from an
# English one, which is all `language` is used for.
ARABIC_SCRIPT = re.compile(r"[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿]")


@dataclass
class ParsedDocument:
    title: str
    source_type: SourceType
    language: str | None
    text: str
    element_count: int
    content_hash: str


class UnsupportedDocument(Exception):
    """The file extension is not one we parse."""


def is_supported(path: Path) -> bool:
    return path.suffix.lower() in SUFFIX_TO_SOURCE_TYPE


def detect_language(text: str) -> str | None:
    """'ar' or 'en', by counting Arabic-script characters.

    A ratio rather than "contains any Arabic", because these documents mix
    scripts — an English price list with a couple of Arabic treatment names is
    still an English document. Returns None for text with no letters at all.
    """
    letters = [character for character in text if character.isalpha()]
    if not letters:
        return None
    arabic = sum(1 for character in letters if ARABIC_SCRIPT.match(character))
    return "ar" if arabic / len(letters) > 0.2 else "en"


def content_hash(path: Path) -> str:
    """SHA-256 of the file bytes, used to skip unchanged files on re-ingest."""
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def title_from_path(path: Path) -> str:
    """Filename without extension, tidied into something readable.

    Exported (not `_`-prefixed): callers that save an upload under a random
    on-disk name — to keep the original browser-supplied filename out of the
    filesystem path entirely — still need to derive a human title from the
    name the user actually typed, by calling this on `Path(original_name)`
    rather than the on-disk path.
    """
    stem = path.stem.replace("_", " ").replace("-", " ")
    return re.sub(r"\s+", " ", stem).strip()


def parse_file(path: Path) -> ParsedDocument:
    """Extract plain text from one .docx or .pdf."""
    suffix = path.suffix.lower()
    source_type = SUFFIX_TO_SOURCE_TYPE.get(suffix)
    if source_type is None:
        raise UnsupportedDocument(f"{path.name}: {suffix or 'no extension'} not supported")

    # Imported here, not at module scope: unstructured is slow to import and
    # the API process never parses anything.
    if source_type is SourceType.docx:
        from unstructured.partition.docx import partition_docx

        elements = partition_docx(filename=str(path))
    else:
        from unstructured.partition.pdf import partition_pdf

        # strategy="fast" reads the embedded text layer. It is the right choice
        # for digitally generated PDFs and needs no OCR dependencies. A scanned
        # PDF will come back empty here, which the caller reports rather than
        # silently storing nothing — switching those to strategy="hi_res"
        # requires tesseract and the unstructured inference extras.
        # languages only matters if OCR kicks in, but stating it documents
        # what these documents actually contain and silences a warning.
        elements = partition_pdf(
            filename=str(path), strategy="fast", languages=["eng", "ara"]
        )

    blocks: list[str] = []
    for element in elements:
        if element.category in NOISE_CATEGORIES:
            continue
        text = (element.text or "").strip()
        if text:
            blocks.append(text)

    body = "\n\n".join(blocks)

    return ParsedDocument(
        title=title_from_path(path),
        source_type=source_type,
        language=detect_language(body),
        text=body,
        element_count=len(elements),
        content_hash=content_hash(path),
    )
