"""在 PVE 宿主机只读检查新增 VM 的记忆体余量，不修改配置。"""

import argparse
import json
import pathlib
import socket
import subprocess
import sys


def assess(total_mib, available_mib, allocated_mib, requested_mib, reserve_mib):
    values = (total_mib, available_mib, allocated_mib, requested_mib, reserve_mib)
    if any(not isinstance(value, int) or value < 0 for value in values):
        raise ValueError("记忆体数值必须是非负整数")
    if total_mib == 0 or requested_mib == 0:
        raise ValueError("主机总量与目标 VM 记忆体必须大于零")
    reasons = []
    if available_mib < requested_mib + reserve_mib:
        reasons.append("实际可用记忆体不足以容纳目标 VM 并保留宿主余量")
    if allocated_mib + requested_mib + reserve_mib > total_mib:
        reasons.append("现有客体配额加目标 VM 与宿主余量超过实体记忆体")
    return {
        "total_mib": total_mib,
        "available_mib": available_mib,
        "existing_guest_allocation_mib": allocated_mib,
        "requested_mib": requested_mib,
        "host_reserve_mib": reserve_mib,
        "capacity_check_passed": not reasons,
        "reasons": reasons,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--memory-mib", type=int, default=4096)
    parser.add_argument("--host-reserve-mib", type=int, default=2048)
    args = parser.parse_args()
    meminfo = {}
    for line in pathlib.Path("/proc/meminfo").read_text().splitlines():
        key, rest = line.split(":", 1)
        meminfo[key] = int(rest.split()[0])
    result = subprocess.run(
        ["pvesh", "get", "/cluster/resources", "--output-format", "json"],
        check=True, capture_output=True, text=True, timeout=20,
    )
    resources = json.loads(result.stdout)
    node = socket.gethostname().split(".")[0]
    if not any(row.get("type") == "node" and row.get("node") == node for row in resources):
        raise ValueError("无法确定本机 PVE 节点，拒绝猜测资源范围")
    guests = [row for row in resources if row.get("node") == node
              and row.get("type") in ("qemu", "lxc") and not row.get("template")]
    report = assess(
        meminfo["MemTotal"] // 1024,
        meminfo["MemAvailable"] // 1024,
        sum(int(row["maxmem"]) for row in guests) // 1048576,
        args.memory_mib, args.host_reserve_mib,
    )
    # 不输出节点地址、客体名称、设定内容或凭证。
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["capacity_check_passed"] else 2


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError):
        print("只读资源检查失败，请检查 PVE 执行环境与查询权限。", file=sys.stderr)
        sys.exit(1)
