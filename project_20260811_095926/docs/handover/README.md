# 政企销售竞标实训平台｜交接与操作手册

> 版本基线：2026-10-30。仓库根目录是本手册所在的 `project_20260811_095926/`，应用工程在其 `projects/` 子目录。手册描述当前代码和治理记录能确认的行为；外部数据库、Storage 和已部署站点是否与代码一致，要接手后实际核验。

## 1. 先看什么

本次真实数据导出数量、验证结果、包内文件范围和交付限制见 [2026-10-30 交接核验记录](./DELIVERY_REPORT.md)；实际恢复命令见 [数据恢复手册](./DATA_RESTORE.md)。

本次真实数据导出数量、验证结果、包内文件范围和交付限制见 [2026-10-30 交接核验记录](./DELIVERY_REPORT.md)；实际恢复命令见 [数据恢复手册](./DATA_RESTORE.md)。

建议按以下顺序接手：

1. 本手册，确认本地启动、系统边界、备份和常见故障处理。
2. [页面与接口清单](./页面与接口清单.md)，快速定位页面、API 和当前未完成项。
3. 仓库根目录 `PROJECT.md` 与 `harness/STATE.md`，了解目标、最新实现证据和限制。
4. `harness/plans/CURRENT_ITERATION.md`、`harness/issues/ISSUE_REGISTER.md`，查看批准范围及仍开放的问题。
5. `harness/memory/HANDOFF.md`、`DECISIONS.md`、`FINDINGS.md`，回溯最近交接、规则决定和发现。
6. `harness/context/LOCAL_DEVELOPMENT.md`、`SOURCE_OF_TRUTH.md` 和 `FRONTEND_TARGET_WEIXUN_WEB.md`，核对环境、素材来源和下一版设计差异。

仓库中的 `AGENTS.md` 与 `projects/AGENTS.md` 规定开发、Git、密钥和台账要求。改动业务代码、数据库迁移、脚本、`public/` 或 `package.json` 时，还须更新四份治理台账并运行 `scripts/harness-check.ps1`。

## 2. 项目概况与架构

本项目是政企/B2B 销售竞标实训应用。玩家与多个客户角色沟通，推进项目、管理时间和行动点、形成线索并完成结算；设计师可维护提示词、人物、活动门槛、图片、场景与模型配置。代码栈为 Next.js 16 App Router、React 19、TypeScript、Tailwind CSS 4、Node.js 20+。依赖由 `pnpm-lock.yaml` 锁定，使用 pnpm 9。

正式 `/game` 对局的关键状态由服务端根据版本化命令写入 Supabase/PostgreSQL。UI 调用同一 Next.js 服务里的 `/api/...` 路由；Drizzle schema、Supabase SQL 迁移和仓储集中在 `projects/src/storage/database/` 与 `projects/supabase/`。AI 生成经服务端 OpenAI 兼容 Chat Completions 客户端；Jev 结构化决策是独立调用链。浏览器不应持有供应商 API key 或 Supabase service-role key。

项目同时保留正式玩家 `/game`、五人预览 `/project-one-preview` 和旧式房间/教练功能。五人预览是隔离的设计、提示词和流程测试入口，不等同正式存档。项目一下一版参考素材 `Weixun Web/project1-prototype-v9.html` 及相关材料用于目标说明；现有页面不代表完整实现了所有目标交互。

重要能力边界（以代码及 2026-10-30 治理记录为准）：

- 项目一正式玩家入口是 `/game`；正式对局代码具有服务端状态、时间/行动点、NPC 沟通、结算和复盘路径。请按当前验收文档确认具体产品流程，不把旧流程稿当现状。
- `/project-one-preview` 使用 `projects/public/project1-prototype-v9.html`，供五人 AI 与交互测试。预览会话服务端持久化；本地浏览器还保存按身份隔离的 UI 快照。
- 设计师客户活动配置包含技术交流、案例参观、公司参观和饭局。活动使用匹配、策划与结算路径；`harness/STATE.md` 标明 2026-10-29 的实现为本地完成，实际数据库配置及部署没有在那次工作中实查。
- 设计师系统链路评测在本地完成并有模拟/隔离验证；治理记录未声称新增功能已完成付费模型的完整真实运行或远程部署。
- 企业管理和教练/多人页能打开，但代码记录仍有功能空态、未接入接口或实时同步缺口；见本手册“尚未完成的功能”和问题台账。
- 登录目前是演示实现：短信发送是成功占位；任意格式正确的 4–6 位验证码可通过；账号密码也没有对接真实身份验证；角色选择由客户端流程发起。此登录不能用于真实账户或生产安全边界。

