# 吃饭/喝酒邀约事件验证

日期：2026-10-29。范围：本地代码、离线服务回归和生产构建。

## 实际实现

- `projects/src/lib/game/customer-activities.ts` 新增 hospitality 类型；默认目标客户支持度15、愉悦度55同时达标，不读取团队门槛。旧三类配置读取时补默认值，保留原配置revision及原三类规则；无数据库迁移。
- `projects/src/lib/ai/customer-activities.ts` 支持客户或销售提出吃饭/聚餐/饭局/喝酒/小酌；普通饮料与纯历史不算新活动，否定/撤回仍经既有语义复核。全局AI模式下饭局仍用确定性数值门槛，客户主动须销售明确确认。
- 任务、约定及决策记录schema重验饭局numeric决策与冻结目标指标，避免直接确认或AI模式绕过门槛。原三类组织规则保持。
- `invitation-intent.ts`、共享回复、正式stream路由及预览服务将饭局从普通拜访appointment分流到活动链路，饭局由本人考虑后反馈；最近话题切换回技术交流时仍用原职级规则。
- 后台提供单独支持度/愉悦度输入，模式切换保留；正式React策划和预览HTML新增饭局标题及“邀约策略 / 方案”提示。沿用连续5分钟、草稿恢复、超时提交和既有评价。

## 主线程验证

使用仓库已有 `node_modules/.bin` 工具；PATH上的pnpm为11且与工程9版约束冲突，未安装或修改依赖。

以下专项通过：

1. test-customer-activities.ts：识别、客户主动确认、目标阈值边界、其他成员低值、全局AI仍numeric、旧配置、冻结状态读回与伪造模式拒绝。
2. test-customer-activity-decision-form.ts：单人字段合法性及三组织规则保持。
3. test-designer-customer-activity-config.ts：旧配置规范化、存储版本CAS、非法配置及API契约。
4. test-invitation-intent.ts：饭局与普通预约隔离、茶饮排除、组织话题切换及回复保护。
5. test-preview-customer-activities.ts：预览真实服务结束队列→numeric匹配→策划草稿→提交评价及幂等；目标15/55、14/55、15/54与其他四人0/0，客户主动确认，玩家DTO不露内部快照/门槛。
6. test-formal-customer-activities.ts：正式真实队列/仓储业务函数及domain策划结算，同上边界和隐私检查；注入存储/模型替身，不写真实DB。
7. test-preview-countdown.ts、test-preview-recovery-ui.ts、test-customer-activity-semantic-diagnostics.ts、test-project-one-preview-ai.ts、test-ai-provider.ts、test-five-stage-state.ts、test-metrics.ts 均通过。

最终 `tsc -p tsconfig.json --noEmit`、完整 `eslint . --quiet`、`next build`、`tsup src/server.ts --format cjs --platform node --target node20 --outDir dist --no-splitting --no-minify`、`git diff --check`及harness-check通过。

## 限制与既有失败

- 附加 `test-legacy-ui-contracts.ts` 首条旧竞品UI断言失败；HEAD中game/page.tsx也有showCompetitors和可点击入口，本批未改该文件。登记TEST-LEGACY-001，未删除竞品功能或修改测试预期，不声称全部仓库测试通过。
- 没有运行新功能的真实浏览器/付费AI端到端或正式多人验收；没有操作真实对局、改写远程配置、迁移数据库、启动/重启用户先前停止的服务、远程部署或Git提交。
- 本次原有系统评测、网络诊断等未提交改动保留。
