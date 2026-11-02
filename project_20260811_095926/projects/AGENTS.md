# AGENTS.md — 政企销售竞标实训

## 项目定位

- 类型：Next.js 全栈 AI 销售实训游戏。
- 当前优先范围：项目一（单单位内部竞标）的完整闭环。
- 包管理器：只使用 pnpm。

## 技术约束

- Next.js 16 App Router、React 19、TypeScript 5、Tailwind CSS 4。
- 数据层使用本地或托管 Supabase，结构由 Drizzle schema 和 `supabase/migrations/` 管理。
- AI 层只通过 `src/lib/ai/client.ts` 调用 OpenAI 兼容的 `/chat/completions` 接口；业务代码不得绑定具体模型厂商 SDK。
- AI 对话优先使用 SSE 流式输出；API key 只能来自服务端环境变量，禁止提交到 Git 或下发浏览器。
- 服务端游戏状态是权威来源；客户端不得自行修改回合、分数、亲密度或阶段状态。
- 新增未解决问题必须写入 `../harness/issues/ISSUE_REGISTER.md`，只变更状态，不删除历史项。

## 目录

- `src/app/`：页面与 API Routes。
- `src/lib/ai/`：AI Provider、提示词、工作流。
- `src/lib/game/`：游戏循环、目标、上下文与记忆。
- `src/storage/database/`：16 张表的 schema、Supabase 客户端与仓储。
- `supabase/`：本地 Supabase 配置、迁移、seed。
- `scripts/`：本地环境辅助与自动化验证。

## 验证命令

```bash
pnpm ts-check
pnpm lint:build
pnpm test:ai-provider
pnpm test:game-state
pnpm test:metrics
pnpm build
```

`.cozeproj/` 是接手项目时保留的历史原型/素材目录，不是运行时依赖。
