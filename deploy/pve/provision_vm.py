"""在容量检查通过后建立全新的 dsh 测试 VM，不变更既有客体。"""

import argparse
import hashlib
import ipaddress
import json
import pathlib
import shutil
import socket
import subprocess
import urllib.request

from audit_memory import assess

IMAGE_URL = "https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img"
IMAGE_SHA256 = "04e8f2461a16a44e78a370284471f29616cdd9baf1893df25807b71f985b6c94"
STORAGE_PATH = pathlib.Path("/var/lib/dsh-vm-storage")
STORAGE = "dsh-local"


def read(args):
    return subprocess.check_output(args, text=True)


def run(args):
    subprocess.run(args, check=True)


def cloud_config(public_key, management_ip):
    parts = public_key.strip().split()
    if len(parts) < 2 or parts[0] not in ("ssh-ed25519", "ssh-rsa"):
        raise ValueError("必须提供单一 SSH 公钥")
    if len(public_key.strip().splitlines()) != 1:
        raise ValueError("拒绝含多行内容的公钥")
    ipaddress.IPv4Address(management_ip)
    key = " ".join(parts[:2])
    commands = [
        ["netplan", "apply"],
        ["chmod", "0700", "/home/dsh-admin"],
        ["install", "-d", "-o", "dsh", "-g", "dsh", "-m", "0700", "/var/lib/dsh"],
        ["install", "-d", "-o", "dsh", "-g", "dsh", "-m", "0750", "/srv/dsh"],
        ["systemctl", "enable", "--now", "qemu-guest-agent"],
        ["ufw", "default", "deny", "incoming"],
        ["ufw", "default", "allow", "outgoing"],
        ["ufw", "allow", "from", management_ip, "to", "any", "port", "22", "proto", "tcp"],
        ["ufw", "allow", "out", "to", "any", "port", "67", "proto", "udp"],
    ]
    for network in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "169.254.0.0/16", "fc00::/7", "fe80::/10"):
        commands.append(["ufw", "deny", "out", "to", network])
    commands.extend([
        ["ufw", "--force", "enable"],
        ["sysctl", "-w", "vm.swappiness=20"],
    ])
    return {
        "hostname": "dsh-vm",
        "manage_etc_hosts": True,
        "disable_root": True,
        "ssh_pwauth": False,
        "users": [
            {"name": "dsh-admin", "shell": "/bin/bash", "lock_passwd": True,
             "sudo": "ALL=(ALL) NOPASSWD:ALL", "ssh_authorized_keys": [key]},
            {"name": "dsh", "system": True, "homedir": "/var/lib/dsh",
             "shell": "/bin/bash", "lock_passwd": True, "sudo": None},
        ],
        "swap": {"filename": "/swap.img", "size": 2147483648, "maxsize": 2147483648},
        "package_update": True,
        "package_upgrade": False,
        "write_files": [
            {"path": "/etc/dsh-isolated-vm", "content": "dsh-vm\n", "permissions": "0444"},
            {"path": "/etc/netplan/60-dsh-dns.yaml", "permissions": "0600",
             "content": json.dumps({"network": {"version": 2, "ethernets": {"eth0": {
                 "dhcp4": True, "dhcp4-overrides": {"use-dns": False},
                 "nameservers": {"addresses": ["1.1.1.1", "9.9.9.9"]}}}}})},
        ],
        "packages": ["qemu-guest-agent", "ca-certificates", "curl", "xz-utils", "python3", "ufw", "git"],
        "runcmd": commands,
        "final_message": "dsh 虚拟机基础初始化完成",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ssh-public-key", required=True)
    parser.add_argument("--memory-mib", type=int, default=2048)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if args.memory_mib < 1024:
        raise ValueError("此测试草案至少配置 1024 MiB")
    node = socket.gethostname().split(".")[0]
    resources = json.loads(read(["pvesh", "get", "/cluster/resources", "--output-format", "json"]))
    if not any(row.get("type") == "node" and row.get("node") == node for row in resources):
        raise ValueError("无法确认本机节点")
    guests = [row for row in resources if row.get("node") == node
              and row.get("type") in ("qemu", "lxc") and not row.get("template")]
    info = {line.split(":", 1)[0]: int(line.split(":", 1)[1].split()[0])
            for line in pathlib.Path("/proc/meminfo").read_text().splitlines()}
    report = assess(info["MemTotal"] // 1024, info["MemAvailable"] // 1024,
                    sum(int(row["maxmem"]) for row in guests) // 1048576,
                    args.memory_mib, 2048)
    if not report["capacity_check_passed"]:
        print(json.dumps(report, ensure_ascii=False))
        raise SystemExit("容量检查未通过，未建立 VM")
    networks = json.loads(read(["pvesh", "get", f"/nodes/{node}/network", "--output-format", "json"]))
    bridge = next(row for row in networks if row.get("iface") == "vmbr0" and row.get("active"))
    management_ip = str(ipaddress.ip_interface(bridge["cidr"]).ip)
    config = cloud_config(pathlib.Path(args.ssh_public_key).read_text(), management_ip)
    vmid = int(read(["pvesh", "get", "/cluster/nextid"]).strip())
    if any(row.get("vmid") == vmid for row in resources):
        raise ValueError("VM ID 已被占用")
    # 采用独立目录储存，避免进一步超配既有 thin pool。
    if shutil.disk_usage("/var/lib").free < 40 * 1073741824:
        raise ValueError("目录储存不足以容纳 32 GiB 虚拟磁碟并保留余量")
    plan = {"vmid": vmid, "memory_mib": args.memory_mib, "swap_mib": 2048,
            "disk_gib": 32, "vcpus": 2, "cpu_limit": 1, "storage": STORAGE,
            "autostart": False, "image_sha256": IMAGE_SHA256}
    print(json.dumps({"plan": plan}, ensure_ascii=False), flush=True)
    if not args.apply:
        return
    stores = json.loads(read(["pvesh", "get", "/storage", "--output-format", "json"]))
    existing = next((row for row in stores if row.get("storage") == STORAGE), None)
    if existing and existing.get("path") != str(STORAGE_PATH):
        raise ValueError("储存名称已存在且路径不同，拒绝覆盖")
    if not existing:
        if STORAGE_PATH.exists():
            raise ValueError("目标目录已经存在，拒绝猜测拥有权")
        STORAGE_PATH.mkdir(mode=0o755)
        run(["pvesm", "add", "dir", STORAGE, "--path", str(STORAGE_PATH), "--content", "images,snippets"])
    cache = STORAGE_PATH / "source"
    cache.mkdir(exist_ok=True)
    image = cache / "ubuntu-noble-amd64.img"
    if not image.exists():
        run(["curl", "--fail", "--location", "--retry", "2", "--output", str(image), IMAGE_URL])
    with image.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    if digest != IMAGE_SHA256:
        raise ValueError("系统映像 SHA256 不符，拒绝建立 VM")
    snippets = STORAGE_PATH / "snippets"
    snippets.mkdir(exist_ok=True)
    snippet = snippets / f"dsh-{vmid}-user.yaml"
    if snippet.exists():
        raise ValueError("初始化档已存在，拒绝覆盖")
    snippet.write_text("#cloud-config\n" + json.dumps(config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    snippet.chmod(0o600)
    run(["qm", "create", str(vmid), "--name", "dsh-vm", "--memory", str(args.memory_mib),
         "--balloon", "0", "--cores", "2", "--cpu", "host", "--cpulimit", "1",
         "--cpuunits", "10", "--onboot", "0", "--agent", "enabled=1",
         "--scsihw", "virtio-scsi-single", "--net0", "virtio,bridge=vmbr0,firewall=1",
         "--serial0", "socket", "--vga", "serial0", "--ostype", "l26"])
    run(["qm", "disk", "import", str(vmid), str(image), STORAGE, "--format", "qcow2", "--target-disk", "scsi0"])
    current = json.loads(read(["pvesh", "get", f"/nodes/{node}/qemu/{vmid}/config", "--output-format", "json"]))
    disk = current["scsi0"].split(",")[0]
    run(["qm", "set", str(vmid), "--scsi0", disk + ",discard=on,ssd=1,mbps=20",
         "--ide2", STORAGE + ":cloudinit", "--boot", "order=scsi0",
         "--ipconfig0", "ip=dhcp", "--nameserver", "1.1.1.1 9.9.9.9",
         "--cicustom", f"user={STORAGE}:snippets/{snippet.name}"])
    run(["qm", "disk", "resize", str(vmid), "scsi0", "32G"])
    print(json.dumps({"created_vmid": vmid, "status": "stopped"}), flush=True)


if __name__ == "__main__":
    main()
