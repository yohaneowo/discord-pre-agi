# DeepSeek 官方资料核对

查询日期：2026-10-27。以下以当日官方文件为准，原计划与研究笔记保留为背景，不作为价格依据。本阶段只核对文件，没有呼叫真实 API、查询实际余额或产生模型费用。

## 网址与模型

| 项目                 | 核对结果                                                                                                                | 来源                                                                                                              | 查询日期   |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------- |
| OpenAI 相容 base URL | `https://api.deepseek.com`；聊天请求为 `POST /chat/completions`                                                         | [首次调用](https://api-docs.deepseek.com/)、[聊天接口](https://api-docs.deepseek.com/api/create-chat-completion/) | 2026-10-27 |
| 当前模型名           | `deepseek-flash` 对应 `DeepSeek-V4.1-Flash-1017`；另列 `deepseek-v4-pro` 对应 `DeepSeek-V4-Pro-0813`                    | [模型与价格](https://api-docs.deepseek.com/quick_start/pricing/)                                                  | 2026-10-27 |
| 旧模型名             | `deepseek-v4-flash`、`deepseek-v4-flash-vision-exp` 仍接受请求，但旧模型已下线，改由 Flash-1017 服务并按 Flash 计费     | [首次调用](https://api-docs.deepseek.com/)                                                                        | 2026-10-27 |
| 余额查询             | `GET https://api.deepseek.com/user/balance`；回应含 `is_available` 和 `balance_infos`，各币别有总额、赠金、充值余额字串 | [余额接口](https://api-docs.deepseek.com/api/get-user-balance/)                                                   | 2026-10-27 |

## 缓存与美元计价

下表单位均为美元／百万 token，直接抄录美元价格，不用人民币换算。

| 模型              | 时段 | 输入缓存命中 | 输入缓存未命中 | 输出 |
| ----------------- | ---- | ------------ | -------------- | ---- |
| `deepseek-flash`  | 离峰 | 0.003        | 0.15           | 0.60 |
| `deepseek-flash`  | 高峰 | 0.006        | 0.30           | 1.20 |
| `deepseek-v4-pro` | 离峰 | 0.022        | 0.66           | 1.98 |
| `deepseek-v4-pro` | 高峰 | 0.044        | 1.32           | 3.96 |

来源：[官方美元价格表](https://api-docs.deepseek.com/quick_start/pricing/)，查询日期：2026-10-27。原调研的 Flash 输入 US$0.14、缓存命中 US$0.0028、输出 US$0.28 与当前价格表不符，本阶段采用上表，不将旧价格写进程式。

缓存默认启用，依赖已持久化的相同前缀，属于尽力提供，不能保证命中。回应 `usage.prompt_cache_hit_tokens` 与 `usage.prompt_cache_miss_tokens` 分别表示输入命中与未命中 token 数；客户端保留这两个可选字段，缺少时不猜成零。

来源：[上下文缓存](https://api-docs.deepseek.com/guides/kv_cache/)，查询日期：2026-10-27。

## 高峰与离峰时段

周一至周五，排除中国法定节假日：UTC 01:00～04:00、06:00～10:00 为高峰。换成台湾时间（UTC+8）为 09:00～12:00、14:00～18:00；其余时段及周末、中国法定节假日全天为离峰。离峰价为高峰的一半。

来源：[英文价格表](https://api-docs.deepseek.com/quick_start/pricing/)、[中文价格表](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)，查询日期：2026-10-27。

## 尚未验证的帐户资讯

实际赠金额度、到期日、帐户可用余额：TBD，需要帐户持有人自行在开放平台确认。阶段 0 不实现余额查询、费用估算、预算护栏或离峰排程；这些留待后续对应阶段。