## 3. 目录说明

| 路径 | 内容 |
|---|---|
| `projects/src/app/` | 页面、组件使用入口与 App Router API Routes。完整 URL 清单见 [页面与接口清单](./页面与接口清单.md)。 |
| `projects/src/components/`、`hooks/` | 共享 UI 组件和前端 hooks。 |
| `projects/src/lib/game/` | 正式对局、五人预览、NPC 活动、竞品、时间、规则和服务端状态。 |
| `projects/src/lib/ai/` | 通用 Provider、提示词、结构化决策和具体 AI 工作流。 |
| `projects/src/lib/auth/` | 当前演示登录令牌、会话和 API 权限守卫。 |
| `projects/src/storage/database/` | Supabase 客户端、Drizzle schema、关系定义和数据库访问。 |
| `projects/supabase/migrations/` | 版本化 SQL 迁移；按文件名排序执行。 |
| `projects/supabase/seed.sql` | 可重复执行的基础项目场景和健康检查数据，不包含线上业务库全量数据。 |
| `projects/assets/` | 随仓库保存的历史业务文档、表格和原型图片素材。 |
| `projects/public/` | 页面运行所用静态图像、图标、原型 HTML 和品牌素材。 |
| `projects/scripts/` | 环境检查、导入导出、专项验证和本地工具。 |
| `harness/` | 项目状态、决策、问题、计划、证据和交接记录。 |
| `outputs/`、`harness/evidence/` | 历史报告、测试证据和验收材料；其中部分证据仅作历史记录。 |

项目 Git 中的 `projects/assets/` 是已复制进来的业务素材。另有 `D:\WeiXun\竞标游戏项目相关\整理` 外部资料目录；根目录 `harness/context/SOURCE_OF_TRUTH.md` 记录该目录才是某些原始素材的资料来源，且原件可能有未解决冲突。仅复制 Git 仓库时不会包含外部资料目录，需按交接清单单独确认是否一起转交。

## 4. 本地安装与运行（Windows）

### 前置条件

- Windows PowerShell、Node.js 20 或更新的 20.x+ 版本、Corepack 与 pnpm 9。
- 一个可访问的开发 Supabase 项目；也可按本地环境说明运行 Supabase CLI，但需要 Docker。当前治理记录采用托管 Supabase 开发流程，不要求本地 Docker。
- 至少一个 OpenAI 兼容模型服务；使用 Jev 决策功能另需 Jev 配置。
- 首次装依赖须能连接包管理器/有缓存。应用运行时仍需数据库和模型服务网络连接。

### 首次设置

在仓库内 PowerShell 执行：

```powershell
cd .\projects
corepack prepare pnpm@9.0.0 --activate
corepack pnpm --version
corepack pnpm install --frozen-lockfile
Copy-Item .env.example .env.local
```

确认版本输出是 `9.0.0` 后再装依赖。本项目锁定 pnpm 9；个别 Windows/Corepack 安装可能仍从 PATH 启动到其他 pnpm 版本。不要用 pnpm 11 改写锁文件。`projects/README.md` 留有较早的本地 Supabase/Docker 准备说明；当前接手以根目录 `harness/context/LOCAL_DEVELOPMENT.md` 为准，可用已关联的托管开发 Supabase。

