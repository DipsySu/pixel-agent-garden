import unittest
from datetime import timezone

from local_agent_garden.core.events import AgentEvent, parse_datetime
from local_agent_garden.core.usage import parse_day, summarize_daily_usage


class UsageTest(unittest.TestCase):
    def test_summarize_daily_usage_groups_sources_and_projects(self):
        events = [
            AgentEvent(
                source="codex",
                timestamp=parse_datetime("2026-05-27T02:00:00Z"),
                project_path="/tmp/demo",
                session_id="a",
                total_tokens=100,
            ),
            AgentEvent(
                source="claude-code",
                timestamp=parse_datetime("2026-05-27T03:00:00Z"),
                project_path="/tmp/demo",
                session_id="b",
                input_tokens=20,
                output_tokens=5,
            ),
            AgentEvent(
                source="codex",
                timestamp=parse_datetime("2026-05-28T02:00:00Z"),
                project_path="/tmp/other",
                total_tokens=999,
            ),
        ]

        report = summarize_daily_usage(events, parse_day("2026-05-27"), timezone.utc)

        self.assertEqual(report.total.total_tokens, 125)
        self.assertEqual(report.total.event_count, 2)
        self.assertEqual(report.by_source[0].label, "codex")
        self.assertEqual(report.by_source[0].total_tokens, 100)
        self.assertEqual(report.by_project[0].label, "demo")
        self.assertEqual(report.by_project[0].sources["claude-code"], 1)

    def test_parse_day_accepts_relative_names(self):
        now = parse_datetime("2026-05-28T10:00:00+08:00")

        self.assertEqual(parse_day("today", now).isoformat(), "2026-05-28")
        self.assertEqual(parse_day("yesterday", now).isoformat(), "2026-05-27")


if __name__ == "__main__":
    unittest.main()
