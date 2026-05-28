from __future__ import annotations

from pathlib import Path

from local_agent_garden.adapters.base import AdapterContext, AgentAdapter
from local_agent_garden.adapters.utils import as_int, project_from_claude_dir, read_jsonl
from local_agent_garden.core.events import AgentEvent, parse_datetime


class ClaudeCodeAdapter(AgentAdapter):
    name = "claude-code"

    def discover(self, context: AdapterContext) -> bool:
        return (context.home / ".claude" / "projects").exists()

    def collect(self, context: AdapterContext) -> list[AgentEvent]:
        root = context.home / ".claude" / "projects"
        events: list[AgentEvent] = []
        for path in sorted(root.glob("*/*.jsonl")):
            project_path = project_from_claude_dir(path.parent)
            session_id = path.stem
            events.extend(self._read_session(path, project_path, session_id))
        return events

    def _read_session(
        self, path: Path, project_path: str | None, fallback_session_id: str
    ) -> list[AgentEvent]:
        events: list[AgentEvent] = []
        for row in read_jsonl(path):
            timestamp = row.get("timestamp")
            if not timestamp:
                continue
            message = row.get("message") if isinstance(row.get("message"), dict) else {}
            usage = message.get("usage") if isinstance(message.get("usage"), dict) else {}
            content = message.get("content")
            tool_calls = _count_tool_uses(content)
            input_tokens = as_int(usage.get("input_tokens"))
            output_tokens = as_int(usage.get("output_tokens"))
            cache_read = as_int(usage.get("cache_read_input_tokens"))
            cache_write = as_int(usage.get("cache_creation_input_tokens"))
            if not any([input_tokens, output_tokens, cache_read, cache_write, tool_calls]):
                if row.get("type") not in {"user", "assistant"}:
                    continue

            events.append(
                AgentEvent(
                    source=self.name,
                    timestamp=parse_datetime(timestamp),
                    project_path=row.get("cwd") or project_path,
                    session_id=row.get("sessionId") or fallback_session_id,
                    event_type=row.get("type") or "message",
                    input_tokens=input_tokens,
                    output_tokens=output_tokens,
                    cache_read_tokens=cache_read,
                    cache_write_tokens=cache_write,
                    tool_calls=tool_calls,
                    model=message.get("model"),
                    raw_ref=f"{path}:{row.get('_line_no')}",
                    metadata={"git_branch": row.get("gitBranch")},
                )
            )
        return events


def _count_tool_uses(content: object) -> int:
    if not isinstance(content, list):
        return 0
    count = 0
    for item in content:
        if isinstance(item, dict) and item.get("type") in {"tool_use", "server_tool_use"}:
            count += 1
    return count

