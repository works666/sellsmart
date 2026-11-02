# WeiXun 工作交接包

生成时间：2026-10-30T02:03:22.089Z

## 内容

- `project_20260811_095926/`：Git 工作区快照，包含应用源码、页面和 API、迁移、seed、验证脚本、治理记录及详细中文操作文档；不含 Git 历史、依赖目录、构建缓存和本机运行日志。
- `business-materials/`：外部整理目录和 Weixun Web 页面/素材源文件。
- `data/`：由独立只读 Supabase 导出脚本生成的业务表 JSON 与 Storage 对象。
- `CONFIGURATION.example.env`：本机当前的非敏感运行配置；KEY、TOKEN、SECRET、PASSWORD 和 CREDENTIAL 字段均为空。
- `git-metadata.json`：生成此交接包时的分支、HEAD 与清理过的远程地址。
- `MANIFEST.json`：每个交付文件大小、SHA-256、来源、排除项及文本密钥清理记录。清单包含自身大小但无法在自包含清单中列出自身 SHA-256；完整包校验见旁边的 ZIP SHA256 文件。

## 解压后接手

1. 安装 Node.js 22 或更新版本、Corepack 和 pnpm 9。
2. 进入 `project_20260811_095926/`，复制根目录 `CONFIGURATION.example.env` 到 `projects/.env.local`，然后由组织管理员单独发放并填写空白 key/secret。该模板保留了当前非敏感模型服务 endpoint、模型名和端口；`projects/.env.example` 是基础变量说明。不要从旧机器复制真实 key。
3. 在 `projects/` 运行 `corepack pnpm install --frozen-lockfile`，再根据配套中文手册配置数据库并运行 `corepack pnpm build`。
4. 启动前阅读 `project_20260811_095926/docs/handover/`。还原业务数据到新数据库前先创建空数据库、应用全部迁移、备份目标库；遵循 `docs/handover/DATA_RESTORE.md`，并单独核对表映射、存储 bucket 与新环境 URL。
5. 管理员账号、邀请与登录身份需由目标环境的管理员重新设置。交付包不携带 API key、登录 token、旧机器环境变量或 Git 历史。

## 完整性与数据时间

- 解压前请用 Windows PowerShell 执行 `Get-FileHash .\<交接包文件名>.zip -Algorithm SHA256`，结果应匹配相邻的 `.sha256` 文件。ZIP 使用系统 tar 的 Deflate 压缩及 UTF-8 文件名支持；超大 ZIP 使用 ZIP64。
- 数据导出是按表和对象逐项读取的逻辑快照，不是数据库事务时间点的原子快照。导出窗口内发生写入时，各表可能对应略有差异的时间。每项结果、计数、失败和导出时间见 `data/manifest.json`。
- 除被安全检查拒绝打包的二进制凭据（如有）以外，清单列出所有实际交付文件；配置文件等文本里命中本机已配置长凭据时替换为 `[REDACTED]`，清理详情只记变量名和次数，不记原值。
