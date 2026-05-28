from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class AgentEvent:
    source: str
    timestamp: datetime
    project_path: str | None = None
    session_id: str | None = None
    event_type: str = "activity"
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    total_tokens: int = 0
    tool_calls: int = 0
    model: str | None = None
    files_touched: tuple[str, ...] = ()
    cost_usd: float | None = None
    raw_ref: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.total_tokens <= 0:
            total = (
                self.input_tokens
                + self.output_tokens
                + self.cache_read_tokens
                + self.cache_write_tokens
            )
            object.__setattr__(self, "total_tokens", total)

    @property
    def project_key(self) -> str:
        if self.project_path:
            return str(Path(self.project_path).expanduser())
        return f"unknown:{self.source}"

    def to_json(self) -> dict[str, Any]:
        data = asdict(self)
        data["timestamp"] = self.timestamp.astimezone(timezone.utc).isoformat()
        data["files_touched"] = list(self.files_touched)
        return data

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> "AgentEvent":
        clean = dict(data)
        ts = clean.get("timestamp")
        clean["timestamp"] = parse_datetime(ts) if not isinstance(ts, datetime) else ts
        clean["files_touched"] = tuple(clean.get("files_touched") or ())
        return cls(**clean)


def parse_datetime(value: Any) -> datetime:
    if isinstance(value, datetime):
        dt = value
    elif isinstance(value, (int, float)):
        dt = datetime.fromtimestamp(_normalize_epoch(value), tz=timezone.utc)
    elif isinstance(value, str):
        text = value.strip()
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        try:
            dt = datetime.fromisoformat(text)
        except ValueError:
            if text.isdigit():
                dt = datetime.fromtimestamp(_normalize_epoch(int(text)), tz=timezone.utc)
            else:
                raise
    else:
        raise ValueError(f"Unsupported timestamp: {value!r}")

    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _normalize_epoch(value: int | float) -> float:
    if value > 10_000_000_000_000:
        return value / 1000
    if value > 10_000_000_000:
        return value / 1000
    return float(value)

