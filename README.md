# discord-pre-agi

Discord 群里像人一样的 AI 角色：有个性、记得群友和过去的事、知道什么时候不说话。DeepSeek 模型（OpenAI 相容格式），记忆以 Obsidian 风格的 Markdown 为正本，另建可重建的检索索引。

- 计划：[docs/plans/v1.md](docs/plans/v1.md)（分阶段，各有验收条件）
- 调研：[docs/research/deepseek-and-persona.md](docs/research/deepseek-and-persona.md)
- 状态：阶段 0（骨架）；仅在群聊被直接 @ 时固定回应，不呼叫模型。

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

复制 `.env.example` 为 `.env`，在每个 `=` 后面填值。范本只预填 DeepSeek 官方的网址与模型名（见核对笔记），没有任何凭证。不要提交 `.env`。

| 环境变数            | 说明                                                     |
| ------------------- | -------------------------------------------------------- |
| `DISCORD_TOKEN`     | 专用 Discord 应用程式的机器人凭证                        |
| `DISCORD_CLIENT_ID` | 应用程式的数字 ID                                        |
| `LLM_BASE_URL`      | 模型供应商的 HTTP(S) base URL，可含 `/v1` 路径           |
| `LLM_MODEL`         | 模型名称                                                 |
| `LLM_API_KEY`       | 模型供应商的 API 凭证                                    |
| `DAILY_BUDGET_USD`  | 大于零的每日美元预算；本阶段仅读取检查，尚未实施费用护栏 |
| `OWNER_DISCORD_ID`  | 主人的 Discord 数字 ID；本阶段仅读取检查                 |

DeepSeek 当前网址、模型、价格与来源见 [官方核对笔记](docs/deepseek-notes.md)。设定全部集中于 `src/config.ts`，缺值或格式错误会阻止启动，错误讯息不会回显设定值。

## Discord 准备与启动

建立专用的 Discord Application 与 bot，在开发者后台开启 **Message Content Intent**，用 `bot` 范围邀请到测试伺服器，并授予查看频道、传送讯息、读取讯息历史等回覆所需权限。程式仅要求 `Guilds`、`GuildMessages`、`MessageContent` 三个 intents。

```sh
pnpm dev
```

群友直接 @ 机器人时，会收到「咕噜，我在这儿，刚刚还在水里发呆呢。」固定一句话。其他机器人、自身讯息、私讯、仅回覆但未直接 @、全体提及均不回应。占位人设文字位于 `src/discord.ts`，后续再调整。

`dev` 会先编译，再载入 `.env` 并启动；修改程式后重新执行即可。

## 检查与建置

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

`pnpm format` 依 Prettier 统一排版（程式码使用 tab）；`lint` 同时检查 ESLint 与 Prettier。测试使用假 fetch 与假的 Discord 讯息，不会呼叫真实 API 或登录 Discord。

建置输出位于 `dist/`，可用 `node --env-file-if-exists=.env dist/index.js` 启动。正式部署的密钥由 Doppler 注入。

LLM 客户端目前独立存在，提供非串流 `/chat/completions` 请求、文字内容与 token 用量、逾时与错误分类；尚未接入固定回应流程。记忆、自动插话、费用纪录、预算护栏与主人指令留待后续阶段。群友资料继续放在独立私人位置，仓库排除 `memory/` 与资料库。
