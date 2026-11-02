# 开发循环

## 1. Select

- 只从当前迭代的已批准范围选择工作项。
- 确认没有未决业务规则阻断实现。

## 2. Frame

- 写清当前行为、目标行为、影响范围和验收条件。
- 找到数据、API、UI 和 AI 契约的共同边界。

## 3. Inspect

- 先复现或静态确认问题。
- 检查相关测试、调用方、数据表和用户流程。

## 4. Implement

- 做最小完整纵向修改，不留前后端半契约。
- 关键游戏状态由服务端管理。
- AI 输出经过解析、校验和失败回退。

## 5. Verify

- 执行 `loops/VERIFICATION.md` 中匹配风险的检查。
- 验收失败则回到 Inspect，不以“代码已写”作为完成。

## 6. Remember

- 更新 STATE、当前迭代、决策、发现和交接。
- 更新 ISSUE_REGISTER；问题不得删除，Resolved 必须附验证证据，Blocked/Deferred 必须说明原因和下一步。
- 记录验证证据和剩余风险。

## 7. Commit

- 检查无密钥、无调试文件、无意外大文件。
- 使用聚焦提交，例如 `fix(ai): align npc chat contract`。
