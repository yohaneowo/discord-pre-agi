# dsh Discord 桥接阶段

2026-10-28 更新：下文保留初次 owner-only 桥接的部署纪录。最新版本 `0.6.0-social.2` 的指定频道群友聊天、群聊工具限制、私人会话、跨会话记忆和统一用量护栏见 [整合说明](social-runtime.md)；当前状态以该说明为准。

状态（2026-10-27）：已在独立 VM 连接 Discord，使用 DeepSeek 帐号路线与 `deepseek-flash`、鲸鱼娘会话预设；原会话重启接续已由使用者确认。后续按使用者纠正，移除「只能 @ 才说话」的测试限制，加入名字、回复、正常续聊与模型主动判断，详见 [自然接话阶段](natural-chat.md)。当前只允许拥有者在单一测试频道及私聊操作，尚未开放其他群友。

## 固定来源

| 材料             | 固定版本或来源                                                                                                                                      |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| dsh / Node.js    | 0.2.1-rc.3 / 24.21.0，沿用独立 VM 阶段                                                                                                              |
| VM 插件管理 pnpm | 11.7.0，与本机原型的 pnpm 9 分开                                                                                                                    |
| 桥接             | [ghbhiee/dsh-plugin-discord](https://github.com/ghbhiee/dsh-plugin-discord)，0.6.0，commit `d591e5ef8db043dea232f07115d1a24b4f1dda74`               |
| 上游入口 SHA256  | `2ada22962d40c46e7c29b9bdddb21937af605ce6cad6d99e35730fbd82bfc889`                                                                                  |
| 人设             | [linsport/dsh-whale-persona](https://github.com/linsport/dsh-whale-persona)，commit `4f884899df629b88c331e96151225dc825c15c96`，会话预设 ID `whale` |

桥接 MIT 授权随 VM 安装材料保留。人设仓库的 MIT 说明只覆盖其原创部分，另有形象及灵感来源的权利保留；本公开仓库不收录人设全文、图片或上游代码，私人 VM 的安装不代表取得素材商用授权。人设只装一份，没有叠加全域注入插件。

## 发话与权限

上游白名单本身不要求提及。`prepare_discord_plugin.py` 先核对版本、入口 SHA256 与唯一替换锚点，再向已审阅的编译入口插入 `discord-policy.mjs`；任何漂移都拒绝套用。

- 桥接原有检查先限制用户和频道；此阶段 `allowedUsers` 仅拥有者、`allowedChannels` 仅测试频道。
- 明确提及、名字与回复是直接呼叫；正常续聊不受主动冷却限制，其他群聊由模型有限度判断是否接话。全体、角色及其他用户的提及不算直接呼叫，机器人与自身消息不处理。细节及默认节奏见自然接话说明。
- 拥有者的 `/new`、`/sessions`、`/use`、`/current`、`/stop`、`/help` 及原有文字别名可以不提及 bot；其他群友仍被白名单拒绝。
- 私聊也只有拥有者可用。`notifyEnabled` 与 `imessageEnabled` 关闭，没有启用额外推送入口。
- 会话工作区为 VM 内 `/srv/dsh/discord`，预设 `whale`，不复制个人电脑的 dsh home。

这是拥有者测试阶段。不能把它当成其他群友可安全驱动完整工具权限的最终方案；开放前须另做主人命令、会话资料边界与群聊工具权限设计。

## 凭证部署

依专案约定，bot 凭证由专用 Doppler config 管理。VM 只存该 config 的只读 Service Token，不能复制个人 Doppler CLI token。

1. 根目录维护凭证位于 `/etc/dsh-secrets/.env`，root 持有、0600，父目录 0700；不提供给 dsh 帐号。
2. 独立 root 单元 `dsh-secrets.service` 用 `fetch_secrets.py` 从 Doppler 读取单一 `DSH_DISCORD_TOKEN`，写入 root 管理的 `/run/dsh-secrets/runtime.env`。
3. dsh 的 `discord-secrets.conf` 依赖该单元，透过 systemd 注入 bot 凭证。代理能使用 bot token，但进程环境没有 `DOPPLER_TOKEN`，也不能读取控制 token 或引导环境档。
4. Doppler 获取不接受重导向，凭证格式拒绝换行与环境注入；获取失败便阻止启动。root 引导单元不读取 dsh 可写的 `.env`，不以同一单元的提权前置命令执行，以免继承代理可控制的环境。

新 VM 重启后已实测重新读取凭证并连接 gateway。旋转 token 时，更新 Doppler 后依序重新启动引导及 dsh 服务，再检查状态；不要输出 `.env`、下载结果或完整底层错误。

## 安装材料与维护顺序

本阶段已经部署，以下是重现所需的材料说明，不能直接在已有实例上盲目重跑：

1. 先为新 VM 建立不含 RAM 的快照，保留现有 profile 与登入状态。
2. 将上表固定 commit 的桥接原始码置于受排除的审阅目录，确认授权；用 `prepare_discord_plugin.py SOURCE TARGET --sha256 EXPECTED_HASH` 生成 VM 材料。保留 package manifest、补丁与 LICENSE。
3. 维护暂存区需包含 `discord/`、`whale/` 两个材料目录，以及 `configure_discord.py`、`fetch_secrets.py`、`dsh-secrets.service`、`discord-secrets.conf`。不包含个人电脑私钥。
4. 停止新 VM 的 dsh；`configure_discord.py` 只接受 stdin JSON 的 `owner_id`、`channel_id`、`doppler_token`，先备份 profile 再配置。不回显值；已有桥接或供应商目录时拒绝自动覆盖。
5. 以 VM 的普通 dsh 帐号执行下列插件安装。安装固定版本 pnpm，使用 root 持有的 `/opt/dsh/vendor/discord` 与 `/opt/dsh/vendor/whale`；禁用自动安装宿主 peer 依赖与第三方安装脚本，避免意外升级宿主。

```sh
dsh plugin --profile web add file:/opt/dsh/vendor/discord file:/opt/dsh/vendor/whale --config.auto-install-peers=false --ignore-scripts
```

6. 验证 systemd 单元及凭证引导成功；确认旧 bot 已停止后，才启动新桥接。使用同一 token 时只能有一个 gateway。
7. 依下列测试与人工条件验收，再重启新 VM 验证恢复。现有原型不会因此自动取得桥接的会话或计费记录。

## 验收

- [x] gateway 就绪，真实 slash commands 注册成功
- [x] 使用者实测群内 @ 有真实模型回复，未 @ 时保持安静
- [x] 实际安装模块的白名单与提及组合检查通过，陌生用户、其他频道与机器人被拒绝；检查本身不开 gateway、不传消息
- [x] 实际会话投影记录 `agentPreset=whale`，工作区位于 VM，产生 dsh tokenUsage 投影
- [x] 实测代理环境无 Doppler 控制 token，引导档及控制 token 不可读
- [x] 新 VM 重启后引导、隔离探测、gateway 与同一会话绑定恢复；使用者再次提问确认能接续原对话
- [ ] 非拥有者群友的正式权限与会话资料边界
- [ ] 长期记忆插件、召回及跨会话恢复；当前只验证 dsh 原会话持久化
- [ ] 每日费用上限、账户额度与费用展示；原型 SQLite ledger 不适用于此桥接
- [ ] 透过真实模型执行工具后的档案边界验收与高负载观察

此阶段走 `deepseek-account`，没有填入独立 API Key。真实回覆成功不证明赠金额度、有效期或每日硬上限，需在帐户与后续护栏阶段确认。

本机检查：

```sh
python -m unittest discover -s deploy/pve -p 'test_*.py'
python -m unittest discover -s deploy/dsh -p 'test_*.py'
node --test deploy/dsh/discord-policy.test.mjs
pnpm typecheck
pnpm lint
pnpm test
```

VM 实装检查：以 dsh 帐号执行 `node /opt/dsh/verify_discord.mjs`。Python 离线测试共 17 项，自然接话行为测试见对应说明；原型为 103 项 Vitest 测试。原先「未 @ 静默」的验收是早期测试基准，不能作为目前普通群聊必须安静的要求。
