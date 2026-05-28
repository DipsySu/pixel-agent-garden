from __future__ import annotations

from pathlib import Path

from local_agent_garden.adapters.base import AdapterContext
from local_agent_garden.adapters.registry import default_adapters, get_adapter
from local_agent_garden.core.events import AgentEvent


def collect_events(
    sources: list[str] | None = None,
    manual_jsonl: list[Path] | None = None,
    home: Path | None = None,
) -> tuple[list[AgentEvent], list[str]]:
    context = AdapterContext(
        home=home or Path.home(),
        manual_jsonl=tuple(manual_jsonl or ()),
    )
    adapters = [get_adapter(name) for name in sources] if sources else default_adapters()
    events: list[AgentEvent] = []
    used: list[str] = []
    for adapter in adapters:
        if not adapter.discover(context):
            continue
        collected = adapter.collect(context)
        if collected:
            events.extend(collected)
            used.append(adapter.name)
    return _dedupe(events), used


def _dedupe(events: list[AgentEvent]) -> list[AgentEvent]:
    seen: set[tuple] = set()
    unique: list[AgentEvent] = []
    for event in sorted(events, key=lambda item: (item.timestamp, item.source, item.raw_ref or "")):
        key = (
            event.source,
            event.timestamp.isoformat(),
            event.project_key,
            event.session_id,
            event.event_type,
            event.total_tokens,
            event.raw_ref,
        )
        if key in seen:
            continue
        seen.add(key)
        unique.append(event)
    return unique

