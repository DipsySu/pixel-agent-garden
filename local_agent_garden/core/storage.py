from __future__ import annotations

import json
from pathlib import Path

from local_agent_garden.core.events import AgentEvent


def default_state_dir() -> Path:
    return Path.home() / ".local-agent-garden"


def save_events(events: list[AgentEvent], path: Path) -> None:
    path = path.expanduser()
    path.parent.mkdir(parents=True, exist_ok=True)
    data = [event.to_json() for event in sorted(events, key=lambda item: item.timestamp)]
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def load_events(path: Path) -> list[AgentEvent]:
    path = path.expanduser()
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise ValueError(f"Expected a JSON list in {path}")
    return [AgentEvent.from_json(item) for item in data if isinstance(item, dict)]

