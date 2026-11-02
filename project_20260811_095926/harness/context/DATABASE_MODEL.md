# 数据库模型

`projects/src/storage/database/shared/schema.ts` 是当前数据库模型的代码源；`projects/supabase/migrations/` 保存从该 schema 生成的完整初始迁移及后续主键、RLS 与多人协作修正。

| 领域 | 表 |
|---|---|
| 基础 | `health_check` |
| 用户与企业 | `enterprises`, `invite_codes`, `user_identities` |
| 内容配置 | `industries`, `product_categories`, `scenario_templates`, `decision_makers`, `project_scenarios`, `product_knowledge` |
| 对局 | `game_sessions`, `chat_messages`, `affinity_scores`, `player_ability` |
| 权威运行状态 | `game_runtime_states`, `game_events` |
| 多人五阶段协作（已远程应用） | `multiplayer_rooms`, `multiplayer_company_slots`, `competitor_claims`；各公司权威运行状态继续存放于 `game_runtime_states` |

API 还引用 10 张未进入本地 schema 的历史/延期表：`game_groups`、`coach_history`、`game_initiations`、`scenario_locks`、`game_rooms`、`enterprise_customizations`、`enterprise_history`、`competitor_profiles`、`npc_profiles`、`project_difficulties`。这些引用不能视为已验证的数据模型，后续应按实际功能逐一建模或移除。

所有已建模的 public 表均已启用 RLS；`20260819000100_lock_down_public_tables.sql` 已移除旧表的宽松 public policy，并统一限制为仅服务端使用 `SUPABASE_SERVICE_ROLE_KEY` 访问。匿名 key 的远程只读验证返回 0 行，service-role 访问正常。OPS-002 仍跟踪备份、敏感数据和其余发布检查。

`20260819000200_five_stage_multiplayer.sql` 已成功应用到关联 Supabase 开发库，`supabase migration list` 已与本地迁移对齐，远程 `db lint` 为 0 error。双账号 multiplayer E2E、single-save E2E 和项目一真实纵向 E2E 均已通过；生产库迁移仍不在本次范围内。
