# whale-chan-pre-agi

Discord 群里像人一样的 AI 角色：有个性、记得群友和过去的事、知道什么时候不说话。DeepSeek 模型（OpenAI 相容格式），记忆以 Obsidian 风格的 Markdown 为正本，另建可重建的检索索引。

- 计划：[docs/plans/v1.md](docs/plans/v1.md)（分阶段，各有验收条件）
- 调研：[docs/research/deepseek-and-persona.md](docs/research/deepseek-and-persona.md)
- 当前方向（2026-10-28）：独立 PVE VM 的 dsh 连接 Discord 与私人 Web，加入[自然接话](deploy/dsh/natural-chat.md)、[跨会话记忆、群友权限与用量护栏](deploy/dsh/social-runtime.md)。指定频道内群友可聊天，群聊只提供记忆工具；拥有者私讯使用独立完整预设。应用层 token 上限不代表美元硬上限。环境见 [VM 部署说明](deploy/pve/README.md)；桌面应用远端直连仍待验证。
- 现有原型：阶段 0 固定回覆已验收；阶段 1 的独立 API 聊天、短期上下文、插话规则与费用护栏已通过本机测试，目前未启用。以下 `BOT_MODE=chat` 与模型金钥说明属于独立 API 原型，不能当成 dsh 桥接的必要步骤。

## 授权：社区版与商业版

原始码公开，采用 [PolyForm Noncommercial 1.0.0](LICENSE)（「原始码公开」授权，不是 OSI 定义的开源授权）：

- **社区版（免费）**：个人学习、研究、兴趣专案、私人娱乐，以及慈善、教育、公共研究、政府等非营利机构使用，都可以免费使用、修改与散布（散布时要附上授权条款与 `Required Notice` 那一行）。
- **商业版（需另行授权）**：任何商业用途——拿来赚钱、放进收费产品或服务、在公司业务中使用——都需要先取得商业授权。请在 GitHub 开 issue 联系作者。

社群素材另有授权、不在本 repo 的授权范围内：「大肥鱼」形象是 DeepSeek 社群的二创；计划里提到的表情包图片是 CC BY-NC 4.0（不可商用），本 repo 没有收录。

## 本机准备

使用 Node.js 22（至少 22.18）与 pnpm 9.15.9，版本分别记录在 `.nvmrc` 与 `package.json`。测试使用 Node.js 原生 TypeScript 设定载入与工作线程。

```sh
pnpm install
```

复制 `.env.example` 为 `.env`，在每个 `=` 后面填值。范本只有变数名称与空值，不含任何凭证。请在本机编辑 `.env`，不要把 token 或 API Key 贴进聊天、截图或提交到 git。DeepSeek 的网址与模型名请参照[官方核对笔记](docs/deepseek-notes.md)。

| 环境变数            | 说明                                                               |
| ------------------- | ------------------------------------------------------------------ |
| `DISCORD_TOKEN`     | 专用 Discord 应用程式的机器人凭证                                  |
| `DISCORD_CLIENT_ID` | 应用程式的数字 ID                                                  |
| `LLM_BASE_URL`      | 模型供应商的 HTTP(S) base URL，可含 `/v1` 路径；阶段 0 可留空      |
| `LLM_MODEL`         | 模型名称；阶段 0 可留空                                            |
| `LLM_API_KEY`       | 模型供应商的 API 凭证；阶段 0 可留空                               |
| `DAILY_BUDGET_USD`  | 聊天模式的每日美元预算，须大于零且不超过 10000；固定回覆模式可留空 |
| `OWNER_DISCORD_ID`  | 主人的 Discord 数字 ID，用于私密指令验证及预算／余额异常通知       |

DeepSeek 当前网址、模型、价格与来源见 [官方核对笔记](docs/deepseek-notes.md)。凭证与基本设定由 `src/config.ts` 检查，聊天行为与计价由 `src/chat-config.ts` 检查。固定回覆模式只检查三个 Discord 栏位；聊天模式检查完整设定，缺值或格式错误会阻止启动，错误讯息不会回显设定值。

## Discord 准备与启动

