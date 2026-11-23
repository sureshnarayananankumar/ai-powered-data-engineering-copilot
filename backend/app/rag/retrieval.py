"""Minimal, dependency-free retrieval for local development.

Documents in `knowledge_base/sample_docs` are chunked by heading and scored with
a simple keyword overlap. This keeps tests deterministic. Swap `search` for a
ChromaDB + embeddings implementation in Milestone 3 (see README).
"""
import re
from dataclasses import dataclass
from pathlib import Path

from app.config.settings import get_settings

WORD = re.compile(r"[a-z0-9_]+")
STOP = {"the", "a", "an", "is", "of", "to", "and", "in", "what", "how", "does", "do", "for", "on", "it", "this"}


@dataclass
class Chunk:
    source: str
    section: str
    text: str


def _tokens(text: str) -> set[str]:
    return {w for w in WORD.findall(text.lower()) if w not in STOP and len(w) > 2}


def load_chunks(base_dir: str | None = None) -> list[Chunk]:
    base = Path(base_dir or get_settings().knowledge_base_dir)
    if not base.is_absolute():
        base = (Path(__file__).resolve().parents[2] / base).resolve()
    chunks: list[Chunk] = []
    for path in sorted(base.glob("**/*")):
        if path.suffix.lower() not in {".md", ".txt", ".sql", ".yml", ".yaml"}:
            continue
        section, buf = "Introduction", []
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.startswith("#"):
                if buf:
                    chunks.append(Chunk(path.name, section, "\n".join(buf).strip()))
                section, buf = line.lstrip("# ").strip(), []
            else:
                buf.append(line)
        if buf:
            chunks.append(Chunk(path.name, section, "\n".join(buf).strip()))
    return [c for c in chunks if c.text]


def search(query: str, k: int = 3, base_dir: str | None = None) -> list[tuple[Chunk, float]]:
    q = _tokens(query)
    if not q:
        return []
    scored = []
    for c in load_chunks(base_dir):
        overlap = len(q & _tokens(c.section + " " + c.text))
        if overlap:
            scored.append((c, overlap / len(q)))
    scored.sort(key=lambda x: x[1], reverse=True)
    return scored[:k]
