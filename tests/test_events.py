import unittest
from datetime import timezone

from local_agent_garden.core.events import AgentEvent, parse_datetime


class EventsTest(unittest.TestCase):
    def test_parse_datetime_accepts_iso_z(self):
        value = parse_datetime("2026-05-27T09:00:00Z")

        self.assertEqual(value.tzinfo, timezone.utc)
        self.assertEqual(value.isoformat(), "2026-05-27T09:00:00+00:00")

    def test_agent_event_computes_total_tokens(self):
        event = AgentEvent(
            source="demo",
            timestamp=parse_datetime("2026-05-27T09:00:00Z"),
            input_tokens=10,
            output_tokens=5,
            cache_read_tokens=3,
            cache_write_tokens=2,
        )

        self.assertEqual(event.total_tokens, 20)


if __name__ == "__main__":
    unittest.main()
