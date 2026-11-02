# FAST 测试账号使用说明

## 登录

- 账号：`fast_acceptance`
- 密码：`fastpass`
- 身份：选择“玩家 / 付费个人”

登录后按正常流程选择项目并进入游戏。页面右侧会出现“FAST 测试后台”入口，普通账号不会显示。

## 测试后台

面板包含三个标签：

1. **AI 追踪**：查看真正发送给 Provider 的 `messages`、模型、温度、JSON/思考模式、耗时、原始返回或错误。
2. **当前状态**：查看新五人预览的 support、pleasantness、五维、有效接触、节点、工作记忆、blocker 和最近消息。
3. **数据表**：查看该测试账号自己的 `game_sessions`、`game_runtime_states`、`chat_messages`、`game_command_records`、`game_events`、`affinity_scores` 和 `player_ability` 限量快照。

面板默认每 2.5 秒更新，可暂停、手动刷新、展开 JSON 或复制快照。

当前 AI 追踪覆盖项目一 NPC 对话：新五人 `/api/project-one-preview/ai` 和旧四人 `/api/chat/stream`。场景生成、最终复盘和礼品评估等其他 AI 路径尚不在该 ring buffer 中。

## 两条游戏链路的区别

- 默认单机进入 `/project-one-preview`：这是当前新五人版，用于测试本轮同步的分层人物提示词和评分器。状态在 Node 进程内，服务重启后清空，不会写入 Supabase 游戏表。
- `/game` 是旧四人的持久化链路，会产生 Supabase 数据表记录。这条链路不能代替新五人提示词验证。

因此，在五人预览中“数据表”为空并不代表测试失败；应主要查看“AI 追踪”和“当前状态”。

## 安全边界

- 服务端会二次校验签名 session 和 fast 用户 ID，不依赖前端开关。
- 数据库查询只能读取当前 fast 用户自己的会话。
- API Key、Authorization、token、cookie、password 和 secret 字段会在返回页面前脱敏。
- 生产环境默认关闭。本地 `.env.local` 已配置 `ENABLE_FAST_DEBUG=true`；修改环境变量后需重启服务。