建立专用的 Discord Application 与 bot，在开发者后台开启 **Message Content Intent**，用 `bot` 范围邀请到测试伺服器，并授予查看频道、传送讯息、读取讯息历史等回覆所需权限。程式仅要求 `Guilds`、`GuildMessages`、`MessageContent` 三个 intents。

新建 bot 后，依序完成：

1. 在 Developer Portal 的 **General Information** 复制 **Application ID**，填入本机 `.env` 的 `DISCORD_CLIENT_ID`。
2. 在 **Bot** 页取得 token，填入 `DISCORD_TOKEN`；开启 **Privileged Gateway Intents → Message Content Intent** 并储存。
3. 在 **Installation** 页启用 **Guild Install**，设定 `bot` 与 `applications.commands` scopes，并选取 **View Channels**、**Send Messages**、**Read Message History** 权限。复制该页提供的安装连结，把 bot 加入测试伺服器；测试频道也须允许这些权限。
4. 在 Discord 使用者设定开启开发者模式，复制自己的使用者 ID，填入 `OWNER_DISCORD_ID`。
5. 固定回覆模式填妥三个 Discord 栏位即可启动。`LLM_BASE_URL`、`LLM_MODEL`、`LLM_API_KEY` 与 `DAILY_BUDGET_USD` 在启用模型时填写；固定回覆不会呼叫模型，也不会产生模型费用。

