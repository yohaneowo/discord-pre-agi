# dsh 独立 VM 部署与验收

状态（2026-10-27）：已依使用者授权，将既有 VM 配额调整为 9 GiB，并建立 2 GiB 的独立 dsh VM。维护前有快照，原有 61 个容器、18 个健康检查及 6 个内部 HTTP 入口基准通过。随后已完成拥有者测试用 Discord 桥接、人设与真实模型回覆及重启对话接续，详细限制见 [桥接说明](../dsh/README.md)。长期记忆、群友权限、费用上限与高负载仍待完成。实际主机地址、服务名称及凭证不写入公开仓库。

## 已采用配置

以下是本次受资源限制的起步配置，不是 dsh 官方最低需求。实际模型与并发负载尚未验收。

| 项目       | 草案                                                                      |
| ---------- | ------------------------------------------------------------------------- |
| 隔离方式   | PVE 完整 Linux VM                                                         |
| 系统       | Ubuntu Server 24.04 LTS，官方 cloud image，下载后验证 SHA256              |
| CPU        | 2 vCPU，并限制 CPU 时间，降低与既有服务竞争                               |
| 记忆体     | 2 GiB RAM、2 GiB swap；建立前通过实际余量与配额检查，保留宿主机余量       |
| 磁碟       | 32 GiB qcow2，专用目录储存；限制磁碟流量                                  |
| 开机行为   | 验收后启用延后自动开机；VM 内 dsh 服务随系统启动                          |
| 系统使用者 | 维护帐号与执行 dsh 的普通帐号分开，dsh 帐号无 sudo 权限                   |
| 工作资料   | VM 内独立的 dsh home、工作目录与持久资料，不挂载个人电脑或 PVE 的私人资料 |
| 管理入口   | 先使用 SSH 隧道连接 VM 的 dsh Web；桌面应用远端直连另行验证               |
| 群聊入口   | VM 内的 Discord 桥接连接同一套 dsh，使用专门的群聊会话与预设              |

本次调整没有停用既有开发服务。后续建置峰值、真实模型、插件及群聊并发仍须观察；不能用安装完成或闲置记忆体证明高负载安全。

## 已备妥的建立工具

`provision_vm.py` 仅用于 PVE 宿主机，预设只输出计划；加 `--apply` 才建立全新的、保持停机的 VM。它不会启动、删除或修改既有客体。执行前要准备维护帐号的单一 SSH 公钥档，绝不复制私钥或整份 `authorized_keys`。

工具会重新检查记忆体及配额、未占用 VM ID 与磁碟余量。映像使用已核对的 SHA256；若上游 `current` 映像改变，会拒绝继续，须重新核对后更新。磁碟采用新建的专用目录储存 `dsh-local`，避免继续增加既有 thin pool 的虚拟容量；仍与宿主机系统共用实体储存，须保留实际空间。

初始化会建立独立的 `dsh-admin` 维护帐号与无 sudo 的 `dsh` 帐号、专用资料目录、2 GiB swap，以及 VM 内 UFW 规则。SSH 只接受经 PVE 管理入口转接；dsh Web 后续只监听 loopback。不会开启或变更 PVE 的全域防火墙。

`../dsh/install.sh`、`../dsh/dsh.service` 与 `../dsh/run_dsh.py` 是新 VM 的服务部署材料。固定使用 Node.js 24.21.0 与 dsh 0.2.1-rc.3；这是服务器运行环境，与现有 Discord 原型的 Node.js 22 环境分开。服务以普通帐号执行，并限制 RAM、swap、CPU 及私人网路访问；私人入口只写入 VM 内 `.env`，不回显服务日志。

本机离线检查：

```sh
python -m unittest discover -s deploy/pve -p 'test_*.py'
python -m unittest discover -s deploy/dsh -p 'test_*.py'
bash -n deploy/dsh/install.sh
```

以上材料已部署，独立环境阶段当时的 13 项离线测试与实机隔离检查通过；桥接阶段新增测试见桥接说明。服务启动前会再次检查普通帐号、sudo、维护目录、系统／应用目录写入边界与私人 IPv4 访问；任何一项失败便拒绝启动。私人网路探测使用 UDP 取得明确的权限拒绝，不把 TCP 超时当成封锁证据。UFW 与服务 cgroup 同时限制私人 IPv4／IPv6 范围。

专案型别与 Lint 检查通过。103 项既有测试曾有一次本机 HTTP 聊天测试未收到预期回覆；单独重跑及随后三次完整执行均通过，尚未定位这次短暂失败的原因，未修改聊天原型来掩盖结果。

## 从本机开启

本机 `.env` 内另设 `DSH_SSH_TARGET`、`DSH_SSH_JUMP`、`DSH_SSH_KEY`、`DSH_KNOWN_HOSTS`、`DSH_LOCAL_PORT`；`.env.example` 只列空名字。维护私钥只留在本机，不复制到 VM；SSH 禁用 agent 转发，严格检查已钉选的客体主机公钥。

在仓库根目录执行：

```powershell
python deploy/dsh/open_dsh.py
```

工具建立只监听本机 loopback 的 SSH 隧道，从 VM 读取当次私人启动入口，验证会话 cookie 后开启浏览器。入口更新到本机 `.env` 的 `DSH_ACCESS_URL`，不会印到终端；VM 重启后再次执行即可取得新入口。仅打开无凭证的裸网址不能完成首次登录。加 `--no-open` 可只做 HTTP 登录验证。

