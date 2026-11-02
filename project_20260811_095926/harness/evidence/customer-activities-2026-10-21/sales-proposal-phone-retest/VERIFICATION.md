# 销售提议即进入判断：修复与赵晓晨电话复测

状态：本地修复与一次同场景真实浏览器复测通过；未执行远程部署或新正式/多人浏览器全流程。

## 本批规则

销售明确提出技术交流会、案例现场参观、客户来我司参观后，在对话结束时进入整体匹配，不以客户回应/拒绝/取消话语、模型置信度或最终状态作为销售候选的门槛。客户主动仍需销售确认；玩家本人明确撤回、否定、纯引用/历史讨论不冒造候选。已有numeric v3五人组合门槛不改，活动策划/时间/AP/结果隐私不改。

明确销售提议有程序核验的候选保障；语义识别仍调用LLM补充其他类型或自然表达。模型空结果、供应商/解析/语义证据错误不抹掉已确定的提议。所有引用保持原话，新增not_required仅表示不需要客户回应，不伪造客户同意或证据。公司参观仅明确我方目的地走程序确定性匹配，模糊归属交语义识别。

## 系统记录

正式/预览内部JSON保存有上限诊断。预览包括phone_conversation_started、conversation_queued、detection_started、模型实际调用/响应/错误或候选本身不依赖模型、候选接受/过滤、整体门槛决定与revision、任务创建/重复、失败留队和无activeCall结束。入队冻结五人指标，日志不进入玩家DTO，不保存完整prompt/模型原文/密钥。旧状态缺少日志可恢复，无新SQL。

## 主线程独立验证

- 最终核心、正式活动、预览活动、既有预览AI、游戏状态、预览倒计时及测试调节7项专项通过。
- 最终TypeScript通过。
- 全量ESLint初轮0 errors，收尾后11个修改源码/专项文件再次ESLint 0 errors。
- 独立只读Review发现并修正疑问被当否定、公司方向、proposal-only源证据校验、语义备用及混合活动丢失问题。最终裸公司方向复核关闭，复核范围无剩余P1/P2。
- 最后公司方向修订后主线程再跑核心专项/TypeScript/11修改文件ESLint均通过。Next生产build与tsup成功，更新本地5000服务。

## 真实浏览器复测（北京时间2026-10-21 14:42—14:44）

使用用户Chrome当前设计师预览页面，未mock API、未直接调用匹配函数、未修改数据库或活动配置，未重置/删除旧服务端对局。刷新后界面返回项目入口，点击开始项目一重新进入；服务端沿用原预览session，旧电话消息仍保留。新拨打赵晓晨电话，历史消息边界从index4开始。

销售逐字使用原话：“赵老师，您看我们下周要不要安排一个技术交流会，这样可以更好地交流技术上的问题，可以直接把需求交代清楚。”真实客户回复：“嗯……这个技术交流会的事，我得先向上级汇报一下，确认后再答复您。”

保持通话中，打开测试调节，读取权威当前值，勾选五人并将支持度统一20/愉悦度60，其他项保持界面值后应用。只读DB before-end.json确认全五20/60、activeCall及phone_conversation_started均已保存。应用后主倒计时18:59，后续可见18:41，停表修复也在真实界面得到验证。

点击挂断后真实出现“活动提议已匹配：「技术交流会」”和“开始策划 · 5:00”；没有点击开始策划，保留弹窗供用户查看，未额外提交方案/改指标。matched.png为原生浏览器截图。

权威readback after-match.json独立断言PASS：session dec963d5-c7c5-4ec0-9d16-e5dfe6c07bc5 version13；新task customer-activity:92970755ce7bf7b1:technical_meeting，pending；源消息为本次原话，冻结全五20/60，numeric revision3，decision allow，恰好一项技术交流任务，activeCall null、pending detection0。

同一新conversation诊断顺序：phone_conversation_started → conversation_queued → detection_started → candidate_accepted（deterministic_sales_proposal）→ model_skipped（指该明确候选本身无需模型确认）→ model_request（原文语义补充）→ model_response（sales，candidate_count1）→ candidates_count（合并后1）→ threshold_decision（allow）→ task_created。这次有实际LLM识别调用及返回记录，候选仍有程序保障；不再由客户模糊回应或AI置信度否决销售路径。

边界：本次只做一次新真实电话，不把单次成功宣称所有自然表达/正式/多人链路已验证。全局普通NPC决策Provider仍是既有默认Jev（revision0），叙事与活动语义识别使用既有LLM，活动可行性为numeric；未修改全局Provider/NPC持久提示/门槛。历史失败的实际AI原文无法追回，不能因新成功就断言旧失败唯一根因。系统日志是有界事件数组，部分结算事件at复用该次处理基准时间，不用于精确模型耗时计量；核查流程顺序按数组及conversation关联。
