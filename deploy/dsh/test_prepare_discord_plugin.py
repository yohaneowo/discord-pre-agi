"""确认上游漂移时停止套用发话补丁。"""

import hashlib
import pathlib
import tempfile
import unittest

from prepare_discord_plugin import prepare


class UpstreamDriftTests(unittest.TestCase):
    def test_wrong_hash_cannot_create_deployment_files(self):
        with tempfile.TemporaryDirectory() as directory:
            source = pathlib.Path(directory) / "source"
            (source / "lib").mkdir(parents=True)
            (source / "package.json").write_text('{"name":"dsh-plugin-discord","version":"0.6.0"}')
            (source / "lib/index.js").write_text('const content = message.content ?? "";')
            target = pathlib.Path(directory) / "target"
            with self.assertRaises(ValueError):
                prepare(source, target, "0" * 64)
            self.assertFalse(target.exists())

    def test_changed_entry_must_be_reviewed_even_with_matching_hash(self):
        with tempfile.TemporaryDirectory() as directory:
            source = pathlib.Path(directory) / "source"
            (source / "lib").mkdir(parents=True)
            (source / "package.json").write_text('{"name":"dsh-plugin-discord","version":"0.6.0"}')
            content = b"changed upstream entry"
            (source / "lib/index.js").write_bytes(content)
            target = pathlib.Path(directory) / "target"
            with self.assertRaises(ValueError):
                prepare(source, target, hashlib.sha256(content).hexdigest())
            self.assertFalse(target.exists())


if __name__ == "__main__":
    unittest.main()
