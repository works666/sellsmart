# 真实系统状态只读核验

查询时间：2026-10-27 06:28 UTC。通过项目 `createServerClient` 读取 Supabase，所有查询均为 SELECT；没有调用 AI、修改配置或写入任何会话。

- 设计师项目一提示词配置行存在，revision 10；记录包含人物提示词、渠道、分层阈值和 evaluator prompt 配置。
- `global-ai-provider` 配置行存在，provider 为 `deepseek`，revision 5。未读取或输出模型 API Key、URL。
- `project_one_preview_sessions` 有 81 条记录，扫描到 7 个 `user_id` 分组。只输出每组会话计数，不输出任何 `user_id`。
- 最近 3 条快照显示五位 NPC 的服务端状态包含 `support`、`pleasantness`、`effectiveContactCount`、`activeBlockers`、`dimensionScores` 和 `workingMemory`；会话另含逐 NPC 的 `conversations` 与 `activeMeeting`。只读字段名、计数和是否有内容，没有输出消息正文、记忆正文或联系人信息。
- 会话状态没有独立的 `familiarity` 数值字段；可供真实评测使用的是支持度、愉悦度、有效接触数、历史对话、工作记忆等状态。若需评测独立熟悉度档位，当前数据不能直接提供该字段。

当前工具上下文没有认证后的设计师 user ID，因此无法确认最近 3 条具体属于本次用户；样本为跨用户的最近记录，不能称为“本人会话”。所有原始 user IDs 与消息正文仅在查询进程内读取并丢弃。查询结果只保留最多三条会话 ID 前缀和版本号，用于证明真实状态形状。

复核文件：`readback.mts` 可从 `projects/` 目录使用项目自带 tsx 运行；`readback.json` 是本次脱敏查询结果。