已实测本机隧道登录 HTTP 200 并取得会话 cookie，VM 重启后再次登录亦通过。后续已由使用者在 Discord 验收真实模型回覆及重启接续；浏览器画面与模型执行工具的范围尚未人工确认。dsh home 为 VM 内 `/var/lib/dsh/.dsh`，基础工作空间为 `/srv/dsh`，Discord 会话在其 `discord` 子目录，没有复制个人电脑的 dsh home 或挂载私人资料。

## 资源检查结论与条件

`audit_memory.py` 使用 Python 3 标准库，在 PVE 宿主机读取 `/proc/meminfo` 与 `pvesh get /cluster/resources`。它同时检查实际余量及客体配额，预设评估 4096 MiB 的新 VM 并为宿主机保留 2048 MiB；只输出容量与判断，不输出主机地址、客体名称或凭证。退出码 `0` 表示容量检查通过，`2` 表示余量不足，`1` 表示无法完成检查。容量通过仍需完成磁碟、网路、权限与实际负载验收。

可从本机 PowerShell 透过既有 SSH 别名执行，先把 `YOUR_PVE_SSH_ALIAS` 换成实际别名：

```powershell
$OutputEncoding = [System.Text.UTF8Encoding]::new()
Get-Content -Raw -Encoding utf8 deploy/pve/audit_memory.py | ssh -o BatchMode=yes YOUR_PVE_SSH_ALIAS 'python3 -'
```

脚本的离线测试不需要 PVE，可执行 `python -m unittest discover -s deploy/pve -p 'test_*.py'`。

只读检查须区分宿主机 `MemAvailable`、客体可回收记忆体及 VM 的固定配额。客体内部的快取或闲置额度，不等于宿主机可直接分配给新 VM 的空间。尤其关闭 ballooning 的固定配额 VM，不能只靠清快取或停止容器来完成宿主机资源重新分配。

若评估将开发服务改为按需启动，必须先列出准确资源、相依服务、停止后的影响与恢复方法；名称包含 `dev` 不代表无人使用，控制平台的环境标签也可能与资源命名不一致。只读调查不授权停用服务、缩减 VM、重启或变更 ballooning。

短时间样本与单一容器的生命週期峰值不足以证明 VM 可安全缩配，也不能把多个容器各自峰值当作同时峰值。需考虑部署建置期间的需求、历史 OOM、guest swap、资料库和反向代理的余量。无法取得足够余量时，改用扩充实体记忆体或其他主机。

## 实际部署顺序

1. 确定资源来源，再次检查余量；若调整既有服务，先取得准确范围与维护时间，准备备份、快照及恢复步骤。
2. 选择未占用 VM ID、网路与储存，验证官方系统映像；建立独立 VM，不变更既有客体。
3. 限制 VM 资源及网路存取，保留必要的模型、Discord 与维护连线，阻止代理访问宿主机管理面及未授权的私人内网服务。
4. 以固定版本安装 dsh Web，并配置独立帐号、资料目录与服务；凭证只写 VM 内受保护的 `.env`，不复制个人电脑完整的 dsh home。
5. 透过 SSH 隧道登录，确认档案与命令操作发生在 VM；验证持久化、停止及重启行为。
6. 核对并安装人设、记忆及 Discord 桥接的相容版本。切换前停止旧的固定回覆 bot，避免同一 token 被两处同时使用。
7. 验收 Discord 回覆、会话隔离、发话规则、权限限制与费用可观测性。现成桥接不等于原型的发话及预算护栏会自动保留，须逐项确认。

## 验收清单

2026-10-28 补充：[dsh 整合](../dsh/social-runtime.md)已完成群友权限、发话、持久记忆与应用层 token 护栏的自动验收和正式切换。下列未勾选项保留前一环境阶段的验收范围；美元硬上限、人工体验及峰值负载仍不以自动测试替代。

- [x] 资源来源已确认，宿主机与既有服务保留起步余量；峰值负载尚待观察
- [x] VM 内的 dsh 使用普通帐号，无 sudo，维护帐号目录不可读，未提供 PVE 管理凭证
- [x] 私人资料未挂载，私人 IPv4 权限拒绝与公开 HTTPS 可达已实测
- [x] 本机隧道的私人入口登录通过，进程工作目录与持久化探测档位于 VM
- [x] dsh 使用 VM 内独立 home 与资料目录
- [x] 新 VM 重启后服务、持久化探测档与私人入口重新登录通过
- [ ] 使用者确认浏览器画面，并经模型执行工具核对操作范围
- [x] Discord 已绑定测试频道专用会话，旧固定回覆 bot 已停止，使用者回覆验收通过
- [ ] 群聊发话控制、主人权限、费用与异常行为已验收
- [ ] 长期记忆插件配置后再验证记忆恢复；原 Discord 会话重启接续已通过

## 查证来源

- [Proxmox VM 记忆体与 ballooning](https://github.com/proxmox/pve-docs/blob/master/qm.adoc#memory)
- [Ubuntu 官方 cloud image](https://cloud-images.ubuntu.com/noble/current/)
- [dsh 官方启动方式](https://github.com/deepseek-ai/deepseek-harness#run)
- [dsh 远端 Web 部署](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/public-deployments.md)
- [Discord 会话桥接及相容性说明](https://github.com/ghbhiee/dsh-plugin-discord)

查证与实机验收日期：2026-10-27。勾选仅代表列明的检查；拥有者桥接的结果另见桥接说明，不代表其他群友权限、长期记忆或高负载已通过。
