# AI Provider 预设

本文用于项目一五人版真实 AI 测试。项目通过 `src/lib/ai/client.ts` 使用 OpenAI-compatible 接口。服务端配置各供应商环境变量后，可在设计师后台 `/designer/ai-provider` 保存全局正文 AI 接口选择；新发起的请求生效。

## 接口要求

供应商必须同时支持：

- `POST /chat/completions`（`AI_BASE_URL` 可填到基础路径，客户端会自动补上该路径）。
- Bearer API key、`messages`、`model`，以及常用的 `temperature` / `max_tokens` 参数。
- `response_format: { "type": "json_object" }`，用于项目计划、拜访方案等结构化输出。
- `stream: true` 的 SSE 流式响应，按 `data: {...}` 返回增量内容，并以 `data: [DONE]` 结束。

API key 只放在服务端环境变量中，不要写入代码、提交 Git 或发送到浏览器。本文只使用占位值。

## 推荐预设

### 1. 当前推荐：DeepSeek

- `AI_BASE_URL=https://api.deepseek.com`
- `AI_MODEL=deepseek-v4-flash`
- 兼容 Chat Completions 和 JSON 输出，适合作为当前稳定、低成本的测试默认值。
- 当前整理的官方价格：input cache miss **$0.14/M**，output **$0.28/M**；价格可能变化，使用前请以官方页面为准。

```dotenv
AI_BASE_URL=https://api.deepseek.com
AI_MODEL=deepseek-v4-flash
AI_API_KEY=...
```

### 2. 免费首选：Gemini

- `AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai`
- `AI_MODEL=gemini-3.1-flash-lite`
- 适合低成本或免费层测试。
- 免费层受地区、配额和数据使用政策约束，实际可用性和限制以账号所在地区及供应商控制台为准。

```dotenv
AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
AI_MODEL=gemini-3.1-flash-lite
AI_API_KEY=...
```

### 3. 免费冒烟：OpenRouter

- `AI_BASE_URL=https://openrouter.ai/api/v1`
- `AI_MODEL=openrouter/free`
- 无充值时约 **50 req/day** 的免费额度口径，具体限制可能变化。
- 该模型名会动态路由到不同模型，不适合稳定评测、回归测试或生产环境；适合先验证接口连通和页面流程。

```dotenv
AI_BASE_URL=https://openrouter.ai/api/v1
AI_MODEL=openrouter/free
AI_API_KEY=...
```

### 4. OpenAI 低价可选

- `AI_BASE_URL=https://api.openai.com/v1`
- `AI_MODEL=gpt-5.6-luna`
- 当前整理价格：input **$0.20/M**，output **$1.20/M**。
- 无免费 API tier，需要账户有可用余额或计费权限。

```dotenv
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=gpt-5.6-luna
AI_API_KEY=...
```

### 5. Qwen（阿里云百炼）

- `QWEN_AI_BASE_URL=https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`
- `QWEN_AI_MODEL=qwen-plus`
- 将 `{WorkspaceId}` 替换为百炼工作空间 ID，并使用同一地域签发的 API Key。不同地域的 Base URL 和 API Key 不通用；以[官方 OpenAI 兼容接口说明](https://help.aliyun.com/en/model-studio/compatibility-of-openai-with-dashscope)为准。
- `qwen-plus` 是官方文档的兼容调用示例模型；模型能力和账号权限以[官方模型列表](https://help.aliyun.com/en/model-studio/models)为准。接口会按调用选项发送 `enable_thinking`，以控制支持混合思考的模型。

```dotenv
QWEN_AI_BASE_URL=https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1
QWEN_AI_MODEL=qwen-plus
QWEN_AI_API_KEY=...
```

命名 Provider 使用独立的 `QWEN_AI_*` 配置，不会回退到全局 `AI_*`；`.env.local` 修改后需重启服务。

## 切换与验证

1. 在 `projects` 的服务端环境中设置所需的 `DEEPSEEK_AI_*`、`DOUBAO_AI_*` 或 `QWEN_AI_*`（真实 Key 不要写入本文或 Git）。旧 `AI_*` 仍可作为“旧默认接口”使用。
2. 重启服务，使环境变量重新加载。在设计师后台“AI 接口配置”中确认目标显示“服务端已配置”，选择并保存。
3. 新发起的正式游戏、预览及其他未指定 Provider 的正文调用使用该选择。提示词 A/B 测试的显式 DeepSeek/豆包轨道仍按各自接口运行；Jev/LLM 结构化决策开关也独立。
4. 在 `projects` 目录运行：

```bash
pnpm test:ai-provider
pnpm ts-check
pnpm test:project-one-preview-ai
```

如果供应商不支持 JSON 模式或 SSE，即使普通文本请求成功，也不能满足当前项目一五人版的完整测试契约。

## 张建国提示词 A/B 测试台

`/designer/dialogue-prompts` 会同时调用 DeepSeek 和豆包。它不切换全局 `AI_*`，而是使用两套独立的服务端配置，因此可以在同一轮中做可比测试：

```dotenv
DEEPSEEK_AI_BASE_URL=https://api.deepseek.com
DEEPSEEK_AI_API_KEY=你的_DeepSeek_Key
DEEPSEEK_AI_MODEL=deepseek-v4-flash

DOUBAO_AI_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
DOUBAO_AI_API_KEY=你的_火山方舟_Key
DOUBAO_AI_MODEL=你在方舟账号中已开通的_Model_ID_或_Endpoint_ID
```

豆包的 `DOUBAO_AI_MODEL` 不要照抄文档里的示例值：填写方舟控制台中与该 API Key 同地域、已激活且可调用的 Model ID，或推理接入点的 `ep-...` ID。修改 `.env.local` 后必须重启本地服务。

测试台固定为张建国（`P1-001`）和当面拜访。每个模型轨道先调用 NPC Generator，只生成角色正文；再以独立上下文调用 Evaluator，返回严格 JSON。支持度、愉悦度、五维、阻断和线索均由服务端代码校验后结算，两个轨道的会话与状态彼此隔离。

专项验证：

```bash
pnpm test:prompt-test
pnpm ts-check
```
