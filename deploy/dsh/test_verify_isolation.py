"""确认隔离探测不会把网路失败误认成权限限制。"""

import errno
import unittest
from unittest.mock import patch

import verify_isolation


class IsolationProbeTests(unittest.TestCase):
    def test_permission_denied_is_accepted(self):
        with patch.object(verify_isolation.socket, "socket") as factory:
            factory.return_value.__enter__.return_value.sendto.side_effect = OSError(errno.EPERM, "denied")
            self.assertTrue(verify_isolation.connection_blocked("192.0.2.1"))

    def test_timeout_or_unreachable_is_not_accepted(self):
        for result in (errno.ETIMEDOUT, errno.ENETUNREACH, 0):
            with patch.object(verify_isolation.socket, "socket") as factory:
                connection = factory.return_value.__enter__.return_value
                if result:
                    connection.sendto.side_effect = OSError(result, "network error")
                else:
                    connection.sendto.return_value = 19
                self.assertFalse(verify_isolation.connection_blocked("192.0.2.1"))


if __name__ == "__main__":
    unittest.main()
