from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path

from local_agent_garden.core.events import AgentEvent


@dataclass(frozen=True)
class AdapterContext:
    home: Path = field(default_factory=Path.home)
    manual_jsonl: tuple[Path, ...] = ()


class AgentAdapter(ABC):
    name: str

    @abstractmethod
    def discover(self, context: AdapterContext) -> bool:
        """Return True when this adapter has local data to read."""

    @abstractmethod
    def collect(self, context: AdapterContext) -> list[AgentEvent]:
        """Read local data and return normalized events."""

