# Supabase 数据与文件恢复手册

本手册说明如何生成交接数据副本、确认副本完整性，以及把业务行和 Storage 文件恢复到新 Supabase 项目。

## 备份内容与边界

在 `projects/` 目录执行：

```powershell
node scripts/handover-export.mjs
```

默认输出到 `D:\WeiXun\outputs\handover-data-<时间>`。如需指定位置：

```powershell
node scripts/handover-export.mjs --out "D:\handover\data"
```

网络直连 Supabase 不通时，可指定项目使用的 HTTP/HTTPS 代理：

```powershell
node scripts/handover-export.mjs --proxy "http://127.0.0.1:7897"
```

脚本从 `projects/.env.local` 读取 `SUPABASE_URL` 和 `SUPABASE_SERVICE_ROLE_KEY`，不打印这两个值。输出目录结构如下：

```text
manifest.json                 # 来源、起止时间、逐表数量、对象 SHA-256、脱敏与错误记录
tables/<表名>.json            # PostgREST 可读的 public 表，全量分页 JSON
auth/users.json               # Supabase Auth 用户元数据（认证凭据字段已排除）
storage/<bucket>/<SHA-256>    # Storage 原文件；manifest.path 保存原始对象路径
```

数据读取使用多次 REST 请求，备份期间仍可能有用户写入，因此它不是数据库事务时点快照。`manifest.json` 记录逐表 PostgREST 总数与已导出数；每张表都应 `count_verified: true`，`errors` 应为空；另行阅读 `warnings` 中 Auth 元数据等可选读取提示。Storage 对象清单带有对象大小、元数据、SHA-256。发现 API 环境变量的实际值出现在 JSON 数据正文或文本文件中时，脚本以 `[REDACTED]` 替换并记录字段位置；若配置密钥出现在二进制文件中，会跳过该文件以免破坏文件内容。明确的认证字段（例如 password hash、API key、登录/认证 token）会从数据记录中省略并在 manifest 登记；业务线索中的 `secret` 文本和非认证用途的业务 token 原样保留。

该备份包含 PostgREST 暴露且当前服务密钥可读的业务表、可选的 Supabase Auth 用户元数据和 Storage bucket 对象。它不包含可直接执行的 DDL、Postgres 扩展、触发器/RPC 函数定义、RLS/授权策略、Auth 密码哈希/验证 token、`auth.users` 的认证凭据，亦不包含 Supabase 项目设置和密钥。项目版本化表结构、策略与迁移在 `projects/supabase/migrations/`；详细交接和操作说明见同目录 `README.md`。

本项目的登录路由由应用实现，手机号验证码与密码登录当前是演示流程；会话凭据用服务端签名生成，不持久化在 Supabase Auth。`auth/users.json` 仅作如启用 Supabase Auth 时的身份线索，恢复账号时必须通过目标系统的正式邀请/注册流程重新建身份、重置口令并重新登录。不要把旧会话 token 搬到新环境。

## 完整性检查

1. 打开 `manifest.json`，核对 `summary.tables_discovered` 与 `summary.tables_exported` 相等，所有表 `count_verified` 为 `true`，`errors` 为空；阅读 `warnings` 并处理可选 Auth 元数据未读取等提示。
2. 也可离线运行 `node scripts/handover-restore.mjs --data "<备份目录>" --verify-only`。这会校验 manifest、表 JSON 行数和所有 Storage 对象的本地 SHA-256，不连接数据库也不写入。
3. 检查 `summary.objects` 和 `summary.storage_bytes` 符合预期；逐个检查 Storage 对象条目有 `sha256`，且文件确实存在。
4. 如果 `table_discovery.source` 是 `drizzle-schema-fallback`，说明 OpenAPI 无法列出实际可读表，脚本使用了仓库 ORM schema 作为不完整回退。此副本不能据此宣称包含了服务端所有业务表；在源项目恢复连通后重新导出。
5. 备份非事务一致快照。需要精确切换窗口时，先停止应用写入，再执行备份；确认 manifest 的 `finished_at` 后再开放目标环境。
6. 交接包应与数据副本分开放置。含手机号、邮箱、训练记录等业务信息的备份应仅交给有权限的接手人，通过受控渠道传输并限制访问。

## 恢复到新 Supabase 项目

恢复前先完成密钥轮换与项目隔离。新旧项目同时使用时，确认新环境的 `.env.local` / 部署密钥库指向目标 Supabase，并重新设置所有 AI Provider API key、`SESSION_SECRET` 和 `GAME_RANDOM_SECRET`。这些值不会包含在项目包或数据备份中。

