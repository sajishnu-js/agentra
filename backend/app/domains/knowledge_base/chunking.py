"""Word-window chunking.

Deliberately simple: a sliding window over whitespace-separated words. It is
language-agnostic, which matters because these documents are a mix of English
and Arabic, and it has no tokeniser to keep in sync with the embedding model.

The obvious refinement later is to respect paragraph and heading boundaries so
a chunk never straddles two unrelated sections. That needs the element
structure from parsing, not just the flattened text, so it is a separate change.
"""

from dataclasses import dataclass

# ~300 words with ~50 overlapping, as specced. At roughly 1.3 tokens per
# English word this lands near 400 tokens — comfortably inside the 8192-token
# window of bge-m3, with room for much longer Arabic words.
CHUNK_WORDS = 300
CHUNK_OVERLAP_WORDS = 50


@dataclass(frozen=True)
class Chunk:
    index: int
    text: str
    word_count: int


def chunk_text(
    text: str,
    size: int = CHUNK_WORDS,
    overlap: int = CHUNK_OVERLAP_WORDS,
) -> list[Chunk]:
    """Split text into overlapping word windows.

    Raises on a non-advancing window rather than looping forever, which is what
    an overlap >= size would otherwise do.
    """
    if size <= 0:
        raise ValueError("size must be positive")
    if overlap < 0:
        raise ValueError("overlap cannot be negative")
    if overlap >= size:
        raise ValueError(f"overlap ({overlap}) must be smaller than size ({size})")

    words = text.split()
    if not words:
        return []

    step = size - overlap
    chunks: list[Chunk] = []

    for start in range(0, len(words), step):
        window = words[start : start + size]
        if not window:
            break
        chunks.append(
            Chunk(index=len(chunks), text=" ".join(window), word_count=len(window))
        )
        # Stop once the window has reached the end, otherwise the last few
        # words get re-emitted as ever-shorter tail chunks.
        if start + size >= len(words):
            break

    return chunks
