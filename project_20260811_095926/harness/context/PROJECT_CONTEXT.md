# 项目上下文

这是一个接手中的政企销售竞标 AI 实训项目。用户希望先完成项目一单人闭环，同时用 harness 管理目标、上下文、记忆、开发循环和动态问题，并使用 Git 保持可追溯。

## 当前产品范围

- 玩家与多个 NPC 对话、经营关系、发现线索并完成五轮竞标。
- 服务端维护权威状态、计分、解锁、事件和结算。
- AI 用于 NPC 自然语言、场景生成与赛后复盘；确定性规则控制游戏结果。
- 本期不完善多人联机、企业/教练后台、生产认证和完整四项目内容。

## 当前技术

- Next.js 16、React 19、TypeScript、Tailwind CSS。
- Supabase/PostgreSQL + Drizzle ORM，本地配置与迁移在 `projects/supabase/`。
- 通用 OpenAI 兼容 Chat Completions API，Provider 位于 `projects/src/lib/ai/client.ts`。
- 不依赖 Coze 环境；`.cozeproj/` 仅为历史原型和素材。

## 管理原则

- `harness/STATE.md` 给出当前执行状态。
- `harness/plans/` 管理当前范围与验证步骤。
- `harness/memory/` 保存决定、发现和交接。
- `harness/issues/ISSUE_REGISTER.md` 动态保留所有问题，不删除历史项。
