from __future__ import annotations

from local_agent_garden.adapters.base import AgentAdapter
from local_agent_garden.adapters.claude_code import ClaudeCodeAdapter
from local_agent_garden.adapters.codex import CodexAdapter
from local_agent_garden.adapters.manual_jsonl import ManualJsonlAdapter


def default_adapters() -> list[AgentAdapter]:
    return [ClaudeCodeAdapter(), CodexAdapter(), ManualJsonlAdapter()]


def get_adapter(name: str) -> AgentAdapter:
    for adapter in default_adapters():
        if adapter.name == name:
            return adapter
    raise KeyError(f"Unknown adapter: {name}")

