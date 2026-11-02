# 活动回复拒绝感修复与真实电话复测

日期：2026-10-21。本地5000服务，独立IAB测试，不操作用户Chrome。

## 原因与修复

用户原提议：赵老师您好，我觉得咱们可以办一个技术交流会，贵单位提具体需求，我们来提供技术方案，您看能不能安排一下？

原回复：嗯……这个我这边暂时还没法安排，具体需求也不是我个人能定的。您看哈，先按正常流程来吧。

预览回复context将“能不能安排”的“不能安排”当取消，专用guard未调用；正式活动专用helper也漏动作/活动词的该顺序。回归先复现旧guard调用0次，修复后进入针对性修复。仅回复context疑问归一化及正式活动专用helper，通用邀请helper不动。共享/预览回复指令、质量检查和兜底补没法/无法安排、流程推脱及内部处理+后续反馈要求；保留原合规检查。整体门槛、匹配候选、计时/AP、策划未改。

涉及customer-activity-reply.ts、project-one-preview-ai.ts、invitation-intent.ts及四专项测试文件（含正式测试两条旧fixture更新）。主线程实际diff复核。

## 验证

- 六专项：customer-activities、preview-customer-activities、formal-customer-activities、invitation-intent、project-one-preview-ai、npc-speaker-identity通过。
- TypeScript通过，7文件定向ESLint --quiet无错误（未宣称全量lint无警告），Next+tsup production build通过。
- 原用户任务已自然submitted后重启服务。独立IAB电话逐字发送上述原提议，实际最终回复：这个建议我先记下了，会先向上级汇报，再给您反馈。
- UI测试调节全五支持20/愉悦60后挂断，出现技术交流会匹配弹窗，未开始策划。
- DB只读核验PASS：session 3edc9a4b-a537-444e-8651-bd96ed013049 version4，task customer-activity:28f0f9e14a511e65:technical_meeting；同一conversation原提议及客户回复，冻结5人均20/60、numeric revision3、allow。含conversation_queued、detection_started、model_request/response、threshold_decision、task_created记录。

证据：refusal-before.json、refusal-pre-update.json、reply-after-match.json、reply-fixed.png、reply-fixed-match.png。只读断言脚本首次缺TSX路径映射失败，设置TSX_TSCONFIG_PATH后通过；并非模型或产品请求失败。未改全局Provider、未远程部署、未验证新正式/多人浏览器端到端；一次真实电话结果不代表全部自然表述覆盖。