Portal 的安装方式与 Intent 设定依据 [Discord 官方快速入门](https://github.com/discord/discord-api-docs/blob/main/developers/quick-start/getting-started.mdx)与 [Gateway 文件](https://github.com/discord/discord-api-docs/blob/main/developers/events/gateway.mdx)。

```sh
pnpm dev
```

在预设固定回覆模式（`BOT_MODE` 留空或设为 `fixed`），群友直接 @ 机器人时，会收到「咕噜，我在这儿，刚刚还在水里发呆呢。」固定一句话。其他机器人、自身讯息、私讯、仅回覆但未直接 @、全体提及均不回应。占位文字位于 `src/discord.ts`。

连线验收：终端应显示「机器人已连线，等待群友提及。」；在测试伺服器直接 @ bot，应收到上述固定回覆；再发送没有 @ 的讯息，确认 bot 不回应。完成后可按 `Ctrl+C` 停止。若启动失败，先检查 `.env`、token 与 Intent；若已连线却无法回覆，检查测试频道权限。不要贴出 `.env` 或完整的底层连线错误。

`dev` 会先编译，再载入 `.env` 并启动；修改程式后重新执行即可。

## 模型聊天模式

先停止旧的 bot 程序，填妥模型栏位与每日预算，再在本机 `.env` 将 `BOT_MODE` 设为 `chat` 后重新启动。DeepSeek 官方可使用核对笔记里的网址与模型名。其他 OpenAI 相容供应商可更换网址、模型与金钥，但必须另外填妥三个价格栏位，未知价格视为 TBD 并拒绝启动。请在模型供应商后台同时设定需要的消费限制。

| 环境变数                                                               | 预设与用途                                                                                            |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `BOT_MODE`                                                             | `fixed`；设为 `chat` 才启用模型与主人指令                                                             |
| `BOT_NAMES`                                                            | 可留空；额外称呼，以半形逗号分隔。bot 本身的使用者名称与群内显示名称也会触发回覆                      |
| `PERSONA_PATH`                                                         | 可选的外部 Markdown 人设档，启动时读取，1～12000 字元；私人人设放在 repo 外。留空使用内建原创起步人设 |
| `DATA_DIR`                                                             | `data`；费用 SQLite 位于其中的 `usage.sqlite`，已由 git 排除                                          |
| `BOT_TIMEZONE`                                                         | `Asia/Taipei`；用于预算日界线、每日上限与安静时段                                                     |
| `QUIET_START_HOUR` / `QUIET_END_HOUR`                                  | `0` / `8`；此时段不主动插话，可跨午夜；两者相同表示无固定安静时段                                     |
| `PROACTIVE_COOLDOWN_MINUTES`                                           | `10`；主动插话后的全 bot 冷却时间                                                                     |
| `DECISION_INTERVAL_SECONDS`                                            | `60`；同频道两次主动判断的最短间隔                                                                    |
| `DAILY_PROACTIVE_LIMIT`                                                | `10`；全 bot 每日主动插话上限，设为 `0` 可关闭主动插话                                                |
| `MAX_OUTPUT_TOKENS`                                                    | `512`；模型回覆输出上限（可设为 32～2048），主动判断固定上限 96                                       |
| `LLM_INPUT_USD_PER_M` / `LLM_CACHE_USD_PER_M` / `LLM_OUTPUT_USD_PER_M` | 自订每百万 token 的美元价格，三个须一起填写；已核对的 DeepSeek 官方模型可留空                         |

直接 @、回覆 bot 或叫名字会进入回应流程，预算不足、余额无法确认或模型错误时回简短固定讯息。普通讯息先检查冷却、安静时段、每日上限及最近 8 则里 bot 是否已说了至少两次，再用同一模型的短提示判断是否值得接话；判断结果不合格式时保持安静。判断与正式回覆都会计费。

每个频道只处理一个回覆，最近 30 则上下文仅存记忆体，不写对话档，频道之间互相隔离。每则群友文字最多取 1000 字元进入模型上下文，显示名称与文字作为 user 资料传入，不具备修改权限或设定的能力。程序重启会清空短期上下文；长期记忆留待阶段 2。

聊天模式会注册 `/费用`（繁中介面显示 `/費用`）与 `/安静 分钟`（`/安靜 分鐘`）。指令只允许 `OWNER_DISCORD_ID` 使用，结果只对操作者可见。安静指令会保留到指定时间，直接叫 bot 仍可回应。费用指令列出今日／本月 token、估算与未确认预留、余额和查询时间；余额币别照供应商回传，不做汇率换算。

## 费用护栏

每次模型呼叫前，SQLite 交易会以输入 UTF-8 字节数加封装余量、输出 token 上限及较高输入价格预留额度，跨频道／多个数据库连线也不能重复花用同一份剩余额度。得到有效 token 用量后结算估算金额；缓存字段缺少时按未命中计价。费用采用整数奈美元记录。

DeepSeek 预设计价采用 2026-10-27 官方高峰价，离峰也按这组较高费率估算，因此可能提早触发预算限制。价格与来源见[核对笔记](docs/deepseek-notes.md)。预留与估算是本机护栏，实际扣款仍以供应商帐单为准；供应商调价时应更新计价设定。

逾时、网路失败、无效用量与程序中断无法确认是否已扣款，因此保留整笔预留额，不当成免费。预算不足以预留下次呼叫时停止模型呼叫，仅在被叫时简短回应，其余保持静默，并每天最多通知主人一次。余额不足或模型异常也分别每天最多通知一次；主人须允许 bot 私讯。

DeepSeek 余额在启动与每日首次检查时查询，余额不足或查询失败会暂停模型呼叫，五分钟后重试。其他供应商的余额接口尚未实现，显示 TBD，但仍受本机预算限制。费用日志永久保留，只存时间、模型、用途、token、价格与预留／估算金额，不存金钥、群友 ID、名称或对话内容；重启保留费用、安静时间与主动插话计数。

## 检查与建置

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

`pnpm format` 依 Prettier 统一排版（程式码使用 tab）；`lint` 同时检查 ESLint 与 Prettier。测试使用假 fetch、本机 HTTP 假伺服器与假的 Discord 讯息，不会呼叫外部模型 API 或登录 Discord。

建置输出位于 `dist/`，可用 `node --env-file-if-exists=.env dist/index.js` 启动。正式部署的密钥由 Doppler 注入。

本阶段没有长期记忆、人物卡、日记、表情包或外部知识。群友资料继续放在独立私人位置，仓库排除 `memory/` 与资料库。费用储存使用 [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)，其 [MIT 授权](https://github.com/WiseLibs/better-sqlite3/blob/master/LICENSE)允许商业使用，套件保留原授权声明。
