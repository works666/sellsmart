# 本地开发环境

项目不再依赖 Coze。应用运行需要 Node.js 20+、项目锁定的 pnpm 9.0.0（通过 Corepack 调用）；当前开发流程使用托管 Supabase，不要求 Docker Desktop；AI 使用兼容 OpenAI Chat Completions 的模型服务。不要使用 PATH 中可能存在的 pnpm 11 重建依赖。

## 日常一键启动

在 Windows 资源管理器中双击仓库根目录的 `start-project.bat`。脚本会依次检查环境变量和托管数据库连通性；构建缺失或源码/关键配置晚于生产构建时自动重建。默认尝试 `http://127.0.0.1:5000/`；端口上只有构建号一致且数据库健康的本项目服务才会被复用，否则自动尝试后续端口并打开实际地址。服务运行期间保留命令行窗口，关闭窗口即停止服务。

## 首次设置

在 `projects/` 执行：

```powershell
corepack pnpm install --frozen-lockfile
./scripts/setup-local.ps1
```

Windows 可用 `scoop install supabase` 安装 Supabase CLI。脚本不会覆盖已有 `.env.local`；当前托管流程使用 `supabase link` 和 `supabase db push --include-seed`，无需启动 Docker。

复制并填写环境变量：

```powershell
Copy-Item .env.example .env.local
pnpm local:check
```

模型变量为 `AI_BASE_URL`、`AI_API_KEY`、`AI_MODEL`、`AI_REQUEST_TIMEOUT_MS`。数据库变量为 `SUPABASE_URL`、`SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY`。建议另设 `GAME_RANDOM_SECRET` 用于游戏概率签名；未设置时服务端回退到 `SESSION_SECRET` 或 service-role key。真实值不得提交、写入日志或发送到浏览器。

## 数据库

- 配置：`projects/supabase/config.toml`
- 迁移目录：`projects/supabase/migrations/`（完整初始结构及主键/RLS 修正按顺序执行）
- 初始数据：`projects/supabase/seed.sql`
- 重建命令：`pnpm supabase:reset`（会清空本地数据）

当前机器已完成 Supabase CLI 项目关联、迁移、seed 和托管数据库纵向冒烟。`20260817000100_single_active_game_session.sql` 已推送，用事务 RPC 和部分唯一索引保证每名玩家只有一个活动存档；数据库环境不再阻塞开发。

## 验证

```powershell
pnpm ts-check
pnpm lint:build
pnpm test:ai-provider
pnpm test:game-state
pnpm test:metrics
pnpm build
```

### 2026-09-08 缺陷回归与离线验证

日常命令建议使用 `corepack pnpm` 前缀，以读取 `package.json` 的精确版本。已有依赖时，启动/构建/验证脚本优先直接使用 `node_modules/.bin`，无需联网安装。首次安装或依赖变更仍需要相应缓存或网络；离线不等于数据库和模型服务可离线使用。

```powershell
corepack pnpm local:check:prompt-test
corepack pnpm test:local-env
corepack pnpm lint:cached
corepack pnpm test:prompt-test
corepack pnpm test:prompt-test-auth
corepack pnpm test:prompt-test-ui
corepack pnpm test:project-one-preview-ai
corepack pnpm test:completion-timestamp-e2e
```

双模型测试另需 `DEEPSEEK_AI_BASE_URL`、`DEEPSEEK_AI_API_KEY`、`DEEPSEEK_AI_MODEL` 和对应 `DOUBAO_AI_*`，不回退到全局模型。预检只显示变量名，不显示值。提示词工作台 API 只允许平台设计师权限；普通玩家/教练/企业管理员调用返回 403。

`test:completion-timestamp-e2e` 会连接已配置开发数据库，创建唯一临时对局验证完成时间、通知、重放与冲突，结束后只清理本次对局。其余上述专项使用本地确定性输入，不调用真实模型。两类 PDF、多尺寸和真实双模型完整发布验收仍见 TEST-003。

`test:ai-provider` 使用本地 mock，不需要真实 API key；`test:e2e` 会访问已配置的托管数据库和真实模型服务。
