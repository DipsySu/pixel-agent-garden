import tempfile
import unittest
from pathlib import Path

from local_agent_garden.adapters.base import AdapterContext
from local_agent_garden.adapters.manual_jsonl import ManualJsonlAdapter


class ManualJsonlTest(unittest.TestCase):
    def test_collects_manual_events(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "events.jsonl"
            path.write_text(
                '{"source":"aider","timestamp":"2026-05-27T09:00:00Z",'
                '"project_path":"/tmp/demo","total_tokens":42}\n',
                encoding="utf-8",
            )

            events = ManualJsonlAdapter().collect(AdapterContext(manual_jsonl=(path,)))

        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].source, "aider")
        self.assertEqual(events[0].project_path, "/tmp/demo")
        self.assertEqual(events[0].total_tokens, 42)


if __name__ == "__main__":
    unittest.main()
