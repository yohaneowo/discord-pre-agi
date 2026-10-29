"""离线检查初始化的权限边界，不连接 PVE。"""

import unittest

from provision_vm import cloud_config


class CloudConfigTests(unittest.TestCase):
    def test_agent_is_separate_from_admin_and_has_no_sudo(self):
        config = cloud_config("ssh-ed25519 AAAAtest 注释", "192.0.2.10")
        admin, agent = config["users"]
        self.assertEqual(admin["ssh_authorized_keys"], ["ssh-ed25519 AAAAtest"])
        self.assertEqual(agent["name"], "dsh")
        self.assertFalse(agent["sudo"])
        self.assertNotIn("ssh_authorized_keys", agent)
        self.assertFalse(config["ssh_pwauth"])
        self.assertTrue(config["disable_root"])

    def test_swap_and_private_network_blocks_are_present(self):
        config = cloud_config("ssh-ed25519 AAAAtest", "192.0.2.10")
        self.assertEqual(config["swap"]["size"], 2147483648)
        self.assertIn(["ufw", "deny", "out", "to", "192.168.0.0/16"], config["runcmd"])
        self.assertIn(["ufw", "deny", "out", "to", "169.254.0.0/16"], config["runcmd"])

    def test_multiline_key_or_invalid_address_is_rejected(self):
        with self.assertRaises(ValueError):
            cloud_config("ssh-ed25519 AAAA\n恶意第二行", "192.0.2.10")
        with self.assertRaises(ValueError):
            cloud_config("ssh-ed25519 AAAA", "不是 IP")


if __name__ == "__main__":
    unittest.main()
