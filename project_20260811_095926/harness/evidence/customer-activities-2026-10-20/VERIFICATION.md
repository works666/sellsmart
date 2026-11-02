# 客户活动功能验证记录（2026-10-20）

本次完成本地实现，覆盖正式对局与五人预览。三类活动为技术交流会、案例现场参观、客户参观我司。

## 最终规则

- 销售提议后客户按职级模糊回应；在当次对话结束时判断是否允许开展。客户主动提出仍需玩家确认，明确拒绝/撤销排除。
- 默认使用现有 Jev/LLM provider 综合判断；后台 `/designer/customer-activities` 可切换数值模式。三活动分别配置支持度、愉悦度最低值，范围0至100且同时满足，等于门槛可通过；不预填虚构门槛。
- 对话结束时冻结服务端指标、配置和revision。成功、拒绝、待补充均记录，不因滚动历史或重试重新抽取旧提议。
- 每项策划开始后独立300秒，自动保存、刷新恢复、到期自动提交已保存文字（含空白），支持提前提交。策划不扣行动点及游戏时间，截止后离线时间正常计入。
- 方案只调整现有指标一次并给总体文字评价，不另设总分，不把策划写成活动已举办。

## 代码入口

- 领域与AI：`projects/src/lib/game/customer-activities.ts`、`projects/src/lib/ai/customer-activities.ts`、`customer-activity-reply.ts`。
- 正式路径：session repository/state、chat/stream、session commands/timer、customer-activities API及共享planner组件。
- 预览路径：project-one-preview-ai服务/契约/handler及`projects/public/project1-prototype-v9.html`。
- 后台：customer-activities页面/API、独立配置repository、门槛表单helper；配置写入使用鉴权与revision CAS。
- 联机结束计时：`projects/supabase/migrations/20261020000100_pause_multiplayer_timer_for_customer_activity.sql`。

## 主线程独立验证

领域、正式、预览、后台配置与表单五组专项通过；既有game-state、formal-five-person、preview-countdown、project-one-preview-ai、invitation-intent、NPC speaker identity、metrics、AI provider及Jev目录回归通过。TypeScript、全量lint与生产build通过。主线程复核实际diff，独立Review发现的批次部分成功丢失问题已修复；实际处理函数测试覆盖逐项checkpoint、失败重试、CAS复用与队列切换隔离。

浏览器检查使用真实本地页面/HTML和mock API，未调用远程AI：

- `formal-browser-results.json`：三活动串行、持续输入保存、刷新保留草稿/截止时间、超时、提前提交、空白超时，无GET循环/页面错误。
- `designer-browser-results.json`：AI默认、未完整配置不能保存数值模式、0/100边界、101拒绝、保存重载、409保留草稿、503失败重试。
- `preview-browser-results.json`及`PREVIEW_BROWSER.md`：真实预览HTML的保存、超时、提前提交与下一任务。
- 对应PNG为浏览器截图；`formal-browser.mjs`、`designer-browser.mjs`、`preview-browser.mjs`保留验证脚本。

`sql-results.json`记录PGlite对实际迁移SQL的执行结果，使用最小fixture而非生产数据库：提前结束冻结草稿/无策划耗时，截止后只计后续20秒，普通拜访与普通时钟不受影响，重复结束幂等，authenticated不可执行、service_role可执行。`sql-test.mjs`保留脚本，需要可用的PGlite包。

最终本地production服务HTTP检查：`/game`、`/project-one-preview`、`/designer/customer-activities`为200；未登录访问`/api/designer/customer-activities`为401。本地地址为 http://127.0.0.1:5000 。

## 验证边界与后续部署

没有执行远程Supabase迁移，也未验证真实在线AI输出或远程完整登录态对局。上线时需应用上述迁移并在实际环境验证配置持久化、真实模型判断与完整流程。浏览器mock和SQL最小fixture结果不能视为这些远程检查已通过。

未改变全局模型选择或用户持久化NPC提示词；保留既有工作区修改，未提交Git。

## 2026-10-20 真实浏览器五分钟快速测试
用户要求代为实际操作。Chrome真实本地页面、预制设计师登录，无mock API。原配置为AI/六门槛空白v0，临时保存数值模式六门槛0为v1，创建新预览对局。向张建国发送技术交流邮件，真实回复“建议您先和实际负责项目的同事沟通，确认后再答复您”，随后出现匹配弹窗。开始300秒策划，填243字方案并确认保存；4:31刷新后草稿/倒计时恢复，主游戏时钟19:05和27行动点在策划期间保持。等待自然到期，自动提交并显示真实AI总体评价，未点击提前提交；截止后主时钟恢复（观测18:51），AP仍27。评价肯定需求/议程与待确认边界，建议给高层决策摘要、明确跟进责任人及备选安排。结果页面留在Chrome。
测试中已恢复AI及六空白门槛并保存成功v2；未改全局模型/NPC提示词、未部署迁移。本次验证为单次真实预览UI流程，活动可行性使用临时数值模式，因此不代表AI可行性判定已验收，也不覆盖正式/联机全流程。证据live-quick-planning.png、live-quick-evaluation.png。未读取隐藏指标，故UI观察不能独立证明内部每项指标增减。

2026-10-21归档更正：本目录preview-browser脚本、preview-browser-results和部分preview mock截图已在10/21 UI修正时被覆盖，不能视为原始10/20冻结快照。10/20 live-quick真实测试截图及formal证据未受影响。当前可复跑的预览mock验收见../customer-activities-2026-10-21/。