1. 在 Supabase 创建目标项目，记录其新 `SUPABASE_URL`、匿名 key、服务端 service-role key 和数据库连接地址。只把真实值写入受保护的 `.env.local` 或部署密钥库。
2. 在应用目录使用匹配 Node/pnpm 版本安装依赖，按本目录的 `README.md` 和本手册设置好目标项目连接。
3. 在 `projects/` 执行 `corepack pnpm exec supabase link --project-ref <目标项目引用>`，确认 CLI 指向目标项目；再按团队变更审核流程执行 `corepack pnpm exec supabase db push --include-seed`。先检查 CLI status/目标 ref，避免把迁移推到源项目。
4. 用只读预演检查目标库和备份，再明确加 `--apply` 执行恢复。恢复工具会验证表文件/行数/Storage SHA-256，要求 PostgREST 表发现完整，检查目标迁移后的 schema 和主键，拒绝已有业务记录的目标表，按目标外键拓扑顺序在单个事务内导入，并推进 serial sequence：

   ```powershell
   node scripts/handover-restore.mjs --data "D:\WeiXun\outputs\handover-data-<时间>"
   node scripts/handover-restore.mjs --data "D:\WeiXun\outputs\handover-data-<时间>" --apply
   ```

   `--database-url-env DATABASE_URL` 可改用其他环境变量名。工具从 `.env.local` 读取连接配置，不在命令行参数中放密码；`--apply` 会拒绝回写 manifest 指向的源 Supabase 项目。迁移生成的 `health_check`、`project_scenarios` 和 `scenario_templates` seed 行仅在主键完全属于源备份时允许 upsert；其它有记录的目标表一律停止。周期性快照写入过程中发生的变化以 manifest 报告为准。遇到外键循环、schema 不匹配、缺失关键列或目标存在不匹配 seed 行时，恢复会拒绝执行。
5. 数据库恢复通过后，将目标 `SUPABASE_URL` 与 `SUPABASE_SERVICE_ROLE_KEY` 安全配置到 `projects/.env.local`，再运行 Storage 工具。它会先核对备份中每个文件的大小与 SHA-256，默认只列出目标 bucket；加入 `--apply` 才会创建/更新 bucket、按原 bucket/path 上传对象，并逐个重新下载核对 SHA-256：

   ```powershell
   node scripts/handover-restore-storage.mjs --data "D:\WeiXun\outputs\handover-data-<时间>"
   node scripts/handover-restore-storage.mjs --data "D:\WeiXun\outputs\handover-data-<时间>" --apply
   ```

   网络经代理连接时附加 `--proxy "http://127.0.0.1:7897"`。上传采用 `upsert: true`，中断后可以安全重跑；逐对象遇到失败时脚本停止并保留已完成部分，修复后重跑即可。
6. 不导入 `auth/users.json` 中的 credential；按系统当前登录流程重新创建/邀请账号并重置口令，重新确认角色和企业归属。为新环境签发全新的 session。
7. 用目标环境的非生产账号逐页验收玩家、教练、企业管理员和设计师页面；检查 NPC 图片/表情、场景图和附件引用可读。素材引用若使用旧 Storage host 的绝对 URL，应在新库上传后将引用迁移为新 URL 或 bucket 路径。
8. 验收通过后，在部署平台替换 `SUPABASE_URL`、`SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY` 与模型凭据。检查运行日志无连接错误，再开放给用户。

迁移 SQL 的 seed 与真实业务备份是两类数据：seed 用于场景等初始内容，表 JSON 是源库业务记录。恢复脚本仅对三张明确的 seed 表按主键核对并 upsert 源快照内容；如果目标还有源快照之外的 seed 行会停止。其它业务表必须为空，不要在有用户数据的目标库直接恢复。

## 恢复失败时

- `401/403`：确认目标 URL 与 service-role key 配对，确认 `SUPABASE_SERVICE_ROLE_KEY` 未被浏览器 key 替代。
- 缺表或列：先确认所有目标迁移已应用，再确认源码版本和备份来源一致；脚本可能在从 ORM 回退时没有发现部署中的额外表。
- 外键冲突：按父子关系调整导入顺序，先恢复被引用记录。目标库已有内容时，先做另一份数据库备份并人工比较 ID。
- 序列生成值冲突：恢复后检查自增序列已推进到已导入主键最大值之后。
- 图片/文件 404：检查原始对象相对路径、bucket ID、RLS/公开访问配置以及数据库中保存的 URL 是否仍指向旧项目。
- 行数或文件摘要不一致：停止切换，保留两边证据，重新导出/上传。不要把错误数不为零或数量未验证的副本标为交接完成。

## 回到原项目

恢复结束后更新 `projects/.env.local` 或部署 secret 到目标项目，运行 `pnpm local:check`，再执行 `pnpm ts-check`、`pnpm lint:build` 和 `pnpm build`。托管数据库连接问题可先按环境网络策略配置经批准的代理，再重试健康检查；不要将代理账号或密钥写进命令历史、Git 或日志。
