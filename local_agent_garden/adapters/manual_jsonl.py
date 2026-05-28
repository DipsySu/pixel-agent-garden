from __future__ import annotations

from local_agent_garden.adapters.base import AdapterContext, AgentAdapter
from local_agent_garden.adapters.utils import as_int, read_jsonl
from local_agent_garden.core.events import AgentEvent, parse_datetime


class ManualJsonlAdapter(AgentAdapter):
    name = "manual-jsonl"

    def discover(self, context: AdapterContext) -> bool:
        return bool(context.manual_jsonl)

    def collect(self, context: AdapterContext) -> list[AgentEvent]:
        events: list[AgentEvent] = []
        for path in context.manual_jsonl:
            for row in read_jsonl(path.expanduser()):
                source = str(row.get("source") or self.name)
                timestamp = row.get("timestamp")
                if not timestamp:
                    continue
                events.append(
                    AgentEvent(
                        source=source,
                        timestamp=parse_datetime(timestamp),
                        project_path=row.get("project_path") or row.get("cwd"),
                        session_id=row.get("session_id"),
                        event_type=row.get("event_type") or "manual",
                        input_tokens=as_int(row.get("input_tokens")),
                        output_tokens=as_int(row.get("output_tokens")),
                        cache_read_tokens=as_int(row.get("cache_read_tokens")),
                        cache_write_tokens=as_int(row.get("cache_write_tokens")),
                        total_tokens=as_int(row.get("total_tokens")),
                        tool_calls=as_int(row.get("tool_calls")),
                        model=row.get("model"),
                        raw_ref=f"{path}:{row.get('_line_no')}",
                    )
                )
        return events

