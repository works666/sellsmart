# 当前架构

## 运行链路

```text
Browser
  -> Next.js 页面/API Routes
  -> 服务端游戏循环（目标、状态、上下文、记忆）
  -> Supabase/PostgreSQL（权威状态、消息、事件）
  -> OpenAI 兼容 AI Provider（NPC 对话、场景、复盘）
```

应用不依赖 Coze 运行时或 Coze SDK。`src/lib/ai/client.ts` 通过服务端 `fetch` 调用 `${AI_BASE_URL}/chat/completions`，支持普通 JSON 和 SSE 流式响应；API key 只存在于服务端环境。

## 对话与记忆

- 权威键为 `gameSessionId + npcId`。
- 浏览器发送本轮消息，服务端加载 NPC 画像、结构化游戏状态、滚动摘要和最近 12 条消息。
- 达到摘要阈值后压缩旧消息，保留摘要与最近窗口，避免每轮无限重发上下文。
- 一次玩家对话通常对应一次模型调用；需要独立复盘或摘要时会产生额外调用。
- AI 负责生成自然语言和受约束的建议值，确定性代码负责校验、计分、解锁和落库。

## 项目一循环

```text
创建对局 -> 五轮 playing
  -> NPC 对话 / 关系动作 / 结束本轮
  -> 服务端校验和事件记录
  -> 第五轮确定性判定 won/lost
  -> 保存五维结果与 AI 复盘
```

状态存于 `game_runtime_states`，事件存于 `game_events`，消息存于 `chat_messages`。真实数据库迁移与恢复测试尚待本地 Supabase 启动后完成。
