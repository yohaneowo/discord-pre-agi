import json
import pathlib
import tempfile
import unittest

from migrate_group_memory import directory, migrate


def note(scope, record_id, text):
    return "---\n" + json.dumps({"id": record_id, "type": "memory", "scope": scope, "at": "2026-10-28T00:00:00.000Z"}) + "\n---\n" + text + "\n"


class MigrateGroupMemoryTest(unittest.TestCase):
    def test_copies_channel_memories_into_group_and_keeps_private(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp)
            for scope, record_id, text in (("guild-111", "a" * 36, "喜歡海風"), ("guild-222", "b" * 36, "三缺一"), ("owner-9", "c" * 36, "私人")):
                folder = directory(root, scope)
                folder.mkdir(parents=True)
                (folder / (record_id + ".md")).write_text(note(scope, record_id, text), encoding="utf-8")
            self.assertEqual(migrate(root)["copied"], 2)
            self.assertEqual(migrate(root), {"copied": 0, "skipped": 2, "target": directory(root, "group").name})
            group = sorted(directory(root, "group").glob("*.md"))
            self.assertEqual(len(group), 2)
            self.assertTrue(all('"scope": "group"' in path.read_text(encoding="utf-8") for path in group))
            self.assertTrue((directory(root, "guild-111") / ("a" * 36 + ".md")).exists(), "原档保留")
            self.assertFalse(any("私人" in path.read_text(encoding="utf-8") for path in group))


if __name__ == "__main__":
    unittest.main()
