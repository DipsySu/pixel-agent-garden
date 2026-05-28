from __future__ import annotations

import math
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

from local_agent_garden.core.events import AgentEvent


@dataclass
class ProjectGrowth:
    project_key: str
    display_name: str
    project_path: str | None = None
    sources: Counter[str] = field(default_factory=Counter)
    sessions: set[str] = field(default_factory=set)
    first_seen: datetime | None = None
    last_seen: datetime | None = None
    total_tokens: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    tool_calls: int = 0
    event_count: int = 0
    daily_activity: Counter[str] = field(default_factory=Counter)
    models: Counter[str] = field(default_factory=Counter)

    @property
    def activity_score(self) -> int:
        token_score = int(math.log10(self.total_tokens + 1) * 18) if self.total_tokens else 0
        event_score = min(260, self.event_count * 2)
        session_score = len(self.sessions) * 10
        tool_score = min(120, self.tool_calls * 3)
        return max(1, token_score + event_score + session_score + tool_score)

    @property
    def stage(self) -> int:
        score = self.activity_score
        if score < 35:
            return 1
        if score < 75:
            return 2
        if score < 125:
            return 3
        if score < 210:
            return 4
        if score < 360:
            return 5
        return 6

    @property
    def recent_activity(self) -> int:
        now = datetime.now(timezone.utc).date()
        total = 0
        for i in range(7):
            total += self.daily_activity.get((now - timedelta(days=i)).isoformat(), 0)
        return total

    @property
    def cache_ratio(self) -> float:
        denominator = self.input_tokens + self.cache_read_tokens + self.cache_write_tokens
        if denominator <= 0:
            return 0.0
        return self.cache_read_tokens / denominator

    def to_json(self) -> dict:
        return {
            "project_key": self.project_key,
            "display_name": self.display_name,
            "project_path": self.project_path,
            "sources": dict(self.sources),
            "sessions": len(self.sessions),
            "first_seen": self.first_seen.isoformat() if self.first_seen else None,
            "last_seen": self.last_seen.isoformat() if self.last_seen else None,
            "total_tokens": self.total_tokens,
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "cache_read_tokens": self.cache_read_tokens,
            "cache_write_tokens": self.cache_write_tokens,
            "tool_calls": self.tool_calls,
            "event_count": self.event_count,
            "daily_activity": dict(self.daily_activity),
            "models": dict(self.models),
            "activity_score": self.activity_score,
            "stage": self.stage,
            "recent_activity": self.recent_activity,
            "cache_ratio": self.cache_ratio,
        }


@dataclass
class GardenSummary:
    projects: list[ProjectGrowth]
    sources: Counter[str]
    total_events: int
    total_tokens: int
    first_seen: datetime | None
    last_seen: datetime | None

    @property
    def active_projects(self) -> int:
        return len(self.projects)

    def to_json(self) -> dict:
        return {
            "projects": [project.to_json() for project in self.projects],
            "sources": dict(self.sources),
            "total_events": self.total_events,
            "total_tokens": self.total_tokens,
            "first_seen": self.first_seen.isoformat() if self.first_seen else None,
            "last_seen": self.last_seen.isoformat() if self.last_seen else None,
            "active_projects": self.active_projects,
        }


def summarize(events: list[AgentEvent]) -> GardenSummary:
    by_project: dict[str, ProjectGrowth] = {}
    sources: Counter[str] = Counter()
    first_seen: datetime | None = None
    last_seen: datetime | None = None

    for event in sorted(events, key=lambda item: item.timestamp):
        key = event.project_key
        project = by_project.get(key)
        if project is None:
            project = ProjectGrowth(
                project_key=key,
                display_name=_display_name(event.project_path, key),
                project_path=event.project_path,
            )
            by_project[key] = project

        project.sources[event.source] += 1
        sources[event.source] += 1
        if event.session_id:
            project.sessions.add(event.session_id)
        project.first_seen = _min_dt(project.first_seen, event.timestamp)
        project.last_seen = _max_dt(project.last_seen, event.timestamp)
        first_seen = _min_dt(first_seen, event.timestamp)
        last_seen = _max_dt(last_seen, event.timestamp)
        project.total_tokens += event.total_tokens
        project.input_tokens += event.input_tokens
        project.output_tokens += event.output_tokens
        project.cache_read_tokens += event.cache_read_tokens
        project.cache_write_tokens += event.cache_write_tokens
        project.tool_calls += event.tool_calls
        project.event_count += 1
        project.daily_activity[event.timestamp.date().isoformat()] += max(
            1, event.total_tokens // 1000 + event.tool_calls
        )
        if event.model:
            project.models[event.model] += 1

    projects = sorted(
        by_project.values(),
        key=lambda item: (item.activity_score, item.last_seen or datetime.min.replace(tzinfo=timezone.utc)),
        reverse=True,
    )
    return GardenSummary(
        projects=projects,
        sources=sources,
        total_events=len(events),
        total_tokens=sum(event.total_tokens for event in events),
        first_seen=first_seen,
        last_seen=last_seen,
    )


def _display_name(project_path: str | None, fallback: str) -> str:
    if project_path:
        name = Path(project_path).name
        return name or project_path
    return fallback.replace("unknown:", "")


def _min_dt(left: datetime | None, right: datetime) -> datetime:
    return right if left is None or right < left else left


def _max_dt(left: datetime | None, right: datetime) -> datetime:
    return right if left is None or right > left else left
