"""验证私人入口不会回显至服务日志。"""

import pathlib
import tempfile
import unittest
from unittest.mock import patch

import run_dsh


class RedactionTests(unittest.TestCase):
    def test_private_url_is_saved_only_in_env_and_existing_fields_survive(self):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / ".env"
            path.write_text("EXISTING_SETTING=yes\nDSH_ACCESS_URL=old\n")
            with patch.object(run_dsh, "ENV_PATH", path):
                text = run_dsh.sanitize("Open http://127.0.0.1:3080/?token=test-only-value\n")
            self.assertNotIn("test-only-value", text)
            self.assertIn("EXISTING_SETTING=yes", path.read_text())
            self.assertEqual(path.read_text().count("DSH_ACCESS_URL="), 1)

    def test_other_credential_formats_are_redacted_without_being_saved(self):
        with patch.object(run_dsh, "save_url") as save:
            for text in ("Bearer test-only-value", "cookie: test-only-value", "https://user:test-only-value@example.invalid", "https://example.invalid/?key=test-only-value"):
                self.assertNotIn("test-only-value", run_dsh.sanitize(text))
            save.assert_not_called()

    def test_malformed_url_does_not_crash_or_leak(self):
        self.assertNotIn("test-only-value", run_dsh.sanitize("http://[test-only-value"))


if __name__ == "__main__":
    unittest.main()
