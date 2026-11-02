# 政企销售竞标实训

基于 Next.js 16、React 19、Supabase 和通用 OpenAI 兼容接口的 AI 销售实训游戏。本项目已脱离 Coze 运行时，可在普通开发环境运行。

## 本地准备

需要 Node.js 20+、pnpm 9+、Docker Desktop 和 Supabase CLI。Windows 推荐使用 Scoop 安装 CLI：

```powershell
scoop install supabase
```

首次启动。脚本检测到 Docker 时启动本地 Supabase；没有 Docker 时显示托管 Supabase 的连接步骤：

```powershell
pnpm install
./scripts/setup-local.ps1
```

脚本会创建 `.env.local`（若不存在）、启动本地 Supabase 并显示连接信息。把输出中的 API URL、anon key 和 service_role key 填入 `.env.local`，再填入模型服务配置：

```dotenv
AI_BASE_URL=https://your-provider.example/v1
AI_API_KEY=your-api-key
AI_MODEL=your-model-name
```

`AI_BASE_URL` 必须对应支持 `POST /chat/completions` 的 OpenAI 兼容地址。密钥只放在 `.env.local`，该文件不会进入 Git。

## 常用命令

```powershell
pnpm local:check
pnpm dev
pnpm build
pnpm start
pnpm test:ai-provider
pnpm test:game-state
pnpm test:metrics
pnpm supabase:start
pnpm supabase:stop
pnpm supabase:reset
```

`supabase:reset` 会清空并重建本地数据库，然后执行迁移和 seed。

## 关键目录

- `src/app/`：页面和 API Routes。
- `src/lib/ai/`：模型接口、提示词和对话工作流。
- `src/lib/game/`：服务端权威游戏循环、状态和记忆管理。
- `src/storage/database/`：Supabase 客户端、Drizzle schema 与仓储层。
- `supabase/migrations/`：本地/部署数据库迁移。
- `supabase/seed.sql`：可重复执行的基础数据。
- `scripts/`：环境检查和自动化测试。

`.cozeproj/` 只保留原项目的原型与历史素材，不参与安装、构建或运行。
