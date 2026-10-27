# DeepSeek 生态与鲸鱼娘人设调研（2026-10-27）

项目开始前的调研笔记；价格以 `docs/deepseek-notes.md`（对照官方文件核对）为准。

## 1. dsh（DeepSeek Harness）与免费插件
- dsh 软件本身免费开源，但调用模型需要 DeepSeek 开放平台 API Key（预充值、按 token 计费）。免费的 DeepSeek App/网页版与 dsh 无关。
- 官方 Flash 离峰价（每百万 token）：缓存命中输入 ¥0.02、未命中 ¥1、输出 ¥4；高峰（9–12、14–18）2 倍。
- dsh-our-free-model 插件的价值是走 OpenCode Zen / Kilo 免费池省 API 费；风险：免费池可能记录提示词、作者可推公告与自动升级。建议私有项目用官方/付费 API，免费插件只做不敏感的事。
- 桌面版插件只能在 app 内 设置 → 插件 安装（CLI 只对 web profile 有效）。

## 2. “大肥鱼”（DeepSeek 鲸鱼娘）
- 社区二创，非官方，模型也没有内置隐藏人格。起源：把鲸鱼 logo 给模型，它自称“大肥鱼”；结合便宜大碗、长思考、摸鱼等特点形成人设（蓝发女仆装、鲸尾、傲娇天然呆、爱吃白米饭和 Token、不许说胖）。
- 玩法①：贴【PERSONA_LOAD】标签组；ChatGPT、Grok 也会入戏，说明是模型把标签当模糊角色描述补全（Claude 拒绝）。参考 https://cuiliang.ai/posts/deepseek-whale-girl-role-dsl/
- 玩法②：做成 dsh agent preset，只换语气、保留能力。

## 3. 相关 repo 对比
| repo | 类型 | 星 | 说明 |
|---|---|---|---|
| Small-tailqwq/dsh-deep-whale | dsh 皮肤 | ~2900 | 最多人用，换外观 |
| TreapGoGo/deepseek-whale-girl | 素材库 | ~613 | 设定图、提示词、ComfyUI 工作流、画廊，MIT（作品版权归作者） |
| Neko3000/deepseek-whalechan | 素材库 | ~474 | 高一致性角色规格（5 种身形）、agent 技能包；部分 CC BY-NC-SA 不可商用 |
| OMGLogic/dsh-whale-persona | dsh 插件（有代码） | ~42 | 全局注入、有开关、人设可在设置页改；默认只有 10 行标签，含 OBEY_MASTER_ALWAYS，无优先级 |
| linsport/dsh-whale-persona | dsh 预设（无代码） | ~14 | 约 2.3 万字符完整人设 v8.1.4；按会话选用；优先级：安全>事实>用户指令>语气；代码/命令不掺语气；需开两块记忆空间 |
- 素材类两者可同时使用；人设类两者会冲突（同会话叠两份人设），只装一个，推荐 linsport。公开用途不要直接用他人图，参考做法自行生成。

## 4. 模型与价格（每百万 token，2026-10-27 查询）
- DeepSeek V4 开源：Hugging Face MIT 授权可商用。V4-Flash 284B（激活 13B），V4-Pro 1.6T（激活 49B），均 1M 上下文；本地跑不动，需多张高端 GPU。
- DeepSeek V4 Pro 官方 $1.32/$3.96 vs Claude Sonnet 5 $2/$10；跑分各来源不一，大致同一梯队，Sonnet 复杂工程略强，DeepSeek 性价比高（现已有 Sonnet 5.5，未比较）。
- OpenRouter 最便宜：V4 Flash DeepInfra $0.09/$0.18；V4 Pro Relace $0.9/$1.5；v4-pro-0813 $0.66/$1.98；v4.1-flash:batch $0.05/$0.15。储值手续费约 5.5%。
- Claude Haiku 5.5 $0.10/$0.50（Haiku 4.5 为 $1/$5）vs DeepSeek V4.1 Flash $0.14/$0.42：实力相近，Haiku 终端操作更强（36% vs 20%）。结论：价格接近时倾向 Haiku 5.5。
- OpenRouter：统一 API 入口，聚合数百模型、多家托管商，可国际信用卡付款、OpenAI 兼容格式；代价是手续费与多一层中间商（需关闭会记录数据的托管商）。闭源模型不会更便宜。

## 7. dsh 记忆插件参考
- sikwoxy/dsh-tool-memory（~4 星，8 月后未更新，可能不兼容 dsh 0.2）：移植 Hermes Agent 记忆；MEMORY.md + USER.md，容量约 2200/1375 字符；会话开始注入冻结快照（保 prefix cache）；每 10 条用户消息后台子代理自动沉淀记忆；写前威胁扫描。可借鉴：后台自动整理、冻结快照。
- Yuuyuko-uu/dsh-fish-memory（~275 星，MIT，持续更新，对应 dsh 0.2.1-rc.3）：会淡忘但不删（鲜活度半衰期 30 天）、长期事实不淡且每轮固定注入、每日记 8 条/每次注入 6 条上限、按词命中+鲜活度/重要度/情绪排序召回、召回过程可见、可导入旧 Markdown 档案改写成记忆；数据存 .dsh/fish-memory-config.json；检索为中文分词关键词，非语义向量。

## 本项目的记忆方案

- 采用混合方案——Obsidian Markdown 为正本 + 借鉴 fish-memory 的淡忘/重要度/情绪召回规则 + 语义索引。

## 8. DeepSeek API 最便宜渠道（2026-10-27 查询，每百万 token）
- 官方（platform.deepseek.com）：模型名 deepseek-flash 现由 V4.1-Flash-1017 提供；V4 Flash 输入 $0.14（缓存命中 $0.0028）/ 输出 $0.28；V4 Pro $0.435 / $0.87（官方平台页）。高峰时段加倍；台湾付款可能不便。注意：早前写的 ¥1/¥4 换算偏高，以官方美元价为准。
- OpenRouter（统一入口，充值手续费约 5.5%）：V4.1 Flash 便宜且可靠的托管商 Decart $0.09/$0.18、Sail Research $0.09/$0.25；批次 v4.1-flash:batch $0.05/$0.15。可设定只用不经中国的托管商并关闭数据记录。
- DeepInfra 直营：Flex $0.112/$0.336，标准 $0.14/$0.42（特价），美国、信用卡付款、无 OpenRouter 手续费。
- SiliconFlow：$0.15/$0.60，缓存命中仅 $0.003（长人设反复发送时划算）。
- 不建议：OpenInference 标价 $0.036/$0.01，FP4 重度压缩、当天改价，品质与稳定性无保证。
- 建议：起步用 OpenRouter + 限定 Decart/DeepInfra；用量变大改直连 DeepInfra。

## 9. 月费方案（DeepSeek 官方无订阅）
- OpenCode Go：$10/月，32 个开源模型（含 V4.1 Flash、V4 Pro），约 $60/月用量额度，另有每 5 小时/每周上限；声明不训练、多数模型零保留。
- Chutes：$3/月起，额度与稳定性视方案。
- 火山引擎 Ark Coding Plan：首月 ¥9.9，之后 ¥40/月，需大陆手机号。
- DInference：号称 $9.95/月无限 V4.1 Flash，测试阶段、合理使用限制，未验证。
- 注意：多为 Coding Plan，条款常限定编程工具使用；24 小时 Discord 机器人可能违反条款被限流/封号。
- 建议：自用编程/dsh 用 OpenCode Go；Discord 机器人按 token 付费（Flash 群聊预估每月几美元）。
