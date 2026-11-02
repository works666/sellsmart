# 项目一观察数据口径

## 目的

观察数据用于回答三个问题：玩家是否走通流程、在哪个节点流失、训练结果是否改善。事件只保存结构化状态和必要计数，不把完整邀约、材料说明、会谈纪要或模型原文复制到分析字段。

## 事件口径

| 流程 | 事件 | 核心字段 |
|---|---|---|
| 新建存档 | `session.created` | scenarioCode、replacedExisting、replacedCount |
| 覆盖存档 | `session.replaced` | scenarioCode、replacedExisting、replacedCount |
| 继续游戏 | `session.continued` | round、version、hasActiveMeeting |
| 公开信息 | `public_info.researched` | npcId、factCount、weakSignalCount、timeMinutes、costPoints |
| 邀约结果 | `appointment.*` | npcId、channel、status、extractedFields、defaultedFields、conditionCount |
| 条件完成 | `appointment.accepted` | appointmentId、action、conditionCount、conditionsSatisfied |
| 材料准备 | `preparation.completed` | npcId、type、hasPreparationBrief、preparationBriefLength、timeMinutes、costPoints |
| 材料使用 | `preparation.delivered` | npcId、appointmentId、preparationType、deliveredDuringVisit |
| 进入会面 | `visit.started` | npcId、visitType、scheduledRound、scheduledMinute、preparationCount、conditionCount |
| 结束会面 | `visit.completed` | npcId、visitType、reason、turnCount、maxTurns、usedPreparationCount、hasPlayerSummary |
| 阶段推进 | `phase.advanced` | fromRound、toRound、pendingAppointmentCount、unreadNotificationCount、missedAppointmentCount |
| 主动提交 | `session.submitted` | submittedRound、earlySubmission、warningCodes、证据数、风险数、finalScore、won |
| 到期结算 | `session.finished` | fromRound、toRound、证据数、风险数、finalScore、won |

## 核心指标

| 指标 | 计算方式 |
|---|---|
| 开局转化率 | `session.created + session.replaced` / 进入存档页人数 |
| 继续游戏率 | `session.continued` 去重玩家数 / 有进行中存档玩家数 |
| 公开信息使用率 | 发生 `public_info.researched` 的对局数 / 开始对局数 |
| 邀约成功率 | accepted 数 / 全部邀约结果数 |
| 邀约字段完整率 | extractedFields 数 / extractedFields 与 defaultedFields 总数 |
| 附条件完成率 | conditionsSatisfied=true 数 / conditionCount>0 的邀约数 |
| 材料说明完整率 | hasPreparationBrief=true 数 / PPT 与项目材料准备数 |
| 材料使用率 | preparation.delivered 数 / preparation.completed 数 |
| 预约到访率 | visit.started 数 / accepted 预约数 |
| 会面完成率 | visit.completed 数 / visit.started 数 |
| 平均会面轮数 | visit.completed.turnCount 平均值 |
| 未赴约率 | missedAppointmentCount 增量 / accepted 预约数 |
| 提前提交率 | earlySubmission=true 数 / session.submitted 数 |
| 中标率 | won=true 的结算数 / 全部结算数 |
| 完整闭环率 | 有结算事件的对局数 / 开始对局数 |

## 数据边界

- 不记录完整玩家邀约正文。
- 不记录完整材料说明和会谈纪要。
- 不记录过程中的精确 NPC 支持度或隐藏关注点。
- 模型协议错误只记录有限错误码，不记录原始模型错误正文。
- `commandId` 用于幂等和事件去重，不作为玩家行为内容分析字段。
