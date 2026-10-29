"""验证 root 凭证引导不会把控制 token 传给代理或接受环境注入。"""

import io
import contextlib
import json
import pathlib
import tempfile
import unittest
import urllib.request
from unittest.mock import patch

import fetch_secrets


class SecretBootstrapTests(unittest.TestCase):
    def invoke(self, path, value):
        response = io.BytesIO(json.dumps({"DSH_DISCORD_TOKEN": value}).encode())
        with patch.object(fetch_secrets, "DESTINATION", path), patch.dict(fetch_secrets.os.environ, {"DOPPLER_TOKEN": "test-only-control-secret"}), patch.object(fetch_secrets.urllib.request, "build_opener") as build:
            build.return_value.open.return_value = response
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                fetch_secrets.main()
            self.assertNotIn("control-secret", output.getvalue())
            handlers = build.call_args.args
            deny = next(handler for handler in handlers if isinstance(handler, urllib.request.HTTPRedirectHandler))
            self.assertIsNone(deny.redirect_request(None))

    def test_agent_receives_only_bot_secret_and_redirects_are_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "runtime.env"
            self.invoke(path, "a" * 60)
            self.assertEqual(path.read_text(), "DSH_DISCORD_TOKEN=" + "a" * 60 + "\n")
            self.assertNotIn("control-secret", path.read_text())

    def test_malformed_secret_does_not_replace_previous_environment(self):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "runtime.env"
            path.write_text("previous-safe-value")
            with self.assertRaises(ValueError):
                self.invoke(path, "a" * 60 + "\nLD_PRELOAD=/untrusted")
            self.assertEqual(path.read_text(), "previous-safe-value")


if __name__ == "__main__":
    unittest.main()