编辑 `projects/.env.local`，按 [环境变量清单](#5-环境变量) 填写连接信息和模型配置。`.env.local` 被 Git 忽略；只在受控本机保存，不要放进源码仓库、公开网盘或普通交接压缩包。`projects/scripts/setup-local.ps1` 可检查 Supabase CLI 并辅助配置；脚本不会替接手人提供 Supabase 项目或模型凭据。

验证环境：

```powershell
corepack pnpm local:check
```

若使用托管 Supabase，按环境文档完成 `supabase login`、`supabase link` 和经审阅的 `supabase db push --include-seed`。第一次对现有项目应用迁移前，先做数据库备份，并运行 `supabase migration list --linked` 对比本地和远程迁移；不要对含有真实数据的数据库执行 `supabase db reset --linked`。

### 启动与停止

最简单方式是在仓库根目录双击 `start-project.bat`。它会检查 `.env.local`、本地依赖、模型/数据库配置和数据库健康；构建缺失或过期时运行 Next.js 与 `tsup` 生产构建；默认从 `http://127.0.0.1:5000/` 开始寻找可用端口，并打开浏览器。若目标端口已有健康且构建号相符的应用，脚本会复用它。运行中的命令行窗口不要关闭；按 `Ctrl+C` 或关闭窗口停止服务。

可在 PowerShell 临时覆盖端口或关闭自动开浏览器：

```powershell
$env:WEIXUN_PORT = '5010'
$env:WEIXUN_SKIP_BROWSER = '1'
..\start-project.bat
```

开发模式：

```powershell
cd .\projects
corepack pnpm dev
```

开发模式使用 5000 端口（或 `PORT` 指定的端口），终端关闭即停止。检查健康：访问 `http://127.0.0.1:<端口>/api/health/startup`，确认 `app` 为 `weixun-project`、`database` 为 `ok`，并与当前 `.next/BUILD_ID` 一致。Windows 一键启动器优先用于接手者的日常本地生产构建验收。

### 常见页面流程

玩家：`/` 入口 → 登录（仅演示）→ `/start` 选择项目 → 创建/继续正式对局 `/game` → 结算至 `/result`。开始新游戏会替换该玩家的活动项目存档；如需保留既有测试进度，先确认操作者和数据库环境。

设计师：登录并选择平台设计师 → `/designer` → 按需进入提示词、模型、JeV、人物主档、公式指标、素材、客户活动和评测页面。保存操作会更改数据库中的设计配置或 Supabase Storage 对象；批量改动前先导出/备份并确认当前连接的是预期开发或测试项目。

五人预览：`/project-one-preview` 用于预览/测试状态，不当作正式 `/game` 存档。刷新可恢复当前用户有权访问的预览会话；不要清理浏览器数据或替换账号来“修复”会话，先使用页面同步入口并读取页面报错。

## 5. 环境变量

变量模板在 `projects/.env.example`。只写变量名、用途和是否必要；实际值应由项目管理员通过安全渠道另行配置。

| 变量 | 用途 | 说明 |
|---|---|---|
| `SUPABASE_URL` | Supabase 项目 URL | 必需；应指向预期开发/测试项目。 |
| `SUPABASE_ANON_KEY` | 浏览器可用 Supabase anon key | 按当前构建/客户端需要配置。它不是 service-role key。 |
| `SUPABASE_SERVICE_ROLE_KEY` | 服务端管理访问数据库 | 高权限秘密；只可放服务器 `.env.local`，不得放 `NEXT_PUBLIC_*`。 |
| `AI_BASE_URL`、`AI_API_KEY`、`AI_MODEL` | 默认 OpenAI 兼容 Chat Completions 服务 | `AI_BASE_URL` 是服务根地址，应支持 `POST /chat/completions`。三个变量须匹配同一供应商配置。 |
| `AI_REQUEST_TIMEOUT_MS` | 默认模型请求超时 | 模板默认 60000 毫秒。 |
| `DEEPSEEK_AI_BASE_URL`、`DEEPSEEK_AI_API_KEY`、`DEEPSEEK_AI_MODEL`、`DEEPSEEK_AI_REQUEST_TIMEOUT_MS` | 命名 DeepSeek Provider | 用于设计师模型切换/提示词 A/B 测试等。 |
| `DOUBAO_AI_BASE_URL`、`DOUBAO_AI_API_KEY`、`DOUBAO_AI_MODEL`、`DOUBAO_AI_REQUEST_TIMEOUT_MS` | 命名豆包 Provider | 模型或 Endpoint ID 需在相应服务账号中有效。 |
| `QWEN_AI_BASE_URL`、`QWEN_AI_API_KEY`、`QWEN_AI_MODEL`、`QWEN_AI_REQUEST_TIMEOUT_MS` | 命名通义千问 Provider | Endpoint 模板中的工作区信息需匹配所属区域。 |
| `JEV_API_URL`、`JEV_API_KEY`、`JEV_MODEL`、`JEV_REQUEST_TIMEOUT_MS` | Jev typed-decision 服务 | 可选；依赖 Jev 的功能/专项测试时须配置。 |
| `SESSION_SECRET` | 服务器签署身份会话 | 本地亦应设置；生产必须设置唯一强随机值。不得复用源码固定开发值。 |
| `GAME_RANDOM_SECRET` | 游戏随机决策签名 | 建议显式设置，省略时按代码回退到 `SESSION_SECRET` 或服务角色密钥。 |
| `PORT`、`WEIXUN_HOST` | 自定义 Node 服务器监听端口/主机 | `PORT` 默认 5000；`WEIXUN_HOST` 默认 `127.0.0.1`。模板中的 `HOSTNAME` 不是 `src/server.ts` 实际读取的主机变量。 |
| `WEIXUN_PORT` | Windows 启动器首选端口 | 根目录 `start-project.bat` 使用；默认 5000。 |
| `WEIXUN_BUILD_ID` | 启动健康检查构建标识 | Windows 脚本从当前构建填入；一般不要手工设定。 |
| `WEIXUN_SKIP_BROWSER` | 控制是否自动打开浏览器 | 仅由 Windows 启动脚本使用，值为 `1` 时不自动开浏览器。 |
| `ENABLE_FAST_DEBUG` | 快速调试接口开关 | 仅测试环境使用；不要生产开启。 |
| `E2E_BASE_URL` | E2E 测试服务地址 | 仅测试脚本需要。 |
| `DEEPEVAL_TELEMETRY_OPT_OUT` | DeepEval 遥测开关 | 使用系统评测相关脚本时可设置为关闭遥测。 |

其他测试脚本还读取多模型、测试数据库等变量；应以相应脚本和当前 `.env.example` 为准。环境检查优先使用 `pnpm local:check`，它不会回显 key 的值。切换项目时特别核对 `SUPABASE_URL`、模型 URL/名称和密钥的对应关系，避免把测试数据写入正式环境。

## 6. 数据、备份与恢复

“完整项目压缩包”与“完整运行数据备份”不是同一件事。源码包能包含页面源码、提交到 Git 的静态素材、SQL 迁移和 seed；它不会自动包含外部业务素材目录、运行中数据库的用户/对局/配置数据、Supabase Storage 对象、登录会话、模型账户或任何 API key。转交前以 [数据库与素材交接清单](./数据库与素材交接清单.md) 逐项核实，并将实际导出文件清单、导出时间、数据库项目标识（不含 key）和恢复演练结果加入包内说明。

接手数据库时先建立隔离的新 Supabase 项目或确认获批目标，再恢复到测试环境验证结构、记录和对象文件。SQL dump 中可能有用户 ID、对话、工作配置或其他敏感数据，应加密、限制访问并按组织留存期限处理。不要把 dump 或 Storage 归档直接提交到公开 Git。

本地结构可用：

```powershell
cd .\projects
corepack pnpm supabase:reset
```

这会清空**当前连接的本地 Supabase 数据库**、依迁移重建并导入 `seed.sql`；它不恢复线上玩家、会话或对象文件。确认本地 Supabase CLI/Docker 已运行后才使用。严禁为了查看线上数据误用带 `--linked` 的 reset 命令。

Supabase 官方 CLI 的 `db dump` 默认 dump schema，不带业务数据；`--data-only` 可另导数据，且 CLI 会排除托管 `auth`、`storage` 等 schema。Storage bucket 中的二进制对象需单独下载/备份，数据库里的对象元信息不等于对象文件。备份/恢复步骤和限制见 [Supabase CLI 备份恢复文档](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore) 及 [Storage 下载对象文档](https://supabase.com/docs/guides/storage/management/download-objects)。所有线上迁移和恢复均需先备份、核对目标项目，再由授权管理员执行。

## 7. 验证与发布

项目核心检查（在 `projects/` 执行）：

```powershell
corepack pnpm ts-check
corepack pnpm lint:build
corepack pnpm test:ai-provider
corepack pnpm test:game-state
corepack pnpm test:metrics
corepack pnpm build
```

客户活动和系统评测的定向回归已在 `package.json` 注册，例如：

```powershell
corepack pnpm test:customer-activities
corepack pnpm test:formal-customer-activities
corepack pnpm test:preview-customer-activities
corepack pnpm test:customer-activity-config
corepack pnpm test:system-evaluation
corepack pnpm test:system-evaluation-judge
corepack pnpm test:system-evaluation-ui
```

完整脚本列表以 `projects/package.json` 的 `scripts` 为准。部分 E2E 测试会访问已配置开发数据库或真实模型，可能建立临时对局、消耗模型额度或改变测试环境；先读脚本头部说明并确认 `.env.local` 指向测试环境。`test:ai-provider` 是本地 mock，不能证明外部模型可用。

生产构建由 `corepack pnpm build` 执行 `next build` 与 `tsup src/server.ts`。在本机部署时用根目录 `start-project.bat` 启动新构建。Git 提交或本机运行成功不代表已经向任何远程部署环境发布。本地迁移的文件存在也不表示远程库已应用；用 `supabase migration list --linked` 核查后再按批准的发布流程推进。

根目录治理检查：

```powershell
cd ..
./scripts/harness-check.ps1
git diff --check
```

`harness-check` 会检查治理文件、是否意外追踪秘密文件，以及产品实现变更是否同步更新当前状态、迭代、问题和交接台账。它不会验证台账文字一定真实；操作者仍须逐项复核。

## 8. 常见故障处理

| 现象 | 先检查 | 处理 |
|---|---|---|
| 启动器提示 `.env.local` 缺失 | `projects/.env.local` 是否创建且存在必需变量 | 从 `.env.example` 复制后填写真实开发凭据；不从旧日志或截图粘贴 key。 |
| `local:check` 或 DB 健康检查失败 | Supabase URL/key 是否属于同一个项目，项目是否暂停/不可达，当前网络/代理 | 用 Supabase Dashboard 确认项目状态和连接信息；有代理要求时仅按组织网络规范设置当前终端。记录显示 2026-10-27 曾出现直连 TLS `ECONNRESET` 而显式代理成功；这是历史诊断，当前网络需重新实测。 |
| 浏览器打不开 5000 | 启动窗口报告的实际端口；5000 上可能有旧版或其他应用 | 启动器会试后续端口。打开终端报告的 `127.0.0.1` 地址；通过 `/api/health/startup` 核对 buildId/database。 |
| 本地服务代码似乎未更新 | `.next/BUILD_ID`、`dist/server.js` 时间及启动器输出 | 保持使用启动器，让它按源码时间重建；不要用旧 Node 进程去判定新代码是否生效。 |
| 模型请求失败、超时或空白回复 | `local:check`；Provider URL、model 与 API key 是否相互匹配；提供方状态和请求限制 | 不将 key 放进浏览器、命令行历史或截图。按 `AI_PROVIDER` /对应专项目志中的安全错误码排查；模型输出异常不代表数据库状态已写入。 |
| 设计师保存冲突或配置加载失败 | 页面显示的加载/保存状态、数据库连接和 revision | 先重读数据库/刷新；确认页面读取到当前配置再编辑。使用旧页面覆盖整个 JSON 会丢弃其他编辑。 |
| 预览会话无法继续 | 用户身份、会话是否仍属于该用户、同步 API 错误 | 先在页面执行状态同步，保留截图/错误码。避免更换账号、清除浏览器存储或重置数据库。 |
| PowerShell/Corepack 下载超时 | Node/Corepack 可用性、网络和 pnpm 版本 | 本仓库锁定 pnpm 9，勿用系统中其他大版本重装 lockfile。已有依赖时优先使用本地 `node_modules/.bin` 工具；安装仍需缓存或网络。 |

日志文件和调试输出有可能带有用户上下文。向他人转交前先脱敏审查，避免直接附带 `.log`、浏览器配置、CLI 登录状态、`node_modules`、`.next` 和 `dist` 缓存。

## 9. 尚未完成的功能和交接优先项

请以 `harness/issues/ISSUE_REGISTER.md` 状态和最新 `harness/STATE.md` 为准。最近记录标明以下待续事项：

- 发布级多尺寸浏览器验收、真实模型连续对话和报告 PDF 版式验收仍有未通过或未完成项（`TEST-003`）。
- 正式多人状态的广播/实时客户端同步尚未完成，不要把旧房间 API 或教练看板描述为已上线实时联机（`MULTI-002`）。
- 五人预览存在双轨渠道/拜访状态机与正式旧流程差异（`FLOW-007`）；完整内部审计快照和跨实例共享限流有剩余事项（`STATE-004`、`STATE-002`）。
- 多人/企业角色的真实认证、企业归属和部分管理能力仍需实现或复核；当前通用演示登录不得部署到对外环境。
- 设计师系统链路评测是本地首版；未来如需做真实模型质量评估，应确认模型配置、成本和输入数据范围，并保存独立原始报告。
- 原始业务脚本、人物称谓、评分公式及外部材料间存在冲突；先读 `SOURCE_OF_TRUTH.md` 与决策台账，再接受新增规则。

## 10. 资料来源

本手册按仓库当前代码结构、`projects/package.json`、`projects/.env.example`、`projects/README.md`、`harness/STATE.md`、`CURRENT_ITERATION.md`、`ISSUE_REGISTER.md`、`HANDOFF.md`、`SOURCE_OF_TRUTH.md` 和 `LOCAL_DEVELOPMENT.md` 整理。若页面/API清单与代码有差异，以受审阅的当前分支源文件和目标数据库实际状态为准，并同步更新手册与治理台账。
