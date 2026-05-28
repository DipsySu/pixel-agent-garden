from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from datetime import date, datetime, tzinfo

from local_agent_garden.core.events import AgentEvent


@dataclass
class UsageBucket:
    key: str
    label: str
    total_tokens: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    event_count: int = 0
    sessions: set[str] = field(default_factory=set)
    sources: Counter[str] = field(default_factory=Counter)

    def add(self, event: AgentEvent) -> None:
        self.total_tokens += event.total_tokens
        self.input_tokens += event.input_tokens
        self.output_tokens += event.output_tokens
        self.cache_read_tokens += event.cache_read_tokens
        self.cache_write_tokens += event.cache_write_tokens
        self.event_count += 1
        self.sources[event.source] += 1
        if event.session_id:
            self.sessions.add(event.session_id)

    def to_json(self) -> dict:
        return {
            "key": self.key,
            "label": self.label,
            "total_tokens": self.total_tokens,
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "cache_read_tokens": self.cache_read_tokens,
            "cache_write_tokens": self.cache_write_tokens,
            "event_count": self.event_count,
            "sessions": len(self.sessions),
            "sources": dict(self.sources),
        }


@dataclass
class DailyUsage:
    day: date
    total: UsageBucket
    by_source: list[UsageBucket]
    by_project: list[UsageBucket]

    def to_json(self) -> dict:
        return {
            "date": self.day.isoformat(),
            "total": self.total.to_json(),
            "by_source": [bucket.to_json() for bucket in self.by_source],
            "by_project": [bucket.to_json() for bucket in self.by_project],
        }


def summarize_daily_usage(events: list[AgentEvent], day: date, tz: tzinfo | None = None) -> DailyUsage:
    total = UsageBucket(key="all", label="all agents")
    by_source: dict[str, UsageBucket] = {}
    by_project: dict[str, UsageBucket] = {}

    for event in events:
        local_timestamp = event.timestamp.astimezone(tz) if tz else event.timestamp.astimezone()
        if local_timestamp.date() != day:
            continue

        total.add(event)

        source_bucket = by_source.setdefault(
            event.source,
            UsageBucket(key=event.source, label=event.source),
        )
        source_bucket.add(event)

        project_key = event.project_key
        project_bucket = by_project.setdefault(
            project_key,
            UsageBucket(key=project_key, label=_project_label(event)),
        )
        project_bucket.add(event)

    return DailyUsage(
        day=day,
        total=total,
        by_source=sorted(by_source.values(), key=lambda item: item.total_tokens, reverse=True),
        by_project=sorted(by_project.values(), key=lambda item: item.total_tokens, reverse=True),
    )


def parse_day(value: str | None, now: datetime | None = None) -> date:
    if not value or value == "today":
        return (now or datetime.now().astimezone()).date()
    if value == "yesterday":
        base = (now or datetime.now().astimezone()).date()
        return date.fromordinal(base.toordinal() - 1)
    return date.fromisoformat(value)


def _project_label(event: AgentEvent) -> str:
    if event.project_path:
        return event.project_path.rstrip("/").split("/")[-1] or event.project_path
    return event.project_key.replace("unknown:", "")
