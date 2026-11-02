# Project Harness

Harness 将项目的运行方式分为五层：

1. **目标**：`PROJECT.md` 与 `STATE.md` 说明当前为什么做、做到哪里。
2. **上下文**：`context/` 保存相对稳定的产品、架构和资料来源信息。
3. **记忆**：`memory/` 保存已确认决定、调查发现和交接信息。
4. **计划**：`plans/` 区分候选工作与本期已批准承诺。
5. **问题**：`issues/ISSUE_REGISTER.md` 持续记录所有开放、阻塞、延期和已解决问题。
6. **循环**：`loops/` 约束从选择工作到实现、验证、记录和提交的过程。

## 状态流

```text
候选问题
  → 调查并补充证据
  → 产品/技术决策
  → 加入当前迭代并批准
  → 实现
  → 验证
  → 记录结果
  → Git 提交
```

问题不得因“不在本期”或“暂时无法解决”而消失；应分别标记为 `Deferred` 或 `Blocked`，并保留原因、下一步和最后检查日期。

运行 `powershell -ExecutionPolicy Bypass -File scripts/harness-check.ps1` 可检查关键文件、Git 根目录和敏感文件跟踪情况。
