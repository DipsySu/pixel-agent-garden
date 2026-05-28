from __future__ import annotations

import sqlite3
from pathlib import Path

from local_agent_garden.adapters.base import AdapterContext, AgentAdapter
from local_agent_garden.adapters.utils import as_int, read_jsonl
from local_agent_garden.core.events import AgentEvent, parse_datetime


class CodexAdapter(AgentAdapter):
    name = "codex"

    def discover(self, context: AdapterContext) -> bool:
        root = context.home / ".codex"
        return (root / "state_5.sqlite").exists() or (root / "session_index.jsonl").exists()

    def collect(self, context: AdapterContext) -> list[AgentEvent]:
        root = context.home / ".codex"
        events: list[AgentEvent] = []
        events.extend(self._read_threads_db(root / "state_5.sqlite"))
        seen_sessions = {event.session_id for event in events if event.session_id}
        events.extend(self._read_session_index(root / "session_index.jsonl", seen_sessions))
        events.extend(self._read_rollouts(root, seen_sessions))
        return events

    def _read_threads_db(self, db_path: Path) -> list[AgentEvent]:
        if not db_path.exists():
            return []
        events: list[AgentEvent] = []
        try:
            con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
            con.row_factory = sqlite3.Row
            rows = con.execute(
                """
                select id, rollout_path, created_at, updated_at, source, model_provider,
                       cwd, title, tokens_used, cli_version, model, reasoning_effort,
                       git_branch, first_user_message, archived
                from threads
                """
            )
            for row in rows:
                updated = row["updated_at"] or row["created_at"]
                events.append(
                    AgentEvent(
                        source=self.name,
                        timestamp=parse_datetime(updated),
                        project_path=row["cwd"],
                        session_id=row["id"],
                        event_type="thread",
                        total_tokens=as_int(row["tokens_used"]),
                        model=row["model"],
                        raw_ref=str(row["rollout_path"] or db_path),
                        metadata={
                            "codex_source": row["source"],
                            "model_provider": row["model_provider"],
                            "cli_version": row["cli_version"],
                            "reasoning_effort": row["reasoning_effort"],
                            "git_branch": row["git_branch"],
                            "archived": bool(row["archived"]),
                            "title": _shorten(row["title"] or row["first_user_message"]),
                        },
                    )
                )
        except sqlite3.Error:
            return events
        finally:
            try:
                con.close()
            except UnboundLocalError:
                pass
        return events

    def _read_session_index(self, path: Path, seen_sessions: set[str]) -> list[AgentEvent]:
        events: list[AgentEvent] = []
        if not path.exists():
            return events
        for row in read_jsonl(path):
            session_id = row.get("id")
            if not session_id or session_id in seen_sessions:
                continue
            timestamp = row.get("updated_at")
            if not timestamp:
                continue
            events.append(
                AgentEvent(
                    source=self.name,
                    timestamp=parse_datetime(timestamp),
                    session_id=session_id,
                    event_type="session-index",
                    raw_ref=f"{path}:{row.get('_line_no')}",
                    metadata={"title": _shorten(row.get("thread_name"))},
                )
            )
        return events

    def _read_rollouts(self, root: Path, seen_sessions: set[str]) -> list[AgentEvent]:
        events: list[AgentEvent] = []
        candidates = list((root / "archived_sessions").glob("*.jsonl"))
        candidates += list((root / "sessions").glob("*/*/*/*.jsonl"))
        for path in sorted(candidates):
            session_id = _session_id_from_rollout(path)
            if session_id in seen_sessions:
                continue
            meta: dict = {}
            token_total = 0
            tool_calls = 0
            last_ts = None
            model = None
            for row in read_jsonl(path):
                last_ts = row.get("timestamp") or last_ts
                payload = row.get("payload") if isinstance(row.get("payload"), dict) else {}
                if row.get("type") == "session_meta":
                    meta.update(payload)
                if row.get("type") == "turn_context":
                    model = payload.get("model") or model
                    meta["cwd"] = payload.get("cwd") or meta.get("cwd")
                if row.get("type") == "response_item" and payload.get("type") == "function_call":
                    tool_calls += 1
                if payload.get("type") == "token_count":
                    token_total += _extract_token_total(payload)
                info = payload.get("info")
                if isinstance(info, dict):
                    token_total += _extract_token_total(info)
            if last_ts or meta.get("timestamp"):
                events.append(
                    AgentEvent(
                        source=self.name,
                        timestamp=parse_datetime(last_ts or meta.get("timestamp")),
                        project_path=meta.get("cwd"),
                        session_id=session_id,
                        event_type="rollout",
                        total_tokens=token_total,
                        tool_calls=tool_calls,
                        model=model,
                        raw_ref=str(path),
                        metadata={"cli_version": meta.get("cli_version")},
                    )
                )
        return events


def _session_id_from_rollout(path: Path) -> str:
    name = path.stem
    marker = "rollout-"
    if name.startswith(marker):
        return name.split("-")[-5] + "-" + "-".join(name.split("-")[-4:])
    return name


def _extract_token_total(data: dict) -> int:
    keys = ("total_tokens", "tokens_used", "input_tokens", "output_tokens", "cached_tokens")
    total = sum(as_int(data.get(key)) for key in keys)
    usage = data.get("usage")
    if isinstance(usage, dict):
        total += _extract_token_total(usage)
    return total


def _shorten(value: object, limit: int = 120) -> str | None:
    if not value:
        return None
    text = " ".join(str(value).split())
    return text if len(text) <= limit else text[: limit - 1] + "..."

