# 关键词信号与上下文语义复核

日期：2026-10-21。工作项ACTIVITY-009。用户批准后实施；本地实现、构建及验证完成。

## 当前缺口与目标

已实查共享activity detector的确定性否定/撤回与LLM后置过滤、共享reply guard和preview quality gate、正式chat调用、普通邀约异常fallback。此前关键词可以直接改变候选或触发重写。已有数值v3整体门槛、来源验证、活动计时/策划、内部诊断存储继续使用。

目标：否定/撤回词只触发上下文语义复核；撤回须引用后序销售原话并指向同一提议；AI失败保留已证实提议，不把未证实负句当新提议。活动回复统一语义复核，确认违规才重写，失败用角色中性回复；确定性仅负责JSON、身份、证据来源、顺序和业务边界。内部trace有界且不进玩家DTO。

## 已完成的独立验证与发现

- 首轮真实LLM固定虚构样例12例，11符合预期，真正撤回因proposal引用全句与短锚点等长要求而失败。原始结果live-results-initial.json保留。独立advisor亦确认该P2；修复为同消息连续原文覆盖候选锚点。
- 第二轮16例：真正撤回已修复，其余新增负提议、双重否定后明确不办、假合规豁免等均符合；“不是不能安排技术交流会，我建议咱们先交流需求”得到not_proposed，与首轮不同。该句可能只建议先沟通需求而尚未发起活动，不能以关键词推定一定活动。原始live-results-second.json保留；后续以明确“建议就组织一次”的双重否定样例验证新提议，且记录含糊表达仍依赖模型判断，不能声称所有表述稳定。
- 主线程新增诊断专项已通过：固定枚举/摘要/offset及来源ID持久恢复，任意文本字段和非法值剔除，最多100条，玩家状态剔除。
- 独立review发现并交回修复：合规字样直接豁免、拒绝同义漏信号、不建议活动成为假候选、双重否定无视后半否定、缺少撤回依据messageId。

## 最终结果

- 主线程实际实现审阅，独立advisor全部P2关闭。七专项customer-activities、customer-activity-semantic-diagnostics、invitation-intent、formal-customer-activities、preview-customer-activities、project-one-preview-ai、npc-speaker-identity均独立通过；最终tsc --noEmit、12文件定向ESLint --quiet与Next+tsup production build通过。仅既有unused warnings，未宣称全量lint无警告。
- 第三轮明确样例18种，17/18符合；‘取消下周时间但提议仍保留’被识别为两个候选。修复延续去重、fixture回归通过后，只对该失败例真实复跑，最终恰1候选（live-continuation-fixed.json）。故18种均有最终通过记录，不能表述为单次18全绿。初轮、第二轮、第三轮证据均保留；不声称模型对所有含糊表达稳定。
- 原用户会话只读检查没有activeCall/pending detection，任务pending非planning；核验旧5000 PID38704为dist/server.js后更新服务，当前production exec90933。第一次检查DB网络fetch失败，重试只读成功，未修改原用户对局。
- 更新后独立IAB实际赵电话新session ffce6ee9-00ec-4286-9fa4-b95b8de36b22，发送‘赵老师，咱们能不能安排一次技术交流会，讨论接口需求？’。实际回复：‘嗯……这个我得先记下来，跟李经理汇报一下，后面再给您回话。’
- 第二轮‘那就下周三？’实际回复‘这个时间我这边定不了，得先跟李经理汇报，有结果再给您回话。’，未提前确定日期（截图phone-followup.png）。
- 第三轮‘刚才的技术交流会先不办了，我撤回这个活动提议。’实际回复‘嗯嗯，知道了，那这事我就先不往上报了。’（phone-withdrawal.png）；挂断后未出现活动弹窗。
- 权威DB v5三轮semantic_review_completed均allowed，原提议proposal_semantic_review_completed=withdrawn，已校验withdrawal_message_id=1f4f8f21-3b7f-4cae-b639-f2060bb445da；最终candidates_count=0、无门槛决定/无任务，而非因默认低指标被门槛挡住。.tmp/verify-semantic-browser.cjs离线独立断言PASS，browser-readback.json保存。

未改全局Provider/后台门槛/用户现有对局，不把fixture断言当真实浏览器验收，不声称其他评分/记忆语义规则均已重构。没有远程部署、新正式或多人浏览器端到端验收。
