"""验证资源不足时拒绝通过，不连接或更改 PVE。"""

import unittest

from audit_memory import assess


class CapacityTests(unittest.TestCase):
    def test_available_memory_is_not_enough(self):
        report = assess(16000, 2200, 13824, 4096, 2048)
        self.assertFalse(report["capacity_check_passed"])
        self.assertEqual(len(report["reasons"]), 2)

    def test_low_usage_does_not_hide_allocation_overcommit(self):
        report = assess(16000, 8000, 13824, 4096, 2048)
        self.assertFalse(report["capacity_check_passed"])

    def test_busy_host_is_rejected_despite_low_allocations(self):
        report = assess(32000, 1000, 4096, 4096, 2048)
        self.assertFalse(report["capacity_check_passed"])

    def test_sufficient_capacity_passes(self):
        report = assess(32000, 12000, 13824, 4096, 2048)
        self.assertTrue(report["capacity_check_passed"])

    def test_invalid_or_zero_request_is_rejected(self):
        for requested in (-1, 0):
            with self.assertRaises(ValueError):
                assess(32000, 12000, 13824, requested, 2048)


if __name__ == "__main__":
    unittest.main()
