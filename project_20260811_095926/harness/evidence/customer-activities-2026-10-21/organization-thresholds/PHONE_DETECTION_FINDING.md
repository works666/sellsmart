# 赵晓晨电话活动未弹窗：只读诊断

## 后续核查更正（2026-10-21，覆盖下方过强因果表述）

已证明的是结束命令/同步成功且没有decision/task，未证明该次模型调用实际发出或原始返回。正常代码路径在activeCall存在时排队并调用识别，当前结果更符合成功空候选/过滤；但没有挂断前activeCall快照或调用trace，无法完全排除根本未入队。下文“定位至语义识别未产出候选”只指最终匹配链路未生成候选，不能理解为已证明AI误判。restore spread保留activeCall，SQL commit完整保存state，调值不清除activeCall，未找到这些环节丢字段的代码证据。

测试边界：真实成功快测为旧版张建国邮件/临时零门槛；领域/预览AI测试包含mock识别输出，240断言为确定性门槛计算，均不能证明本次赵晓晨电话原话被真实AI稳定识别。提示词歧义、静默过滤、空匹配无诊断记录和电话真实链路覆盖不足都需处理；不能仅改提示词就宣称根因修复。

2026-10-21，用户反馈电话提出技术交流会，五人调整为支持度20/愉悦度60后未弹窗。只读查询实际 Supabase `project_one_preview_sessions`、`project_one_preview_commands` 与 `designer_prompt_configs`，未重放命令、调用模型或修改对局。

会话：8098e209-829d-432f-9f17-b86179799331，version 6。时间以下为北京时间：

- 13:42:29 phone_connect，成功。
- 13:43:17 message：销售“赵老师，您看我们下周要不要安排一个技术交流会，这样可以更好地交流技术上的问题，可以直接把需求交代清楚。”客户“嗯……技术交流会这个事我这边暂时定不了，得先跟李经理汇报一下，确认后再答复您。”
- 13:44:24 test_adjust_npcs：五人均20/60，提交响应确认生效。
- 13:44:33 customer_activity_end_conversation：成功，五人仍20/60，tasks为空。
- 13:45:44 customer_activity_sync：成功，tasks仍为空。

权威当前状态：activeCustomerActivityConversation=null，pendingCustomerActivityDetections=[]，customerActivities.decisions=[]，tasks=[]。当前配置numeric revision3，五人20/60满足技术交流所有推荐路径。用户确实先调值再挂断，不是设置未保存、未挂断或指标不达标。

代码追踪：queueCustomerActivityDetection 冻结结束状态；settlePendingCustomerActivityDetections 检测成功返回空候选也移除pending，检测异常则保留pending。已处理但无decision定位至语义识别未产出候选，尚未到门槛判定。未存储本次原始检测响应，不能确认具体是activities空、finalStatus不active、confidence<0.85或response.kind不ambiguous。

识别提示一方面允许“向上汇报”模糊回应，一方面排除“暂缓/不确定回应”，可能混淆“暂时定不了+先汇报+确认后答复”与拒绝。该可能性尚未用本次原始响应证实。应覆盖本原文并区分暂未确认与明确拒绝/取消。此次仅诊断，未修复、未重建、未重启服务；不能宣称端到端已恢复。
