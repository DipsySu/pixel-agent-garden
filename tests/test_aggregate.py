import unittest

from local_agent_garden.core.aggregate import summarize
from local_agent_garden.core.events import AgentEvent, parse_datetime


class AggregateTest(unittest.TestCase):
    def test_summarize_groups_by_project(self):
        events = [
            AgentEvent(
                source="codex",
                timestamp=parse_datetime("2026-05-27T09:00:00Z"),
                project_path="/tmp/demo",
                session_id="a",
                total_tokens=1000,
            ),
            AgentEvent(
                source="claude-code",
                timestamp=parse_datetime("2026-05-27T10:00:00Z"),
                project_path="/tmp/demo",
                session_id="b",
                tool_calls=2,
            ),
        ]

        summary = summarize(events)

        self.assertEqual(summary.total_events, 2)
        self.assertEqual(summary.total_tokens, 1000)
        self.assertEqual(len(summary.projects), 1)
        self.assertEqual(summary.projects[0].display_name, "demo")
        self.assertEqual(summary.projects[0].sources["codex"], 1)
        self.assertEqual(summary.projects[0].sources["claude-code"], 1)


if __name__ == "__main__":
    unittest.main()
