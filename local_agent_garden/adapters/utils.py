from __future__ import annotations

import json
from pathlib import Path
from typing import Iterator


def read_jsonl(path: Path) -> Iterator[dict]:
    try:
        with path.open("r", encoding="utf-8") as handle:
            for line_no, line in enumerate(handle, start=1):
                text = line.strip()
                if not text:
                    continue
                try:
                    value = json.loads(text)
                except json.JSONDecodeError:
                    continue
                if isinstance(value, dict):
                    value["_line_no"] = line_no
                    yield value
    except OSError:
        return


def project_from_claude_dir(path: Path) -> str | None:
    name = path.name
    if not name.startswith("-"):
        return None
    parts = [part for part in name.split("-") if part]
    if not parts:
        return None
    return "/" + "/".join(parts)


def as_int(value: object) -> int:
    if value is None:
        return 0
    try:
        return max(0, int(value))
    except (TypeError, ValueError):
        return 0

