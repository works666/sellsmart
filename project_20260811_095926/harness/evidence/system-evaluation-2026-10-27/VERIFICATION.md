# 设计师系统链路评测验收 · 2026-10-27

## 本批能力与边界

- 入口：`/designer` → 测试 → 系统链路评测，页面 `/designer/system-evaluation`，API `/api/designer/system-evaluation`。
- 复用五人预览 `createPreviewAiService.execute`、实际提示词组合/渠道/规则和状态变化。来源为本人持久化预览快照的只读复制，或标明人工设置的全新测试状态；每次创建独立内存 store，不调用原会话的持久化 acquire/commit。
- 保留并展示支持度、愉悦度、有效接触次数、节点、blockers、五维、工作记忆、历史和逐轮前后状态；不新增或推断独立熟悉度。拜访启动跳过预约/准备，不能冒称完整正式玩家端到端。
- 四项 ConversationalGEval：角色一致性、自然度、状态与记忆一致性、信息承诺边界。经统一 client.ts 调用配置模型；不使用 Confident 登录/上传，关闭遥测。
- 结果仅当前页保留，可下载完整 JSON；未新增数据库历史表。请求计数是应用层调用，底层供应商重试不等同这个计数。

## 验证证据

- 根独立运行新后端、真实 SDK judge（模拟回复）、UI helper 专项，均通过。覆盖鉴权、快照不变、失败不通过、真实生成提示词/状态进入评委、完整上下文超限明确不可评。
- 根运行既有 AI Provider、五阶段状态、metrics、五人预览AI、设计师预览权限专项，均通过；这些测试使用本地模拟，不是付费模型测试。
- 全量 TypeScript、完整 ESLint --quiet 通过；独立审查后的决策配置冻结修正又通过后端/五人预览专项、最终TypeScript/定向lint和第二次Next.js + tsup production build。独立复审无余留P1/P2。
- 浏览器脚本 `browser-check.mjs` 在 production 页面以模拟 API 覆盖成功/部分完成/失败、来源切换、跨账号旧报告清除、桌面及390px手机布局。无页面错误，手机无横向溢出；截图 `desktop-success.png`、`mobile-success.png`。截图是模拟报告，非真实AI评分。
- 权威数据库只读结构与配置实查见 `REPORT.md` / `readback.json`。未读取输出账号ID、密钥或对话正文，未写配置/会话。
- HTTP最终生产路由实查见 `http-smoke-status-elevated.json`：匿名GET/POST401、临时player403、临时designer本人空列表200、虚构snapshot404。未读写真实用户会话/调用模型。首轮 `http-smoke-status.json` 保留sandbox服务出站受限的503，不作为当前结果。
- 最终production本地5010已启动；最终构建后的既有browser脚本再次通过并刷新截图。没有远程部署。

## 依赖兼容

锁定 deepeval 0.9.23。npm发布包的旧 `dist/telemetry.js` 遮蔽新 `dist/telemetry/index.js`，缺少 `inComponentScope`/`recordMetric`；通过 pnpm `patchedDependencies` 中的3行转发补丁保留旧导出并补齐新API。补齐发布包静态引用却未声明的 `@sentry/node`，实际SDK离线measure验证通过。补丁随项目安装自动应用；不依赖临时修改node_modules。Next将这两个Node SDK作为服务端外部包。

## 剩余验证

尚未用付费AI运行本次新增页面的完整生成和评分，不据模拟得分判断提示词质量。正式 `/game` 持久化/多人流程、其它渠道和远程部署不属于本批首版覆盖。
