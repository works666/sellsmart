# 动态问题台账

## HANDOVER-002 ZIP 中文文件名编码

- 状态：Resolved（打包工具修复）；最后检查：2026-10-30。
- 首轮完整ZIP以Windows tar默认编码写中文名，独立.NET ZIP核验读出替换字符并发现重名，阻止交付该包。
- scripts/create-handover.mjs显式指定zip:hdrcharset=UTF-8；中文文件名fixture经.NET独立读取正确。最终完整包仅在逐文件清单/哈希与路由完整性核验通过后交付，结果见包外DELIVERY_RECEIPT.json。

## HANDOVER-001 Windows Storage 备份路径兼容

- 状态：Resolved；最后检查：2026-10-30；仅交接导出工具缺陷。
- 首次只读导出27表672行成功，但30个原Storage key含冒号，Windows创建目录失败。源对象未修改。
- projects/scripts/handover-export.mjs改为以原key的SHA-256生成本地文件名，manifest保留原path和本地file；恢复工具按清单还原。新目录完整重导出35对象、65,274,220字节，错误0；主线程verify-only复核计数/大小/SHA-256通过。
- 边界：交付REST逻辑副本不含私有schema/服务端平台设置，未做目标环境真实恢复；详见docs/handover/DELIVERY_REPORT.md与DATA_RESTORE.md。既有未解决问题继续保留。

## TEST-LEGACY-001 旧UI契约断言与现有竞品入口不符

- 状态：Open；最后检查：2026-10-29；本批附加回归发现，非饭局事件实现范围。
- scripts/test-legacy-ui-contracts.ts 首条要求game/page.tsx不含showCompetitors，但当前及HEAD版本已有可点击的竞品资料入口及该状态；该文件本批未修改。专项因此失败，不能声称全部仓库测试通过。
- 下一步：独立核对旧测试的产品预期，再调整断言；本批不删除已有竞品功能或放宽测试。

## ACTIVITY-013 吃饭/喝酒邀约策略事件

- 状态：Resolved（本地实现）；最后检查：2026-10-29。来源：用户新增需求。
- 原有三类组织活动匹配/策划/结算已复用；新增hospitality类型、单目标门槛及后台/玩家UI已完成。
- 默认支持15/愉悦55同时达标，后台可调；复用共享domain/AI、正式/预览服务、invitation-intent、两端策划UI。
- 根实际diff、六活动专项、七相关回归、最终tsc/完整lint/Next+tsup构建和harness通过；证据harness/evidence/hospitality-2026-10-29.md。新功能真实AI/浏览器/远程部署未验收，不声称已完成。

## ACTIVITY-OBS-001 · 2026-10-27 张建国个人达标但未弹策划框 · Resolved（诊断符合现有团队规则）

本人当前session 2ca1e658 v31，最后张拜访3轮正常player_farewell。结束后诊断依次conversation_queued/candidate_accepted/candidates_count1/threshold_decision reject，reason团队当前关系状态尚未达到推进条件；没有task、没有pending。冻结张49/79，其余0/50；实际配置numeric rev3要求整体路径且至少两位不同成员达标，故个人达标不能触发。核查活动源码/原型HTML没有本批diff，preview主流程仅函数export。用户原话已识别，不属于代码回退。未修改门槛/数值或存档，不擅自增加拒绝提示等范围。详见customer-activities-2026-10-27/READBACK.md。

## NET-001 · 2026-10-27 Supabase直连TLS被重置 · Open（原因已缩小，未改网络设置）

用户频繁遇启动SUPABASE_NETWORK_ERROR而其他应用正常。根只读捕获实际fetch.cause：ECONNRESET，Client network socket disconnected before secure TLS connection was established，约176–234ms即失败，非10秒超时。A/B/A：直连16次全失败；仅诊断子进程NODE_USE_ENV_PROXY=1+HTTP(S)_PROXY=http://127.0.0.1:7897，16次health_check鉴权查询全200；再直连16次全失败。地址/密钥/查询一致，当前Windows系统代理关闭但7897本地代理监听；OS lookup可返回IPv4，resolve4另有ECONNREFUSED，不能据此直接认定DNS为唯一原因。定位到直连/代理路线差异，尚未识别具体重置节点。未改系统代理/项目配置、未启动已停止的本地服务。下一步可由用户在启动终端显式使用本地代理并保持代理运行；若实施持久化方案需限定项目并保留可选性，不能全局重试写请求。证据supabase-network-2026-10-27.md。

## EVAL-002 · 2026-10-27 正常提前结束被评测误报失败 · Resolved（本地）

实证：根只读浏览器5000报告d64b6af4，首轮结束原因npc_time_constraint，第二轮NO_ACTIVE_VISIT_FOR_NPC。当前runner没有成功轮后结束检查，phase partial导致未调DeepEval。修复目标正常结束即评分实际完成轮，报告披露未执行计划；真实失败仍标partial/error。验收须覆盖首轮/多轮结束、不结束、真实异常和源快照不变；不修改游戏会面规则。此前EVAL-001本地离线验收保留，不作为本次真实运行成功的证据。

结果：system-evaluation.ts成功轮后检查权威meeting.ended，同NPC即记录termination并停止后续、继续judge；contract/page公开原因/完成/计划/跳过数。根回归、SDK、预览、类型/lint/build通过，5000/5010更新，5000HTTP200/DB健康/build一致。源快照不变，真正生成失败仍不可通过。没有重跑用户付费请求，真实修后AI结果待用户再次运行。证据early-end-fix.md。

## EVAL-001 · 2026-10-27 设计师系统链路评测 · Resolved（本地首版）

用户要求真实状态接入与设计师入口。已在projects新增system-evaluation contracts/service/judge/API/page与测试中心卡片，复用五人预览状态驱动链路、本人快照隔离副本与DeepEval四项评分。根三新专项+五项回归/类型/完整lint/production build/浏览器mock及实际HTTP401/403/200/404通过，DB结构配置只读核验；独立Review配置漂移P2已修并复审。证据system-evaluation-2026-10-27/VERIFICATION.md。仅关闭本地首版功能缺口；真实付费AI质量、正式多人全链路、其它渠道/远程部署未验证，不扩称覆盖。熟悉度无独立数值，依据真实历史/有效接触次数/工作记忆。

- ACTIVITY-TIMER-011（P1，Resolved，当前五人预览本地，2026-10-22）：用户未调时间，实际pending时已有00:00；原仅planning五分钟暂停，阻塞弹窗仍消耗项目预算。HTML新增独立UI暂停marker覆盖匹配/策划/评价/未读结果，最后确认才恢复now；刷新离线、队列、锚点cap与拜访轮次扣时保护已回归。主线程五专项/tsc/lint/build、actual diff及独立Review通过，5001新静态HTML HTTP200确认。未重设当前0预算。调时旧marker回放为另一个确认缺陷同批保护，不倒推为本次原因。证据clock-popup-2026-10-22.md。

- ACTIVITY-TIMER-012（P2，Open，2026-10-22）：正式/多人服务端活动计时目前按提交或deadline恢复（state.ts resumeProjectTimerAfterCustomerActivity），尚无结果确认暂停持久契约；当前预览全UI暂停修复不直接替代服务器权威计时。后续须独立设计确认事件/事务及多人一致性，不在此预览批次擅自扩展，未做真实正式UI复测。

补充确认：用户未改时间，测试调时缺陷可复现但不能认定为其实际原因。实际另有当前预览活动pending/结果阻塞不暂停，历史页面在pending时就到0；用户“继续”后当前预览扩为全活动UI暂停，已归零时间不自动重设。正式多人服务端活动结果确认暂停未纳入此预览修复，后续一致性单独评估；不得声称全系统已覆盖。

## 2026-10-22 空活动方案没有准备不足影响

- ACTIVITY-010（P2，Resolved，本地）：shared evaluator空/纯空白固定负向指标，public outcome与两端空结果amber统一。根实际diff/四专项/tsc/定向lint/build通过，覆盖三类活动、空白字符、manual/timeout/room_ended、负向结算幂等及正式下限、AP/时间不变。5001更新exec30331，HTTP200新代码和health构建一致确认。旧已结算记录不回算。证据empty-plan-2026-10-22.md。

## 2026-10-22 再次拜访沿用旧消息

- PREVIEW-VISIT-003（P1，Resolved，本地）：meetingResponse/GET recovery从已有customerActivityStartIndex导出当前historyMessageIds，renderMeeting仅显示本次，start清旧draft，本地实时消息与失败草稿恢复同样隔离。历史保留，无冗余持久化数据。根实际diff审阅、七专项/tsc/四文件lint/production build通过，5001更新exec1642、HTTP200与health buildId确认。连续两场/截断恢复/首轮空白与旧失败draft为mock回归，未代操作用户拜访。证据repeat-visit-2026-10-22/VERIFICATION.md；只读时最新session862a9e9d...已endedtrue，不将截图当作当前turn0。

## 2026-10-22 沉浸式拜访无恢复入口且浏览器刷新仍旧版本

- PREVIEW-RECOVERY-002（P1，Resolved，本地）：权威GET恢复、boot/POST门控、沉浸式同步按钮、失败保留、身份隔离、恢复前计时保护及结束幂等已实现。根审查diff并运行七专项/tsc/定向lint通过；真实Chrome原拜访加载和重复同步/刷新成功，发送与主动告辞可用，原首轮对话及告别草稿保留。只读DB原session仍turn1/endedfalse，无reset/代发告辞。证据preview-recovery-2026-10-22/VERIFICATION.md与before/after.png。原告辞偶发AI故障VISIT-FAREWELL-001仍Open，不倒推为同一根因。

## 2026-10-22 主动告辞显示AI服务不可用

最终诊断状态（2026-10-22）：VISIT-FAREWELL-001 Open，原失败尚未复现/定位。已修确认的错误信息缺口（route普通/stream安全错误分类+前端502协议提示保留）；新helper及test-preview-error-diagnostics，主线程3专项/tsc/lint/build通过，5000更新并HTTP200确认。真实同state隔离重放成功，只读原会话仍v2，未替用户结束。下一步凭再发生时的固定code/action/npc/commandId及请求时间追查，不将展示改进记为原根因Resolved。证据visit-farewell-2026-10-22/VERIFICATION.md。

- VISIT-FAREWELL-001（P1，In Progress）：张建国首轮回复后主动告辞报错。只读DB v2 endedfalse仅首轮，无失败详情；按钮实际visit_turn固定告别。经用户明确外传授权，隔离重放实际state成功player_farewell/turn2，不能认定原根因。确认前端把502协议异常归为AI不可用、route日志缺安全分类，正在补排障信息。证据visit-farewell-2026-10-22/before.json、isolated-replay.json。原对局未改；原偶发失败待后续失败错误码确认。

## 2026-10-21 关键词规则直接裁决对话语义

最终状态：ACTIVITY-009 Resolved（本地，2026-10-21）。实现位于ai/customer-activities.ts、ai/customer-activity-reply.ts、game/project-one-preview-ai.ts、game/invitation-intent.ts、正式chat route及state私有诊断白名单。关键词只作疑似信号，AI语义+原文证据校验处理撤回/回复；日期续问、真正撤回、复杂否定及模型失败有回归，普通邀约异常fallback不猜结果。七专项、最终类型、定向lint、production build及独立Review通过；真实18种明确样例均有最终通过记录，初轮失败/歧义例如实保留。独立IAB真实三轮电话与DB源ID/零候选断言PASS，证据semantic-review/VERIFICATION.md。未重构全部评分/记忆语义检查；模型仍有含糊表达判断差异，不能宣称自然语言零误判。无远程部署/新正式或多人UI验收。

- ACTIVITY-009（P1，In Progress，用户已批准）：候选识别及撤回含直接正则过滤，AI识别出的候选也可被否定词覆盖；正式/预览活动回复正则直接触发重写、没有语义复核；普通邀约异常fallback按“不方便”等拒绝。用户批准改为规则提示+AI上下文复核，确定性仅校验结构/来源/业务流程，歧义与模型失败保留真实提议，回复无法确认则安全中性。原句修复ACTIVITY-008仍有效，本批不改数值门槛和评分。待专项/类型/lint/build及证据。

## 2026-10-21 普通活动回复仍暗示拒绝

最终状态：ACTIVITY-008 Resolved（本地，2026-10-21）。精确原句复现“能不能安排”被回复预筛误判为取消、专用guard调用0次；修正预览疑问归一化和正式活动专用helper，扩充间接拒绝/流程推脱检测，要求本人考虑/汇报再反馈，安全兜底无否定。主线程实际diff、六专项、类型、定向lint及production build通过；独立IAB真实电话原话返回“这个建议我先记下了，会先向上级汇报，再给您反馈。”，挂断后匹配弹窗；DB同通话/任务/全五20/60/numeric v3断言PASS。证据sales-proposal-phone-retest/REPLY_FIX.md、reply-fixed.png、reply-after-match.json。原用户策划自然提交后才更新服务；未操作其Chrome/重置对局，未远程部署或新正式浏览器E2E。

- ACTIVITY-008（P1，In Progress，最后检查2026-10-21）：真实赵电话“这个我这边暂时还没法安排…先按正常流程来吧”被回复guard放行，用户感知已被拒绝，和对话后匹配allow冲突。权威session c2ff06bb...v6、原话、allow/planning已只读查证；现有guard缺省略活动名的没法/无法安排及流程推脱，fallback也有否定措辞。证据sales-proposal-phone-retest/refusal-before.json。仅修回复、不动匹配和门槛；需原句/同义句重写兜底回归及更新后真实回复复测，未完成前不记Resolved。

## 2026-10-21 测试调节导致倒计时停止

- PREVIEW-TIMER-001（P1，Resolved，本地静态页修复，最后检查2026-10-21）：用户报告应用测试值后倒计时停止。实际applyTestControls重建timer时继承freshTimer的started=false，syncCountdown直接返回；新增实际HTML VM回归在旧代码复现600000!==590000，补started:true后普通倒计时/刷新归一化/拜访暂停恢复通过。ts-check、修改测试文件ESLint、diff-check通过，5000实际HTML HTTP200且包含修复。全量ESLint长时间未返回已中止、不记通过；静态HTML无Next打包依赖，本次未重建/重启以免打断用户对局。旧页面需刷新并在测试调节确认剩余时间、重新应用；不自动重写用户存储。ACTIVITY-007仍Open，真实挂断/同步成功处理与本缺陷独立。证据organization-thresholds/TIMER_FIX.md。

## 2026-10-21 赵晓晨电话活动漏识别

最终状态（覆盖下方历史Open/In Progress）：ACTIVITY-007 Resolved（本地修复与一次同场景真实复测，2026-10-21）。销售明确提议有程序候选保障，LLM语义补充合并，不以客户回应/置信度拦截，保留玩家撤回/非提议排除；普通客户直接拒绝/取消回复guard已接正式/预览。内部持久诊断覆盖电话建立/入队/识别/实际模型请求返回或候选跳过/门槛/任务/错误，不进玩家DTO。根独立专项/类型/lint/build与Review通过，真实赵原话+挂断前全五20/60已弹窗；权威DB新任务/数值v3/allow/同conversation完整日志独立断言PASS。证据sales-proposal-phone-retest/VERIFICATION.md、matched.png、after-match.json。旧失败模型原始响应仍未保存，旧唯一根因未知；未宣称全部自然表达/正式/多人真实链路或远程部署均验收。

2026-10-21后续实施状态：ACTIVITY-007转In Progress（用户明确批准），销售提议不再依赖NPC回应类别/置信度，新增确定性提议保障、NPC不拒绝guard、正式/预览持久诊断与真实电话复测。权威最新第二次电话session dec963d5... version7同样全五20/60且未匹配，原话“我想问问看能不能咱们下周召开一个技术交流会…提高效率”，客户“这类安排我需要先向上级汇报，确认后再答复。”；已保存sales-proposal-phone-retest/before.json，只读未改对局。尚未完成验证，不记Resolved。

后续核查更正：ACTIVITY-007当前只证明挂断/同步成功且未生成decision/task；没有模型调用trace或挂断前activeCall快照，不能证明真实那次已调用AI，更不能断言AI返回了空候选。正常代码会排队调用，未找到restore/SQL丢电话字段的路径；仍需区分未入队、AI空结果和status/confidence/kind过滤。已向用户更正之前过强归因。此前240测试为数值计算，真实成功样例为旧版张建国邮件，不是本次电话全流程验收。

- ACTIVITY-007（P1，Open，最后检查2026-10-21）：真实电话明确提议技术交流会、客户表示先向李经理汇报；命令记录确认先调全五20/60再挂断，配置numeric v3满足。结束及同步后activeCall=null、pending=[]、decisions/tasks=[]，定位到活动语义识别未产出候选，尚未进入数值门槛。原始检测响应未保存，不能断言模型具体输出或哪条过滤分支；“暂时定不了”与“暂缓”的提示歧义为待验证因素。证据organization-thresholds/PHONE_DETECTION_FINDING.md；本批只读诊断，未修复/未改对局。下一步消除暂未确认与拒绝/取消歧义并用原文回归，补真实完整链路验收。

## 2026-10-12 回复长度调整

- PROMPT-011（P1，Resolved，本地文本与契约，最后检查2026-10-12）：真实拜访低档仍多解释流程/清单，高层回复偏长。五人low全部引用收短，张新增客气时间收束，15档明确角色长度软参考且优先通用建议，customer允许不足30字；不截断正文。证据npc-role-prompts.ts、customer.ts、v4稿、冻结fixture；精确升级/自定义保护及专项、主线程类型/lint/build通过。运行接口已加载；仅本地文本缺口已完成，不等于模型字数稳定达标。
- TEST-SHORT-001（P2，Resolved，最后检查2026-10-13；下述为保留的历史阻断）：新稿真实长度尚未验证。27条沙箱请求均网络错误无正文；扩大网络执行被auto-review拒绝，指出未明确授权将新版内部NPC提示词/测试上下文发送到三个配置的外部模型服务。未绕过，0真实正文；后续需人类明确授权这些目的地及内容后抽样，失败批/拒绝记录保留harness/evidence/npc-short-replies-2026-10-12/。不能从旧45场或例句字数推断新生成达标率。

## 2026-10-12 三模型真实拜访复验

- PROMPT-007（P1，Open，最后检查2026-10-12）：三模型45场133条成功正文，16条同轮至少两句固定口头语、17次相邻复用；王拒绝8/9仍用“您说是不是”。豆包/Qwen低档还有主动安排/转交承诺。证据本日对照报告及harness/evidence/npc-model-visits-2026-10-12/；未修复，下一步在批准修复范围后约束输出并针对性回归。
- TEST-VISIT-001（P1，Open，最后检查2026-10-12）：旧502根因仍未修复；新矩阵豆包与Qwen中档李明辉告辞各一次HTTP200内SSE type:error status503，页面“本轮回应失败，请重试”，两场未成功结束。是否同根因未知，不归因于供应商或200ms截图。原始响应/失败截图可复核，下一步补关联诊断定位。
- PROMPT-009（P1，Open，最后检查2026-10-12）：Qwen主动把无已核验输入来源的精确邮箱/分机/采购指引/材料强制项说成确定事实，并出现公司口碑及当天转办断言。低王/低刘为明确样例，本地代码/资料检索无对应依据；未做外网真伪核验，不能称其有效渠道。证据本日报告、qwen-low-P1-003/005三轮原文截图；本批只登记，下一步限定事实来源与缺失时的回复策略。
- PROMPT-010（P1，Open，最后检查2026-10-12）：三档示例文本已分化（PROMPT-008本地Resolved保留），真实回复投入梯度仍不稳定：豆包低张开场即有条件安排对接，Qwen低档主动初筛/立即组织复核，低档未稳定限制到必要回应。高档部分欢迎语有差异，但不能据此声称三档全人物达标。第一轮固定初始档位可复核；后续JeV会变状态，本批不改评分/提示词，下一步获准修复后用同输入多次回归。

## 2026-10-08 常见销售场景逐档分化

- PROMPT-008（P1，Resolved，本地文本与契约，最后检查 2026-10-08）：五人各10条常见销售场景回复在低/中/高档原样复用，只有档位开头/少量专属例句有差异；当前用户要求共同场景的回复语气也分档。证据 projects/scripts/fixtures/npc-role-prompts-2026-10-08-before-tier-scenarios.json、npc-role-prompts.ts 原共享常量。范围为五人三档场景句分化及旧内置完整稿精确升级；三档始终礼貌、同信息/权限边界，保留设计师自定义。已在 npc-role-prompts.ts 分别生成每人三档共同场景，150句；逐场景断言先在旧稿失败后新稿通过。主线程逐项比较、人物/Excel/配置/正式/预览专项、类型/lint及Next/服务端构建通过；v3完整稿与逐项对照稿已导出。本地服务已加载最新构建，后台revision 5旧string读取匹配新稿，未物理写数据库。真实模型效果未复验，不借此关闭 PROMPT-007 / TEST-VISIT-001。

## 2026-10-08 真实拜访新发现

- PROMPT-007（P1，Open，最后检查 2026-10-08）：真实回复未稳定遵循口头语适量及承诺约束。15 场 API 的 44 条正文有 9 条堆叠至少两条配置短语，7 个场次相邻轮复用；王中/高档及 UI 最低愉悦度拒绝仍以“您说是不是”收尾；张中档承诺相关岗位后续联系但无确认。证据 harness/evidence/npc-visits-2026-10-08/ 及 outputs/五人NPC真实拜访测试报告-2026-10-08.md。已完成真实验收、未实施修复；下一步确定约束与生成策略并用相同真实场景回归。背景事实/具体渠道主动表述另需复核。沿用新 ID 避免覆盖历史 PROMPT-004～006 的不同阶段条目。
- TEST-VISIT-001（P1，Open，最后检查 2026-10-08）：张建国 UI 敏感请求首次失败，本地服务日志 preview AI stream status 502；页面显示可重试，同输入重试成功且未额外递增轮次。15 场 API 没有失败不能否定 UI 已出现故障。证据 ui-results.md、原句及报告；底层原因未确定、未修复。下一步增加可关联的错误诊断后复现定位。

## 2026-10-08 提示词语气调整

- PROMPT-005（P1，Resolved，本地文本与契约）：用户判定上版四人口头语为实际办事表达，未达到无业务含义的口语习惯要求，情境示例个人差异不足。2026-10-08 已在 `npc-role-prompts.ts` 保留张建国、重写四人口头语并按五人性格新增三档共 45 条情境例句；王德福/刘思琪语气与人物主档对齐。主线程已人工检查实际文本并通过人物、Excel、配置编辑、正式五人、预览 AI、类型与生产构建；旧本日稿精确升级、自定义字段保护通过。后台 revision 5 五人历史 string 均读取匹配新版默认；未部署/真实模型验收。

- PROMPT-004（P1，Resolved，本地提示词与契约）：五人示例存在生硬拒绝与命令口吻，缺少个人口头语。2026-10-08 已在 `npc-role-prompts.ts` 重写五人十五档例句并加入个人口头语，在 `customer.ts` 与 `prompt-config.ts` 同步礼貌底线；精确完整旧 profile 升级且保留自定义。主线程人物/配置/Excel/正式/预览及 Provider mock、类型、全量 lint、Next/服务端构建通过。后台只读实查 revision 5：五人历史 string 均读取归一为当前默认；未物理改写数据库或部署。真实模型语气尚未验收，不能从 mock 推断实际语气达标率。

- 最后缺陷复核与回归：2026-09-29；产品流程差异登记：2026-08-31；三家供应商机制代码现状核查：2026-09-28
- 规则：问题只改变状态，不删除；解决必须记录证据。

## 本期问题

### 执行优先级（2026-08-31 五人版替代决策）

0. **正式五人切换已完成**：D-047/D-073 已落实，`/game` 的人物源、状态、消息、结算及单机/联机基础创建统一为五人；旧四人存档已删除且不做映射。

1. **P0-A 五人正式迁移**：FRONT-006 已于 2026-09-21 关闭；后续不得恢复旧四人兼容分支。
2. **P0-B 认证与状态完整性**：AUTH-003、STATE-001；避免快捷入口 401、越权调用和“报错但状态已推进”。
3. **P1-A 共享状态与业务闭环**：STATE-002～004、FLOW-007、AI-018；补持久化、阻断解除、权威状态返回和来源核验。
4. **P1-B 测试台与交付体验**：UX-007、UX-008、TEST-003、ENV-007；补真实双模型、PDF、同用户双轨和失败恢复验收。
5. **P1-C 既有稳定性**：AI-012、AI-015、GAME-014、SCORE-003、DB-003、DOC-001。

当旧问题描述与 D-023～D-028、D-035～D-047 冲突时，以最新决策和动态问题台账为准。D-047 已确认五人版替代旧四人版；旧 `/game` 代码和旧台账仅表示迁移期实现/历史事实。

| ID | 优先级 | 状态 | 问题/目标 | 当前原因或下一步 |
|---|---|---|---|---|
| PROMPT-006 | P1 | Resolved (local code) | 五人三档提示词情境覆盖不足、基础稿精简过度 | 2026-09-30：五人基础稿补回经旧稿核对的人物动机、生活和渠道习惯，十五档覆盖开场、寒暄、介绍、岗位信息、材料、越权、礼物、告辞、附件/既有事实，并有档位差异；不设统一姓名强退。主线程复跑人物/Excel/配置/正式/预览专项、TypeScript、全量 ESLint、Next/服务端构建通过。远程配置和真实模型未实查。 |
| PROMPT-005 | P1 | Resolved (local code) | 五人基础提示词过长，低/中/高档缺少回复示例 | 2026-09-30：`npc-role-prompts.ts` 五人基础稿缩为背景/职责/固定边界，十五档各有岗位化要求及三条示例；配置读取只把精确旧内置稿升级，保留自定义。主线程复跑提示词、Excel、编辑配置、正式五人、预览专项、TypeScript、全量 ESLint、Next/服务端构建通过。远程物理配置未改写/未实查，真实模型在线效果待部署后验收。 |
| PROMPT-004 | P1 | Resolved (local code) | 五人回复提示词需由代码选低/中/高档，设计师可调门槛，愉悦度仅轻微修饰语气 | 2026-09-30：`prompt-config.ts` 共享可调门槛及确定性选档；正式聊天和五人预览只注入所选人物档，移除旧条件段与支持数值上下文；设计师页可编辑门槛及五人三档，Excel 兼容旧/新格式。主线程复跑角色、Excel、编辑配置、正式五人、预览专项与 TypeScript、全量 ESLint、Next/服务端构建、harness、diff 检查均通过。远程保存配置及真实模型/部署未实查，后续在线验收另行记录。 |
| UX-014 | P1 | Resolved (local code) | 设计师“测试调节”不显示交互后支持度和愉悦度的变化 | 2026-09-29：设计师预览 POST 与 GET 返回服务端五人快照，面板打开时刷新、普通交互后更新，缺字段/无权限时隐藏旧值；专项行为、鉴权、隔离、类型及构建通过。浏览器 5000 运行实例仍返回旧 GET 数据，需更新该实例后完成在线联调。 |
| PERF-001 | P1 | In Progress | Jev 决策的测试回复体感慢 | 2026-09-29：当前设计师页面 Jev 开关选中且已保存；预览普通消息/电话路径有两次 Jev 与两次正文 LLM 串行调用，Jev 最多三次尝试（单次默认 30 秒超时）。用户要求保留约 1.2 秒逐字播放，已恢复并验证。真实 Jev/LLM 各阶段网络耗时尚未实测，不能把整段等待单独归因 Jev。 |
| UX-013 | P1 | Resolved | 电话面板可看到历史对话正文，预览与正式游戏都应只展示历史通话条目 | 2026-09-29：预览 `renderPhone()` 保留独立历史条目并以活动通话 ID 限定本次正文；正式 `/game/page.tsx` 从 `/api/game/sessions/[id]/call-history` 读取元数据，按拨号时刻限定实时内容。API 仅投影 id/NPC/结果/阶段/时间，先鉴权与校验会话归属；失败提示重试。API 专项、预览行为 VM、旧 UI/账号隔离回归、TypeScript、全量 ESLint、Next/服务端构建及 diff 检查通过。仅本地验收，远程数据库与登录态浏览器 E2E 未实查。 |
| AI-026 | P1 | Resolved | 张建国电话回复角色反转，以供应商身份发言并称玩家为“张总” | 2026-09-29：截图定位设计师实际测试 `/api/project-one-preview/ai` 的 work_phone 回复。`project-one-preview-ai.ts` 增加目标人物身份质量门、一次重生成及同人物/渠道兜底；旧错误台词从生成上下文排除，原始流水保留。预览专项覆盖截图型反转、连续失败、状态不污染、正常自我介绍与他人姓名；人物提示词专项、TypeScript、目标 ESLint、Next 构建、harness 检查通过。仅本地实现验收；远程保存提示词与真实模型请求未实查，正式 `/api/chat/stream` 另有同类质量门缺口待评估。 |
| AI-027 | P1 | Resolved (code) | 正式聊天 AI 正文缺少发出前的身份视角验收 | 2026-09-29：正式流式回复在评估/持久化前先缓冲并经身份门校验；角色反转最多纠偏一次，仍失败则安全兜底，拒绝稿不进入状态流程。身份专项、正式五人、类型、lint、构建通过；真实模型对话仍待部署后验收。 |
| AI-028 | P1 | Resolved (code) | 预览实际拜访回复未使用已有 NPC 发言身份保护 | 2026-09-29：`visit_turn` 和工作微信申请均接入 `speakAsNpc` 与身份质量门；预览专项验证拜访反转稿不进入评估/持久化且正常提及其他人物可通过。类型、lint、构建通过；真实模型对话仍待部署后验收。 |
| AI-029 | P1 | Resolved | 五人主提示词直接规则混用第三人称且保存配置可能覆盖新版 | 2026-09-29：五份直接职责/行动/回复规则统一 NPC 第二人称，背景、第三方与话术引用保留；新增迁移并测试与代码默认提示词逐字一致。按用户选择，后台 `project-one` 五份已保存提示词经 revision 条件更新，版本 4→5；读回确认其他配置字段未变化。提示词专项、类型、lint、构建通过。 |
| AI-025 | P1 | Resolved | 设计师后台切换正文 AI Provider，并接入 Qwen | 2026-09-29：`client.ts` 默认路由按独立 `global-ai-provider` 配置选择，显式轨道不受影响；`/designer/ai-provider`、鉴权/CAS API、Qwen `QWEN_AI_*` 已接入。mock 验证 Qwen 路径/Key/模型/参数、全局选中后实际路由、配置读失败不跨 Provider；选择校验与原双轨专项、TypeScript、全量 ESLint、Next.js/服务端构建、harness 检查通过。仅本地实现验收；远程数据库保存与真实 Qwen 调用未实查，当前本地缺 `QWEN_AI_*`，页面应标为未配置。 |
| GAME-015 | P1 | Resolved | 正式游戏体验同步设计师实际测试、隐藏支持度并接入三家招标机制 | 2026-09-28：支持度隐私已实现：正式 game/result UI、session/commands/messages/result DTO 和复盘上下文不暴露支持度数值/档位；设计师测试样例结果不显示支持度，测试调节面板保留支持度编辑。用户通过 D-084 确认并采用正式 `game_sessions`/commands/reducer/结算为唯一权威，同步实际测试 UI/动作，preview 会话及浏览器阶段/AP不迁入。正式 `/game` 工作台与 `game-board.module.css` 已完成同步；正式 `work_plan`、`postal`、`brief_visit`、直访和拜访任务完成判定均通过服务端命令/reducer，`recordMeetingTurn` 校验 evaluator 可信进度并记录结束原因。三家优势、规则建议采纳/反馈与唯一中标结算贯通正式流程。验证通过：12 组相关 TSX 测试、`tsc --noEmit`、`eslint . --quiet`、`next build`、`tsup src/server.ts`、`scripts/harness-check.ps1`、`git diff --check`。未执行登录态、数据库支持的真实 UI E2E，也未实查远程 Supabase；这是本地专项/状态测试和构建验收。 |
| AI-024 | P1 | Resolved | 设计师按用户要求全局选择 Jev 或 LLM 承担结构化决策 | 2026-09-23：配置旧记录缺省 Jev；设计师全局开关和统一调用路由已接入正式、预览、提示词测试 10 类任务。LLM 简化答案经同一响应契约和业务规则校验；配置不可读或 Provider 失败只走确定性兜底。适配器、配置路由、人物画像及业务专项、TypeScript、全量 ESLint、Next.js/服务端构建通过；远程保存/真实模型烟测未执行。 |
| AI-023 | P1 | Resolved | Jev 部分 NPC 判断缺少个体画像，设计师无法看到 state 已填的静态值 | 2026-09-23：五人主档同源画像已进入正式 NPC/礼品、固定张建国测试及预览相关 Jev 判断，计划匹配用紧凑候选；设计师页逐人展示静态真实值，动态对局数据不跨用户展示。注入式真实请求专项覆盖不同人物、未知 ID、预览多路径与原 question 契约；相关业务回归、类型、全量 lint、Next.js/服务端构建通过。真实 Jev 调用及远程页面人工验收未执行。 |
| AI-022 | P1 | Resolved | Jev state/question 缺少设计师可视化与安全编辑入口 | 2026-09-23：`/designer/jev-config` 与独立配置 API 展示 10 类任务字段、默认问题、类型/候选；仅编辑 state 补充说明和 question 指令文字，固定结构及硬规则。独立 `project-one-jev` 记录、权限/白名单/版本冲突校验与默认 Jev 调用接入已完成；专项、Provider 与业务回归、类型、全量 lint、Next.js/服务端构建通过。远程保存和真实 Jev 账户烟测未执行。 |
| AUTH-004 | P0 | Resolved | 五人预览账号切换后显示上一账号缓存，并以旧会话发送或重置 | 2026-09-23：页面快照/会话指针按 userId 分区，身份和 token 变化时切换完整状态并废弃在途结果；无 owner 的旧缓存清除一次。仓储修复 PostgREST 普通对象错误读取，非本人/不存在会话统一 404，真正持久化故障 503；数据库仍按 `id + user_id` 限制访问。双账号 VM、错误映射、预览 AI、UI 契约、类型、全量 lint 和构建通过。 |
| AI-021 | P0 | Resolved | 将 AI 选择/评估与自由文本生成分层，选择统一交给 Jev | 2026-09-23：独立 Jev typed-question 客户端已接入正式 NPC 评估/礼品/竞品、五人预览和提示词测试；原 LLM 只写自由文本且越权决策字段被忽略，Jev 失败只走确定性兜底。mock HTTP、业务专项、TypeScript、全量 ESLint和生产构建通过；本地未配置 `JEV_API_KEY`，真实账户烟测未执行。 |
| UX-012 | P1 | Resolved | 五人预览实际拜访只在工作台小窗口展示，未使用场景和人物表情素材 | 2026-09-22：完成张建国办公室样板，会面切换为全视口场景+人物+对话+自由输入，优先读取 `leader_office`；服务端仅下发五档可视表情枚举，进入动画一次性播放并支持 reduced-motion。正式 `/game` 的拜访界面本批未迁移。 |
| UX-011 | P1 | Resolved | 场景素材主按钮对比度不足，行动点/竞品情报图标轻微错位 | 2026-09-22：场景新增与保存按钮改为深紫实底、白字并补齐 hover/focus；两枚 SVG 在共用 32×32 容器内独立做半像素光学校正。静态专项、TypeScript、ESLint、生产构建与 harness 验证见本批最终记录。 |
| BASE-003 | P0 | Deferred | 历史后台引用表尚未建模 | BASE-008 已禁用缺表 API 并返回 501；开放链路不再依赖这些幻影表，剩余数据建模随 ADMIN 后台专项实施（2026-09-08 复核） |
| BASE-004 | P0 | Resolved | 完整固定纵向冒烟已通过 | `pnpm test:e2e` 覆盖建局、对话、隔离、恢复、关系动作、五轮结算和复盘 |
| BASE-006 | P2 | Resolved | 日常 lint 提供缓存增量路径 | 新增 lint:cached，缓存位于忽略的 node_modules/.cache/eslint/；lint:build 保留完整发布扫描。命令与缓存路径已验证（2026-09-08） |
| BASE-007 | P2 | Resolved | 全量 ESLint 存在 29 个历史错误 | 已清零：延期后台路由重写移除 19 处 + 排行/设计师页面改为具体类型 10 处；`eslint . --quiet` 0 error |
| AI-003 | P0 | Resolved | NPC 消息持久化与刷新恢复已验证 | API 纵向测试与浏览器刷新后对话恢复均通过 |
| AI-005 | P0 | Resolved | 长对话滚动摘要已接入聊天运行链路，并保留事实/承诺账本 | 达到阈值时在聊天提交前压缩已持久化旧消息，摘要与本轮状态进入同一个版本事务；失败不阻断本轮并记录有限错误码。真实 18 条历史消息触发摘要，游标推进、刷新恢复和事实/承诺合并回归通过 |
| AI-007 | P0 | Resolved | 真实模型 NPC 状态与复盘结构化协议已验证 | 发现复盘偶发 502 后增加 JSON 模式、严格约束与一次纠正重试；纵向回归通过 |
| AI-009 | P1 | Resolved | NPC 回复采用真实流式接收和平滑逐字呈现 | 首片前显示“NPC 正在思考…”，分片进入自适应逐字队列；浏览器实测正文在多个 200ms 采样点连续增长，页面卸载会取消请求和计时器 |
| DB-001 | P0 | Resolved | 完整迁移已推送到托管开发数据库 | `20260819000200_five_stage_multiplayer.sql` 已应用，`supabase migration list` 对齐，远程 `db lint` 为 0 error；`health_check` 只读查询成功并读到 seed 数据 |
| DB-002 | P1 | Resolved | 消息、状态、事件多次写入缺少完整事务原子性 | `commit_game_command` 已将聊天正文、AI评估、模拟时间、态度、库存、风险、事件和命令幂等记录收进同一版本化事务；真实E2E重试通过 |
| PROMPT-001 | P1 | Resolved | 五人人物总提示词未按已确认的张建国完整结构展开 | 五人岗位化完整提示词已成为默认值；迁移 `20260920000100` 只覆盖开发库五个人物总提示词并保留其他配置，revision 2 读取一致；专项、Excel、类型、lint 与构建通过（2026-09-20） |
| PROMPT-002 | P1 | Resolved | 赵晓晨被描述成系统使用者，未体现李明辉直属项目执行人员职责 | 主档、页面、完整提示词及关联人物表述已统一；迁移 `20260920000200` 已应用，开发库 revision 3 与代码一致（2026-09-20） |
| PROMPT-003 | P1 | Resolved | 五人人物缺少事业、家庭和现实压力形成的个人心理动机 | 五份提示词均新增人物背景和当前处境；迁移 `20260920000300` 已应用，开发库 revision 4 与代码一致，不新增逐轮内心独白（2026-09-20） |
| VISIT-001 | P1 | Resolved | 五人预览不能可靠处理 NPC 忙碌、开会和双方主动告辞 | 新增双方 AI 信号、文字兜底和最后回复状态；强制忙碌结束、双方告辞一次回复、绕过与否定表达均有服务端回归（2026-09-20） |
| GAME-001 | P0 | Resolved | 五轮状态机已完成 DB 纵向验证 | 第 1 轮推进至第 5 轮并产生确定性结果，不进入第 6 轮 |
| GAME-002 | P0 | Resolved | 关系动作服务端扣点已完成 DB 纵向验证 | 节日祝福验证 28→25，亲密度 35→37，刷新保持 |
| GAME-003 | P0 | Resolved | NPC 人物解锁语义验收已被新基线取消 | D-024 决定四名 NPC 全部显示，人物解锁、披露关键词和发现弹窗不再属于项目一；个人关注点与公开信息语义转入 FLOW-003、FLOW-004 |
| GAME-006 | P0 | Resolved | 对局、动作、消息、结果恢复已完成纵向验证 | API 与浏览器刷新恢复通过；E2E 测试结束自动清理测试数据 |
| GAME-007 | P0 | Resolved | 结算与 AI 诊断真实联调完成 | 真实模型复盘通过三数组结构校验并落库 |
| GAME-008 | P1 | Resolved | 关系动作已具备 NPC 偏好配置与结果拆解 | 固定基础值 + 人物偏好修正即时展示；AI 沟通评价在回复后并入同一结果卡。王浩、刘凯、陈建国、赵峰均有独立偏好/反感动作配置 |
| GAME-009 | P1 | Resolved | 闭环验收推进过慢，数值变化不易感知 | 增加独立快速验收账号；该账号新对局将关系动作和 AI 对话产生的亲密度、五维分数变化放大至 ×3，可从顶栏自行补充 1–999 行动点；操作点成本与五轮结构不变，普通账号固定 ×1 且无补点权限 |
| GAME-010 | P0 | Resolved | 项目一已具备模拟时间、邀约拜访和结算闭环 | 五个09:00–17:00模拟工作日、预约预留、5/40/60拜访、准备/纪要/跟进、第五阶段自动结算和混合公式均由真实E2E验证；不再使用真实倒计时或暂停 |
| UX-001 | P1 | Resolved | 新人物解锁反馈历史实现 | D-024 已取消项目一隐藏人物；该弹窗与本地一次性标记应在 FLOW-002 中删除，不再继续维护 |
| AI-010 | P0 | Resolved | NPC 跨人物转述已接入 promised→sent→received 阶段链路 | 聊天提交后记录 promised；下一阶段 sent、再下一阶段 received，目标 NPC 仅读取 received inbox；已移除承诺当回合立即改变目标印象。真实托管数据库验证同阶段不提前 received、跨两阶段正确送达 |
| AI-011 | P1 | In Progress | NPC 历史主张核验需继续提高结构化可靠性 | 已加入每 NPC 独立事实/承诺账本、提示词核验规则和最近对话/摘要隔离，并补长且互相矛盾的竞品主张、来源校验及“未核实谎言不改真实竞品状态”确定性回归；真实模型长对话质量证据仍缺 |
| AI-012 | P1 | Resolved | 模型短暂失败、流协议失败与聊天 HTTP 错误状态已区分 | 网络/429/5xx 响应开始前最多重试一次，鉴权失败不重试，流中错误不重放；聊天提交前失败返回非 2xx 与有限错误码，正文仍在事务成功后返回。mock Provider 的重试/上限/401/中途错误回归通过（2026-09-08） |
| AI-013 | P0 | Resolved | NPC 正文成功但结构化评分连续失效，玩家无感知 | 已拆为流式角色正文 + 独立低温 JSON 评分；评分携带本轮玩家输入、NPC 实际回复、最近对话和记忆，失败自动重试，再失败走规则兜底。前端逐轮显示变化、原因和兜底标记；强化真实 E2E 连续对话通过 |
| AI-014 | P1 | Resolved | 会面中“谁先谈工作”只由服务端状态与结构化评估决定 | 请求契约已删除 `workTopicOpenedBy`，旧客户端提交该字段也会被 Zod 剥离；NPC 提示和评分只读取权威 activeMeeting 状态，回合完成后再由服务端评估写入。注入覆盖测试、TypeScript 和目标 lint 通过 |
| AI-015 | P1 | Resolved | 长对局复盘改用摘要、关键事件和最新消息尾部 | 原始对话只保留最新 32 条；滚动记忆、白名单事件和安全持久状态补足早期关键信息，复盘输入总长受限且不包含竞品隐藏状态；`test-review-context`、TypeScript 通过（2026-09-07） |
| GAME-011 | P0 | Resolved | 大改后模拟时间、预约和AI礼品逻辑存在边界冲突 | 修复等待/赴约占用、迟到、晚间免加班、改期后晚间上限、历史联系人迁移和边界礼品AI覆盖；状态机与真实E2E通过 |
| GAME-012 | P1 | Resolved | 会后跟进已强制校验已完成拜访和预约归属 | message 跟进必须提供 appointmentId；服务端要求预约属于当前 NPC、状态为 completed 且存在对应会谈纪要，拜访进行中禁止发送，所附材料也只能属于该预约或通用材料。状态机与真实 API 对局均验证拜访前拒绝、拜访后成功 |
| UX-002 | P1 | Resolved | 对局过程暴露内部态度/支持等评分 | 手机式对局页只以头像、措辞、通知、回复速度和结果反馈；五维、态度、证据、风险仅在结算显示 |
| FRONT-001 | P0 | Resolved | `Weixun Web` 下一版目标基线已完成首轮澄清 | D-039 确认五人结构、仅以“人物主档”为人物内容输入、公开信息持续沉淀、总体工作计划/拜访准备分别由独立 AI 判断、隐藏信息只从主档匹配、附件由 AI 判断影响并记录 NPC 收件与查看状态；人物主档具体内容仍可调整，当前不实施业务同步 |
| FRONT-002 | P0 | Resolved | 五人版前端需进入现有系统供测试 | 初版误做成简化重构，视觉与原型差异过大；已纠正为把 `project1-prototype-v9.html` 原样纳入 `public/`（SHA-256 一致）并由 `/project-one-preview` 全屏承载。项目一入口、五人三栏页通过浏览器验收，TypeScript、目标 ESLint、Next.js 生产构建通过（2026-08-25）。原 `/game` 与多人闭环未改 |
| FRONT-003 | P0 | Resolved | 五人版原型的 NPC 互动仍是固定 Mock 话术，未接入项目 AI Provider | 已新增鉴权的 `/api/project-one-preview/ai`、五人服务端画像与结构化契约；计划、邮件/电话/微信、拜访准备、拜访对话和简述方案均走真实 Provider，客户端固定回复/任务判定已移除。契约测试、TypeScript、目标 ESLint、生产构建、真实计划判断与 NPC 邮件调用通过（2026-08-26） |
| FRONT-004 | P1 | In Progress | 五人预览的状态节点、有效接触和工作记忆分层体系尚未完成正式化 | 分层 Prompt、多条件节点、来源记忆、阻断解除和预览会话数据库持久化已实现；2026-09-21 新增安全恢复 DTO。剩余是稳定业务记忆表、完整评估/前后快照审计、与正式五人对局共享 Resolver，不能重复建设已完成部分 |
| FRONT-005 | P1 | Resolved | 性格类型缺少统一服务端字典 | 2026-09-21 已建立老虎/猫头鹰/孔雀/考拉四类字典，含稳定 ID、展示名、DISC、沟通偏好、正负触发、披露倾向、风险反应和优先级规则；五人主档、Prompt、设计师页面及 Excel 统一引用，人物专属边界优先。专项通过 |
| FRONT-006 | P0 | Resolved | 五人版正式替代旧四人版 | 2026-09-21：正式唯一人物源、状态初始化、NPC API、聊天评估、转述、竞品目标、结算和教练/联机基础资料统一为 `P1-001`～`P1-005`；玩家单机入口进入正式 `/game`。远程实查 10 个项目一存档全部为旧四人，已按授权删除且不映射；临时正式存档验证五人持久化后清理。多人实时广播继续由 MULTI 项跟踪 |
| DESIGNER-001 | P1 | Resolved | 设计师首页入口按甲方/乙方/场景/指标混排，人物素材、报告和测试缺少一致分组 | 2026-09-07 首次改为任务型入口；2026-09-20 按 D-060 将场景图片并入素材库，现为素材库、数据、报告、测试四个一级入口。可写图片素材使用真实上传服务，其余未开放能力保持明确空状态。 |
| DESIGNER-002 | P1 | Resolved | 人物提示词缺少 Excel 导入导出，不能批量维护五人人物与渠道提示词 | 2026-09-15：已新增仅含人物可编辑字段的 `.xlsx` 往返、严格校验与页面草稿应用；保存继续使用版本检查。专项、TypeScript、目标与全量 ESLint、生产构建通过。最后检查 2026-09-15。 |
| DESIGNER-003 | P1 | Resolved | 人物提示词工作簿仍暴露英文代码与技术说明，已读不回个性化提示的填写位置不明 | 2026-09-16：新表只显示中文姓名、用途、交流方式；旧表兼容、中文渠道新增行及往返专项、TypeScript、目标与全量 ESLint、生产构建通过。系统沉默协议保持固定，人物偏好在现有提示词填写；最后检查 2026-09-16。 |
| DESIGNER-004 | P1 | Resolved | 设计师无法上传人物介绍图、五种表情图和拜访场景图 | 上传与持久化已接入。2026-09-21 直接核对开发库和 Storage：5 张介绍图、25 张表情图全部存在，25 个公开地址均返回 200/PNG；4 个拜访场景位仍为空。表情素材已可管理，但游戏运行时表情映射规则尚未定义，不在本项冒充完成 |
| DESIGNER-005 | P1 | Resolved | 场景素材分散在独立入口，场景提示词页缺少实际用途，素材缩略图不能查看大图 | 2026-09-20：场景图片合并进素材库，独立场景入口与场景提示词页移除；三类图片统一支持高清预览。素材专项、TypeScript、目标 ESLint、Next.js 构建通过；最后检查 2026-09-20。 |
| DESIGNER-006 | P1 | Resolved | 场景素材被限制为四个固定图片槽，无法作为数据记录增删查改 | 2026-09-21：新增独立 `designer_scene_assets`、安全 CRUD API 与数据表 UI；005 迁移已应用，5 张用户场景图已导入并逐一验证 200 PNG，临时记录真实 CRUD 后清理；专项、类型、全量 lint、构建和远程 db lint 通过。正式游戏选图规则不属于本项。 |
| TEST-004 | P1 | Resolved | 五人预览测试调节不能修改拜访预约 | 2026-09-17：服务端预览会话校验预约创建、修改、清除及完成状态，前端按权威列表同步；预约与 AI 预览专项、TypeScript、全量 ESLint、Next.js 构建通过；最后检查 2026-09-17。 |
| STATE-001 | P0 | Resolved | 双模型测试响应校验失败不再污染状态和版本 | run/reset/end_visit 统一候选状态→完整 Response 校验→提交，限制数量与阻断白名单，强制红线不能被同轮 remove 覆盖；版本溢出/记录上限/幂等副本/失败原子性回归通过（2026-09-08） |
| STATE-002 | P1 | In Progress | 五人预览与提示词测试会话已持久化，共享限流仍未完成 | 2026-09-21 两类会话已迁入 Supabase，使用用户/Provider 隔离、command 唯一键、请求哈希、版本和可续租短租约；真实数据库跨仓储实例恢复、重放、改包拒绝及版本推进通过。API 速率桶仍是进程内，多实例共享限流待补；模型调用在极端跨进程租约失效时仍可能重复，但只允许一次状态提交 |
| STATE-003 | P1 | Resolved | 五人预览按受控规则解除合规阻断并更新工作记忆 | 本人明确撤回具体红线且说明正式整改才解除；否定、引用、假设或继续违规不解除，resolved 记忆保留真实消息来源，不再强制注入高价值上下文。专项正反例通过（2026-09-08）；这不等于现实整改附件已核验 |
| STATE-004 | P1 | In Progress | 五人预览已有安全恢复 DTO，完整审计快照仍缺 | 2026-09-21 GET 恢复接口可返回会话版本及玩家可见状态，并明确剔除支持度、阻断、工作记忆、Evaluator/理由与附件正文；页面/报告所需的完整内部审计 DTO、逐命令前后快照和权限边界仍待实现 |
| FLOW-007 | P1 | Open | 五人预览与旧正式链路的渠道和拜访状态机双轨 | 微信存在 `wechat/online` 两套编码；预览拜访与旧 short/formal/informal 的预约、准备、轮次和结束条件不同。五人迁移时建立 canonical channel ID 和统一拜访状态机，明确直接登门/已邀约/准备/失败/结束原因 |
| AUTH-003 | P0 | Resolved | 快捷入口与测试 API 的会话、角色和额度边界已补齐 | 登录证明不能充当 session；权限按服务端角色配置判断，prompt-test API 仅允许工作流编辑权限且每用户 30 次/分钟。401/403/400/429 与伪装权限回归通过（2026-09-08）；正式认证体系仍为 AUTH-001 |
| UX-007 | P1 | Resolved | 浏览器测试快照已按用户和场景版本隔离 | 清理旧共享 key，新增本地快照清理入口，身份/请求代次改变后旧响应不得回写；用户隔离辅助逻辑回归通过（2026-09-08）。服务端跨重启持久恢复仍由 STATE-002 跟踪 |
| UX-008 | P1 | Resolved | 双轨失败输入、单轨重试和结束状态已补齐恢复约束 | 目标轨全部成功且输入未被改写才清空；每轨保存原话术、commandId、expectedVersion 和已知 sessionId 重试；ended 禁发并提示重置。专项回归通过（2026-09-08）；首次响应丢失且未知 sessionId 的跨会话恢复仍受 STATE-002 限制 |
| UX-009 | P1 | Resolved | 五人版工作微信缺少 Emoji 与轻量表情表达 | 已加入 16 个常用 Emoji 和 8 个系统预设工作表情包，不提供上传；表情包经现有 AI 文本消息链路发送，成功后才扣点并写入带白名单 ID 的视觉消息。专项回归、AI 预览、TypeScript、目标 ESLint及生产构建通过（2026-09-11） |
| UX-010 | P1 | Resolved | 五人预览的准备页缺少跳过准备直接拜访入口 | 2026-09-17：已增加入口和显式 `skipPreparation` 请求；服务端仅对该请求跳过准备门槛，普通路径仍校验准备。专项覆盖成功、普通拒绝和字段类型，TypeScript 与生产构建通过；最后检查 2026-09-17。 |
| UX-010 | P1 | Resolved | 五人预览无法快速构造阶段、行动点、微信状态及 NPC 关系数值 | 顶部测试调节面板可修改阶段、行动点、累计消耗、五人微信状态，以及各 NPC 的支持度、愉悦度和有效接触次数。NPC 数值经严格契约写入当前进程内预览会话并影响后续 AI，派生节点只读显示；生产环境默认关闭，不写正式数据库。专项、TypeScript、ESLint 和生产构建通过（2026-09-11） |
| TEST-003 | P1 | Open | 五人版与双模型测试台缺少发布级浏览器/真实模型证据 | 2026-09-21 已补真实数据库跨实例恢复/幂等/改包拒绝及更多确定性对抗回归；仍缺同一用户 DeepSeek/豆包真实并行、真实长对话、两类 PDF 实际另存与分页、弹窗拦截和多尺寸截图。专项单测、构建和 DB 验证不等于发布验收 |
| ENV-007 | P1 | Resolved | 本地预检支持命名 Provider | local:check:prompt-test 检查 DeepSeek/豆包 URL、Key、Model，输出仅含变量名与修复方式。缺变量、非法 URL、不泄密回归及当前配置预检通过（2026-09-08） |
| ENV-008 | P2 | Resolved | 日常启动和验证已避免错误 pnpm 版本触发隐式安装 | packageManager 固定 pnpm 9.0.0、engine <10；脚本优先已有本地二进制，缺依赖提示 Corepack。COREPACK_ENABLE_NETWORK=0 下 pnpm 9 和预检回归通过（2026-09-08）；首次安装/依赖变更仍需缓存或网络 |
| DOC-001 | P1 | Resolved | 本批台账、实现边界、来源和验收命令已同步 | 更新 STATE、CURRENT_ITERATION、SOURCE_OF_TRUTH、LOCAL_DEVELOPMENT、DECISIONS、FINDINGS 和 HANDOFF；明确进程预览、延后能力、事务后 SSE 与新 C0 规则，不把历史验收视为本批证据（2026-09-08） |
| DOC-002 | P0 | Resolved | 台账与实际项目曾多次不同步，原检查只验证文件存在 | 2026-09-21 根 AGENTS 新增实查优先、权威源、证据状态和双向复核硬约束；harness-check 对实现类改动强制要求 STATE、CURRENT_ITERATION、ISSUE_REGISTER、HANDOFF 同批更新，遗漏时退出失败 |
| GOV-004 | P0 | Resolved | 五人预览、测试台与生产修复已形成可复现提交基线 | 按模块提交 `0a76670`（预览/测试工作台）与 `81a975f`（生产台账修复），治理文档随本批入库；TypeScript 和 9 组专项脚本通过，工作区干净（2026-09-07） |
| RANK-001 | P1 | Resolved | 房间排行榜已按真实房间和终态对局统计 | 支持房间 ID/房间码/当前用户房间作用域并校验房主、席位或教练权限；仅返回 `won/lost` 的必要字段，空榜统计为 0，页面移除伪造指标；`test-ranking-db-fixes`、TypeScript 通过（2026-09-07） |
| DB-003 | P1 | Resolved | 完成时间修复已应用开发库并通过真实验证 | 20260904000100 和 20260908000100 已应用；首次完成写入 finished_at，后续通知/幂等/冲突保持原时间。独立临时对局 E2E 通过并清理，仅影响本次测试对局（2026-09-08） |
| DB-004 | P1 | Resolved | 业务版本冲突被接口误当作序列化失败重试到超时 | 新迁移将两个 RPC 的业务冲突由40001改为P0001，保持事务与权限。真实 E2E 验证及时返回、完成时间不变、版本不推进和命令插入回滚（2026-09-08） |
| SCORE-002 | P1 | Resolved | C0 无效引用和权重方向已按用户授权改为明确新规则 | 正向 0–100：A13/A5 各40%，A31赞美次数按4次归一化占10%，A46提问按6次归一化占10%，每项截断0–100。引用/括号/边界/单调性/次数上限测试通过（2026-09-08）；不改真实游戏结算或原始资料 |
| ENV-002 | P1 | Resolved | 已采用无需 Docker 的托管 Supabase 流程 | CLI 已安装、项目已关联、迁移已推送且 migration list 对齐，远程查询及 `db lint`（0 error）成功 |
| ENV-005 | P1 | Resolved | Windows 重启后缺少可发现的一键启动入口 | 根目录新增 `start-project.bat`，覆盖配置、依赖、端口和构建检查，启动后自动打开浏览器 |
| GOV-003 | P0 | Resolved | 7448 行改动与 10 个未跟踪路径（含 3 个迁移文件）尚未提交 | 已按工作项分 5 个 commit 提交（docs(harness)/feat(db)/feat(game)/chore(dev)/refactor(dev)），3 个迁移入库，工作区干净 |
| AUTH-002 | P0 | Resolved | 认证无信任边界，可自封任意角色并接管他人存档 | session token 改用 HMAC-SHA256 签名，`getSession` 验签不再信任无签名 base64；`select_role` 需验签 loginToken 后按 token.userId 签发；coach/enterprise 16 路由与 game-data 写接口加 authGuard。伪造 token 与未认证访问实测 401。角色细分仍留待正式认证（AUTH-001） |
| GAME-013 | P0 | Resolved | 邀约、NPC回复、礼品兜底和合规审计已改用服务端密钥派生的 HMAC 概率种子，原客户端 commandId 只保留为幂等键 | 命令路由与聊天路由统一通过 `server-random.ts` 生成不可预测种子；礼品 AI 兜底同样使用签名种子。单测验证同输入稳定、不同命令不同且种子不含原命令文本；TypeScript/ESLint/状态机通过 |
| AI-016 | P0 | Resolved | 评分提示词与 Zod schema 已对齐，协议失败可观察 | 评分字段全部改为真正必填，提示词列出精确键、枚举、长度和完整 JSON 示例；解析器返回 Zod 路径错误码，重试与规则兜底均保留错误，事件和消息元数据记录来源/错误码。合法、缺字段与坏 JSON 回归通过 |
| AI-017 | P0 | Resolved | 玩家文本已从系统规则中隔离 | NPC 固定规则与运行上下文分离；人物、记忆、材料等统一进入有长度限制和来源标记的 `<untrusted_data>` JSON 区块，系统明确禁止执行数据内指令；准备标题改为服务端枚举，线上联系/评分/礼品上下文同样隔离。注入与控制字符回归通过 |
| AI-018 | P1 | Resolved | AI 事实、承诺、证据与合规结算已收回服务端权威边界 | 事实/承诺/两类证据须能在 NPC 实际回复中确定性溯源，持久化前二次核验；礼品 disposition、severity/status/penalty 由服务端策略和种子决定，模型不能强制上报或篡改扣分；专项回归通过（2026-09-07） |
| GAME-014 | P1 | Resolved | 玩家可达流程已统一为纯行动点阶段推进 | 旧分钟参数不再影响扣费或阶段推进，阶段转换只补充封顶行动点并单次执行审计；旧综合状态脚本已按当前规则更新，`test-game-state` 与五阶段回归通过（2026-09-07） |
| SCORE-003 | P1 | Resolved | 结算证据恢复强度对象并阻止跨类双计分 | 证据契约改为 `{statement,strength:1..5}`；同一 NPC 回复句只能进入一个证据账本，礼品/利益交换不计个人收益，强度参与结算；专项回归通过（2026-09-07） |
| BASE-008 | P1 | Resolved | 10 张幻影表 + 列名不匹配 + 部分路由静默吞错 | coach/enterprise 16 路由与 game-data 幻影路径统一 501「功能未实现」，不再查询未建表或回传 `error.message`；保留 npcs/competitors 的 project_id=1 真实分支（可用游戏依赖），无表名泄漏 |
| ENV-006 | P1 | Resolved | 一键启动不检测陈旧构建 | 2026-08-14：启动器按源码/配置与 `.next/BUILD_ID`、`dist/server.js` 的 mtime 判断陈旧并强制重建；增加数据库预检、带构建号的启动健康检查及端口自动回退。生产构建通过；5000 被旧服务占用时实测自动启动到 5001，`/api/health/startup` 返回当前 buildId 与 `database=ok` |
| UX-003 | P1 | Resolved | 已开放页面的假数据与假成功展示已清理 | 玩家首页/排行榜/教练/房间既有修复保留；企业页移除假玩家/进度/报告/邀请码，携带会话且区分401/403/501，失败不改本地结果；未实现能力禁用并显示空态。后台模型建设仍为 ADMIN 专项（2026-09-08） |
| FLOW-001 | P0 | Resolved | 唯一进行中存档与“继续游戏/开始新游戏”双入口已由数据库事务和唯一约束收口 | 新 RPC 对同一玩家加事务锁，部分唯一索引保证最多一个 playing 对局；历史重复档和被覆盖档内部标记为 replaced，不再可继续。真实并发创建得到 1 次成功 + 1 次 409，拒绝覆盖保持旧档，确认覆盖后仅新档可见 |
| FLOW-002 | P0 | Resolved | 项目一四名 NPC 已从初始状态、人物 API 和旧档兼容层全部直显，发现弹窗与关键词解锁写入已移除 | `test-game-state`、TypeScript、ESLint 通过；私人关注点和内部态度仍保持隐藏 |
| FLOW-003 | P1 | Resolved | 公开信息已改为每次付费搜索全部资料、关闭后不常驻且允许重复搜索 | 每次扣 2 行动点，结果不写联系人卡片，旧档公开资料归一化时清空；事件已移除 `timeMinutes`。专项状态测试及托管数据库刷新/重复搜索 E2E 通过（2026-08-20） |
| FLOW-004 | P1 | Resolved | 新建准备已统一为一个“拜访前准备”自由文本，并确定性提取目标人物、客户问题、方案/维度、证据和下一步 | 语义覆盖不足时拒绝生成可用准备；旧材料/礼品仅保留读取兼容，不进入新附件、邀约、拜访或跟进交互。专项状态测试与真实单机 E2E 通过（2026-08-20） |
| FLOW-005 | P0 | Resolved | 已恢复微信申请，电话加入未接概率，邀约与普通邮件正文均可附游戏内准备，邀约接受后本阶段直接拜访 | 微信申请统一由 `request_wechat` 服务端命令判定并单次扣点，聊天流旧 `request_online` AI 写入路径已移除；邮件附件由服务端校验归属、状态和礼品边界。五阶段专项测试、TypeScript、全量 ESLint 与生产构建通过（2026-08-20） |
| FLOW-006 | P1 | Resolved | “给老板看”流程中的每日收口、会谈收口、纪要修订、第五日提交检查和结果回放缺口已补齐 | 结束当日前显示未完成事项；未赴约产生态度后果；第五日进入提交检查而非自动结算；纪要保留原始版及修订次数 |
| UX-006 | P1 | Resolved | 联系人卡片的“邀约见面/拜访准备”与主沟通区独立邀约入口重复暴露能力，与自然语言沟通中的邀约意图重复 | 独立“邀约见面/拜访准备”入口及不可达表单已删除；服务端在普通电话、邮件和微信消息进入 AI 前确定性识别明确邀约，并复用唯一 `invite` 状态机原子扣点、持久化话术与 NPC 回复。意图正反例、五阶段状态、TypeScript、全量 ESLint、生产构建和真实单人 E2E 通过（2026-08-20；实现提交 `149af4d`、`45a335d`） |
| OBS-001 | P1 | Resolved | 项目一关键流程观察事件与指标口径已补齐 | 覆盖新建/覆盖/继续、公开信息、邀约与条件、材料准备/使用、会面进出、阶段推进、主动提交警告和到期结算；真实 E2E 验证事件齐全。分析字段只存状态、计数和有限错误码，不复制邀约正文、材料说明、会谈纪要或隐藏 NPC 分数 |
| UX-004 | P1 | In Progress | 第一批已统一深蓝顶栏、真实导航、唯一存档入口和游戏三栏工作台；旧游戏可达页面已清理不可达竞品弹窗，结算可见文案改用阶段/行动点 | 后续继续统一首页/项目地图/复盘页，补响应式与真实数据空态，并完成浏览器多尺寸验收 |

## 已知延期

| ID | 优先级 | 状态 | 问题 | 重新进入条件 |
|---|---|---|---|---|
| GAME-004 | P1 | In Progress | 项目一已实现竞品按日动作、针对关键人的压力、玩家行动对冲、过程模糊态势和结算最终对比 | 项目一范围通过状态机与生产构建；项目二至四的事件与竞品动态仍未实现 |
| CONTENT-002 | P1 | Deferred | 完整关卡事件表命名体系未映射 | 项目一稳定 ID 完成后 |
| CONTENT-003 | P2 | Deferred | 素材用途、版本、版权未整理 | 功能闭环后建立资产目录 |
| CONTENT-004 | P1 | Deferred | 下一版五人人物主档内容尚未最终冻结 | 收到修订后的人物主档或开始五人迁移时，确认稳定人物 ID、姓名/职务及可披露字段；其他工作表本批不纳入 |
| ADMIN-001 | P1 | Deferred | 企业报告和邀请码 API 缺失 | 项目一闭环后进入后台阶段 |
| ADMIN-002 | P1 | Deferred | 设计师 CRUD 与权限不完整 | 数据模型稳定后 |
| ADMIN-003 | P1 | Deferred | 教练发起、近实时观察、点评、历史不完整；现有 WebSocket 只是预留 | 当前只有状态/事件持久化，不得宣称管理员或教练已可实时查看；进入后台专项后实现 |
| AUTH-001 | P1 | Deferred | 登录、验证码、Token 为演示实现 | 正式上线阶段；当前不可视为安全。严重性已升级：见本期 AUTH-002（无凭证自封任意角色 + 无签名 token） |
| MULTI-001 | P0 | Resolved | 房间、公司席位、联机独立对局、全员确认、移除玩家、阶段推进和完成提交已接入托管数据库 | 远端迁移已应用；双账号 multiplayer E2E 已验证建房、占席、开局、确认、并发推进、恢复、移除玩家、完成提交与测试数据清理（2026-08-20） |
| MULTI-002 | P1 | In Progress | 管理员可代确认或移出玩家，但断线检测、实时广播和客户端自动同步未完成 | 增加心跳/轮询或实时订阅；当前玩家阶段推进后需手动刷新，不得宣称实时联机完成 |
| MULTI-003 | P0 | Resolved | 迁移已实现单事务锁房间、席位和各公司 runtime，统一推进阶段/补点、计算隐藏进度并更新共享客户状态 | `20260819000200_five_stage_multiplayer.sql` 已应用且 migration list 对齐；远程 `db lint` 为 0 error；纯函数、行动点封顶、版本回放/冲突及双账号并发 E2E 通过（2026-08-20） |
| MULTI-004 | P1 | Resolved | 教练页已适配真实房间/公司席位与版本字段 | 建房、开始/结束、代确认、移除玩家均携带权威版本/阶段参数并检查失败；移除旧 groups/players 占位接口与假实时数据，`/room` 在实时能力未完成前诚实禁用（2026-09-07） |
| AI-019 | P0 | Resolved | 单机 ABC 使用受约束 AI 每阶段推演 | 2026-09-21 已接入结构化模型协议、规则校验、确定性失败兜底和阶段缓存；最终影响仍由代码 Resolver 计算，隐藏动作只进内部事件载荷。命令层只允许一次状态提交；极端多进程租约失效下外部模型调用去重仍随 STATE-002 继续加固 |
| DATA-001 | P1 | In Progress | 已增加竞品主张账本和设计师竞品配置 | 2026-09-21 复用 `scenario_templates.competitors`，补 revision、编辑人/时间、真实 CRUD、权限与冲突刷新；补未核实竞品谎言不改真实状态的确定性测试。仍需正式跨 NPC 交叉核实状态机和数据库 E2E |
| TEST-002 | P0 | Resolved | 五阶段状态、AI Provider、指标、TypeScript、全量 Lint、生产构建、single-save、项目一真实单机及双账号 multiplayer E2E 均通过 | 2026-08-20：远端多人迁移已应用，migration list 对齐，远程 `db lint` 为 0 error；联机建房、占席、开局、确认、并发推进、恢复和完成提交均有真实 E2E 证据 |
| UX-005 | P1 | In Progress | 玩家可达界面已移除不可达竞品弹窗并统一阶段/行动点文案，旧字段继续兼容 | 2026-09-21 已删旧页面死代码，但 `round/minute/duration` 等字段和时间工具需等旧存档迁移窗口结束后再删，避免破坏已完成存档兼容 |
| OPS-001 | P2 | Deferred | 日志、监控、AI 失败与成本统计缺失 | 部署准备阶段 |
| OPS-002 | P2 | Deferred | RLS、备份、敏感数据、发布检查不完整 | 正式上线阶段 |
| TEST-001 | P1 | Deferred | 缺少完整 API/状态机/E2E 套件 | 本期先覆盖修改模块，后续体系化扩展 |
| AI-008 | P1 | Deferred | AI 自定义场景不能保存并进入状态机 | 本期只开放项目一 |

## 已解决

| ID | 状态 | 结果与证据 | 日期 |
|---|---|---|---|
| GOV-001 | Resolved | 建立外层 harness 与 Git 基线；harness-check 通过 | 2026-08-11 |
| GOV-002 | Resolved | 治理检查允许 `.env.example`，真实 `.env*` 仍禁止 | 2026-08-11 |
| BASE-001 | Resolved | 依赖、类型、lint、构建、服务启动基线通过 | 2026-08-11 |
| BASE-002 | Resolved | 建立无密钥环境模板与本地运行说明 | 2026-08-11 |
| BASE-005 | Resolved | 标准 Node/Next server 替换旧启动器，移除 `url.parse()`/乱码路径来源 | 2026-08-11 |
| BASE-006 | Resolved | 移除 React Dev Inspector 的全局 Babel 构建依赖，拆分浏览器可用的纯评分证据校验模块，并按 pnpm 9 锁文件重建缺失 AJV 链接；TypeScript、全量 ESLint、核心回归、生产构建、一键启动与数据库健康检查通过 | 2026-09-07 |
| AI-001 | Resolved | 游戏页与聊天 API 统一请求和 SSE 契约 | 2026-08-11 |
| AI-002 | Resolved | 服务端按对局/NPC 加载画像与上下文 | 2026-08-11 |
| AI-004 | Resolved | 正文与结构化状态分离并经 Zod 校验 | 2026-08-11 |
| AI-006 | Resolved | 场景生成前后端契约、鉴权和 JSON 校验统一 | 2026-08-11 |
| GAME-005 | Resolved | 项目一采用确定性中标/落标判定 | 2026-08-11 |
| CONTENT-001 | Resolved | 项目一人物表与稳定 ID 统一 | 2026-08-11 |
| SCORE-001 | Resolved | 用户侧统一五维评分并由服务端状态驱动 | 2026-08-11 |
| ENV-001 | Resolved | 移除 Coze SDK、运行命令、环境变量与启动器依赖；改用通用 AI Provider | 2026-08-11 |
| ENV-003 | Resolved | `setup-local.ps1` 的 UTF-8 中文字符串在 Windows PowerShell 5 下解析失败；已改为纯 ASCII，并支持无 Docker 的托管流程 | 2026-08-11 |
| ENV-004 | Resolved | 环境检查原先只判断非空，不能识别错误 URL；现已校验 HTTP/HTTPS 完整 URL | 2026-08-11 |
| AI-020 | Resolved | 张建国当面拜访提示词测试已拆为 NPC Generator、Evaluator 与确定性 Resolver，并提供 DeepSeek/豆包双轨或单轨运行、逐轮完整记录、浏览器快照恢复、纯对话/完整报告导出和同源前情提要；严格契约、鉴权、限流、Provider 隔离和专项回归已通过 | 2026-08-31 |

## NPC-SILENCE-001（2026-09-15）

- 状态：Implemented / 验收部分阻塞；用户已批准实现。
- 问题：五人微信/邮件强制正文，缺少可校验沉默行为及阅读标记。
- 目标：落实 D-056，验证原子性、幂等、附件和记忆边界及前端恢复。
- 最后检查：2026-09-15；服务端/前端专项、测试调节、TypeScript、生产构建、harness 和本地浏览器 mock 验收通过。真实60轮矩阵因网络失败未完成；自动审批要求用户明确授权 api.deepseek.com 目的地，下一步按该授权重跑 test:npc-silence-live。

## 2026-10-08 公开首页缺口

- FRONT-SELLSMART-001 | Resolved | 根路由原为 LoginPage，首次访问直接登录。用户批准公开产品首页、独立 /login 及 sellsmart 品牌。证据：projects/src/app/page.tsx、projects/src/app/login/page.tsx、projects/public/brand/。待最终类型、lint、构建和浏览器验证。最后检查：2026-10-08。


### 2026-10-08 sellsmart 首页最终验收

- 本地实现与验收完成：`/` 为无需身份的首页，`/login` 为原登录，`/home` 保持玩家工作台。首页 SVG 品牌、模型生成插画和独立 CSS 已落盘；全局页面标题/图标同步 sellsmart。
- 主线程复核实际 diff；原登录 sendCode / handleLogin / enterWorkbench 的处理代码与 HEAD 原根路由逐字比较一致。
- 主线程验证：pnpm 9 TypeScript、全量 ESLint、最终 Next.js 静态页及 tsup 服务端构建通过。桌面 1440 与手机 390 视觉检查，图片加载、手机菜单、流程锚点、首页 → 登录 → 玩家身份 → /home → 退出回首页均通过。手机五阶段改为完整两列展示，页面无横向溢出。
- 证据：`harness/evidence/sellsmart-home-2026-10-08/desktop.jpg`、`mobile.jpg`、`hero.jpg`。FRONT-SELLSMART-001 状态为 Resolved（仅本地实现）；未发布到线上。本批未改数据库或实际训练规则，远程数据未实查，不声称对局/复盘新增完成。

- FRONT-SELLSMART-002 | Resolved | 用户反馈产品介绍首页过复杂，批准保留 /about 并改 / 为单屏游戏入口；检查日期2026-10-08。待视觉与导航验收。

### 2026-10-08 简洁游戏入口最终验收（本地完成）

- FRONT-SELLSMART-002：Resolved。`projects/src/app/page.tsx` 改为单屏游戏标题界面，`entry.module.css` 独立样式；`about/page.tsx` 保留原产品介绍，仅改导入路径及标题，主线程归一化逐字比较通过。原 CSS、品牌、生成插画均保留。
- 服务端验证 `weixun_session` 后选择入口；访客 `/login`，有效玩家 `/start`，其他有效角色对应原工作台。认证 API、游戏状态与数据库未改。
- 主线程最终验证：目标 ESLint、Next.js 生产构建（包含 TypeScript）和 tsup 构建通过；1440×900 与 390×844 实测均单屏无横向溢出。产品介绍链接与返回、访客开始游戏→登录、真实预置玩家登录后开始游戏→项目选择、退出回公开入口通过。
- 浏览器证据：`harness/evidence/sellsmart-entry-2026-10-08/desktop.jpg`、`mobile.jpg`。本地 3000 改用已构建生产版 `next start`，清除开发热更新缓存的暂态 CSS 缺失错误；最终导航正常。未发布线上，也未验证/调整远程数据库。

- FRONT-SELLSMART-003 | Resolved | LOGO 被用户拒绝，首页背景复用游戏场景不满足期望。用户批准新独立背景与品牌图形；2026-10-08。

### 2026-10-08 首页专用美术 v2 验收（本地完成）

- FRONT-SELLSMART-003：Resolved。首页不再引用 `game-park.webp`，分别使用 `public/images/landing/sellsmart-entry-background-v2.png` 与 `sellsmart-entry-mobile-v2.png`。两张图用内置 image_gen 生成/编辑，提示词见同目录 `ENTRY-ART.md`；原游戏资源和 /about 内容保留。
- SVG LOGO 改为深墨蓝底、清晰居中的单条象牙白 S 路径与微小琥珀端点。主线程审查两个 SVG 实际内容，修正初稿垂直偏移；首页、介绍、登录及 favicon 使用原品牌路径，统一更新。品牌说明见 public/brand/README.md。
- 最终主线程验证：目标 ESLint、Next.js TypeScript/生产构建和 tsup 通过；桌面1440×900与手机390×844均单屏无横向溢出，新背景与标志实际加载成功，手机显示专用竖版图。路由/认证逻辑未修改。本地3000已重启为最终生产版；未发布线上。
- 证据：`harness/evidence/sellsmart-art-v2-2026-10-08/desktop.jpg`、`mobile.jpg`。本批只涉及美术与首页CSS/图片展示，远程数据未实查，无数据库或AI规则调整。

- FRONT-SELLSMART-004 | Resolved | 2026-10-12 用户要求商务背景改工业竞标棋局意象；v2源图、page.tsx已检查。范围仅首页素材。
### 2026-10-12 工业竞标棋局美术 v4 验收（本地完成）

- FRONT-SELLSMART-004：Resolved。首页横版与手机版引用 sellsmart-entry-background-v4.png / sellsmart-entry-mobile-v4.png；左侧工厂剪影、棋盘地面和右侧文件已接入，封面统一为 Invitation for Bids。
- 使用内置 image_gen 生成并编辑，v2/v3 素材保留；最终提示词与素材路径见 projects/public/images/landing/ENTRY-ART-V4.md。本批仅替换首页两个图片引用，无认证、API、数据库或游戏规则修改。
- 主线程确认最终素材拼写与实际页面；目标 ESLint、Next.js TypeScript/生产构建及 tsup 通过。1440×900、390×844 均单屏无溢出，当前可见背景加载成功，手机版专用竖图正常。
- 证据：harness/evidence/sellsmart-art-v4-2026-10-12/desktop.jpg 与 mobile.jpg。本地3000已启动最终生产预览；未发布线上。

- FRONT-PLAYER-MODE-001 | In Progress | 2026-10-12 用户批准：企业员工保留双模式，个人固定单机；已确认 start/page.tsx 未读取 subRole、模式块无条件显示。下一步修改并验证。

### 2026-10-12 玩家身份与模式入口验收（本地完成）

- FRONT-PLAYER-MODE-001：Resolved。start/page.tsx 保留登录 subRole；企业员工显示原单机/联机选择，paid_individual 隐藏整块模式/房间输入；开始导航与按钮统一使用 effectivePlayMode，个人及身份未加载时固定 solo。非玩家其他角色保留原选项；未带子身份的旧玩家默认单机。
- 已完成部分：登录已写入完整身份；确认缺口：原项目入口丢弃 subRole。实际修改仅 projects/src/app/start/page.tsx；认证、游戏/API/数据库没有修改，远程数据未实查。
- 主线程实际 diff 复核；缓存 pnpm 9 ts-check、全量 lint:build、Next.js 生产构建及 tsup 均 exit 0。默认 pnpm 包装器沙箱 realpath EPERM，正常本地权限使用缓存 pnpm 9 完成检查。
- 浏览器验收：临时开发及最终 3000 生产预览通过；企业员工单机导航、联机选项/房间码/公司选择与联机导航，个人无模式选项/房间码且 solo 导航通过。使用模拟客户端身份、项目列表与联机加入响应，导航落点拦截，不创建真实对局；不宣称联机数据库或认证端到端另做实测。
- 证据：harness/evidence/player-mode-2026-10-12/check.cjs、enterprise.png、individual.png。本地 3000 已重启为最终构建，临时 3012 服务已关闭；未发布线上。

- FRONT-FORMAL-SYNC-001 | Resolved | 2026-10-12 本地正式 /game 页面/CSS与 commands/chat/state/workflow 完成实际测试页玩家流程、成本、电话、沉默、告辞和恢复同步；类型/全量lint/build/专项与最终生产桌面手机mock通过，真实存档E2E及AI计划/准备API数据库验收通过。证据 harness/evidence/formal-sync-2026-10-12/report.md；未发布，真实多轮聊天/多人广播不在本批验收范围。

- GAME-TIMER-001 | Resolved | 2026-10-12 正式/实际测试两栏、共享项目通知、20min时钟、每5min+5AP cap28、拜访暂停/每轮15sec及自动结算已完成。实现见 game/state.ts、repository.ts、game/page.tsx、project1-prototype-v9.html 与迁移20261012000100；阶段UI/设置/旧推进接口已停用。主线程复测计时/竞争者/预览回归、桌面手机浏览器、真实临时单人存档与双账号多人验收通过；证据 harness/evidence/game-timer-2026-10-12/。真实外部AI截止时间验收被自动审批拒绝，采用本地模拟专项补充，不宣称真实模型该项通过。

- TEST-SHORT-001补充（2026-10-12）：用户缩小为张建国三模型15条；计划检查通过，但auto-review再次执行前拒绝，0请求/0正文。具体目的地及拒绝记录见npc-zhang-short-replies-2026-10-12/execution-status.json，未绕过。


- TEST-SHORT-001解决（2026-10-13）：明确授权后15条真实请求完成，14正文/1空白异常；Qwen4条超参考上限，现有PROMPT-007/009/010仍需追踪。
- PROMPT-012（P2，Open，2026-10-13）：张建国直接单轮抽样中Qwen高档复述销售者输入、低开场误称角色姓名；需要加强说话角色边界并后续完整UI核验。证据approved-2026-10-13/responses.ndjson，不视为产品UI必现。

- FRONT-COMPETITOR-PROFILES-001 | In Progress | 2026-10-14 实现与本地验收完成：designer竞品七字段、只读profiles API、正式/预览简卡详情与刷新已接通，根类型/lint/build/新旧回归及桌面手机全mock浏览器通过；关联开发库最新实查2公司/revision2，ABC占位已移除。当前REST TLS ECONNRESET，真实后台保存→DB→两端读取验收待网络恢复，故保持In Progress。证据 harness/evidence/competitor-profiles-2026-10-14/，不宣称真实联调或线上部署。

- FRONT-COMPETITOR-SINGLE-CARD-001 | Resolved | 2026-10-14 用户纠正的同排单张入口/总弹窗/ABC占位剔除已落实到game/page、CSS、prototype HTML、contract/profiles API和迁移20261014000200；根类型/lint/build/新旧回归和桌面手机mock验收通过，实际DB count2/revision2/ABC_removed=true。原真实REST联调限制保持独立未解决。证据competitor-profiles-2026-10-14/。

- FRONT-COMPETITOR-LIST-001 | Resolved | 2026-10-14 两端列表→单公司详情→返回/重开已完成，后台更新/删除回列表、顶卡同排和ABC过滤保留；根类型/lint/build/新旧回归与桌面手机mock浏览器、截图复核通过。证据competitor-profiles-2026-10-14/；原真实REST联调限制独立保留。

- FRONT-COMPETITOR-FLASH-001 | Resolved | 2026-10-14 预览竞品modal稳定shell/专属无入场动画/相同body跳过更新修复完成；正式无需同类源码修改。根完整类型/lint/build/新旧回归、最终桌面手机mock节点身份/animation-name none/焦点与真实滚动保持验收通过。证据competitor-profiles-2026-10-14/；无旧版runtime baseline，不宣称真实REST或线上部署。

- PROMPT-013（P2，Resolved，本地文本与契约，2026-10-14；下述保留原缺口）：共享对话自然度约束重复且与全局/渠道的主动追问、自动下一步及高档增字要求冲突。已查customer.ts、npc-role-prompts.ts、prompt-config.ts和渠道常量；按用户分享正文改为共用规则单份注入、人物化短推脱和非机械增字；待专项/构建及精确旧默认兼容验证。PROMPT-007/009/010/012生成质量仍需真实样本复验，不由静态验证关闭。


- PROMPT-013验收：npc-dialogue-rules.ts共享规则经compose一次注入，customer/角色/渠道同步去冲突，90例同标签三档逐句不同；历史精确升级、自定义保留专项与主线程功能/类型/lint/build通过。本地API revision5确认最终规则已加载，证据npc-natural-dialogue-2026-10-14/runtime-config-check.json。仅文本/契约Resolved，真实生成改善未复测，PROMPT-007/009/010/012继续Open。

- TEST-MODEL-001（P1，Open，2026-10-14）：v5张建国直接JSON单轮抽样DeepSeek5个中4个仅空白U+0020，解析invalid_json，未重试。中/高开场及低敏感/长推销均发生，raw长度21/17/16/17；不能据此判断供应商根因或生产同现。来源npc-zhang-natural-replies-2026-10-14/v5-live/responses.ndjson，下一步独立定位输出契约与请求/响应元数据。
- PROMPT-007/009/010/012实测补充（2026-10-14）：v5全部11有效正文13-29字但不整体通过；Qwen三档错称NPC本人、敏感请托未明确拒绝，豆包低敏感未经确认承诺安排对接、低长介绍仍索要材料，语气及梯度不足。保持Open，待获准修复/回归，不静默改产品。

- TEST-MODEL-001更新（P1，In Progress，2026-10-14）：client.ts已trim校验纯空格并保留trace原始元数据，customer.ts提供独立JSON协议，专项含21空格/空串/缺content/带空白有效JSON且不盲重试，根验证通过。v6共42回归无空白，但旧4各自模型侧内部原因未证，2×2仍复现1条HTTP200/stop/13空格；保留偶发供应商空输出风险，不宣称根治。诊断报告outputs/2026-10-14-张建国四空白原因诊断报告.md。
- PROMPT-007/009/010/012更新（Open，2026-10-14）：修复身份冒号前缀、未知姓名、敏感双拒绝和无确认转介；张建国低档行为优先级最终9条10-30字、三家长篇收束/敏感双拒绝，较前33条改善。前三轮超字/虚构联系人等保留，高档与完整UI/多轮/其他四NPC未获本批覆盖，不以42条格式有效关闭全局质量问题。复验报告outputs/2026-10-14-张建国修复后复验报告.md，原始证据npc-zhang-diagnosis-2026-10-14/v6-regression/。

- DESIGNER-EXCEL-IMPORT-001（P2，Open/按用户要求暂缓，2026-10-15）：用户Excel经设计师POST /api/designer/prompt-excel实测HTTP400 INVALID_XLSX；Zip/XML和独立openpyxl只读均可提取35条文本。仅记录事实，不确定根因、不修导入入口。本批已通过现有PUT配置CAS将35项原文同步revision7→8并GET逐项一致，非表内系统/门槛不变；证据npc-excel-sync-2026-10-15/。

- PROMPT-007/009/010/012更新（Open，2026-10-15）：Excel版已原文同步revision8。豆包/Qwen10条有效正文，均符合本Excel参考上限，但豆包中高档使用你且引导感、Qwen口头语过密仍需观察；未改写用户版。DeepSeek未取得正文，已按用户最新指示暂缓，不能声称三模型全部通过。证据npc-excel-sync-2026-10-15/two-model-results.json。

- DESIGNER-EXCEL-IMPORT-001更新（In Progress，2026-10-16）：用户已要求修复，原文件解析兼容调查中；代码实查另发现prompt-library预览仍把role_base/role_low/role_medium/role_high当渠道取空ID导致渲染失败。已有解析/草稿应用/保存功能保留，补精确兼容与新scope预览，验收原文件35项端到端。


- DESIGNER-EXCEL-IMPORT-001更新（P2，Resolved/本地验收，2026-10-16）：prompt-excel.ts修复SpreadsheetML合法前缀兼容，人物行多余渠道20条以ROLE_CHANNEL_IGNORED明确告警忽略；prompt-library/page.tsx修复新role scope预览崩溃、表外渠道保留及导入保存互斥。原件35项逐字一致，根独立浏览器61项通过（解析真实、配置保存隔离内存）；另真实接口相同内容PUT/GET revision8→9/persisted=true，完整配置不变。最终原件/边界专项、配置编辑范围、类型/lint/build通过，本地PID10824已更新。证据designer-excel-import-2026-10-16/final-result.json、real-save-audit.json、root-validation.json；原件未改，未远程部署，模型问题不纳入。
2026-10-16新版r10实测更新：张建国三家各5，15/15首轮有效/HTTP200/stop、0重试空白。TEST-MODEL-001仍In Progress：当前/models不列配置旧alias，本批临时deepseek-flash成功，未作严格同时间A/B，不认定旧超时内部原因根治。PROMPT-007/009/010/012继续Open：豆包/Qwen低档仍请讲重点、豆包高档你挑、DS低开场46字/豆包低敏感41字略超本版40参考、Qwen断言评审标准公开透明无事实依据。证据npc-zhang-latest-2026-10-16/与完整报告/PDF；仅测试，不改提示词或配置。

- TEST-MODEL-001更新（P1，In Progress，2026-10-16步骤①②）：当前r10表格测试初批DeepSeek多轮T028连续3次HTTP200/stop仅16/18/21空格，T029未发送，保留initial-run原始body。统一三家多轮续接前次API原JSON消息复测9次均有效；最终39原单轮+9复测多轮共48正文，全程58attempt。仅格式一致性复测，不能证明唯一根因或供应商偶发空白已根治。根独立审计见npc-zhang-plan-steps12-2026-10-16/root-independent-audit.json。
- PROMPT-007/009/010/012更新（Open，2026-10-16步骤①②）：低档多轮简短并明确拒绝保证入围，但低档部分单轮仍邀请推销，高档和敏感场景仍有未给事实、语气及输入点数偏移。只做当前提示词测试，不擅自修改用户导入版；其他NPC和游戏UI流程未覆盖。

- 2026-10-16步骤①②交付验证：7页PDF48完整输入/正文逐provider/case映射通过，全部页面渲染检查通过；结束GET完整config仍revision10未变。TEST-MODEL-001保持In Progress、PROMPT-007/009/010/012保持Open，交付完成不等于质量问题已修复。证据npc-zhang-plan-steps12-2026-10-16/report/root-pdf-audit.json及latest-readback-audit.json。

## 2026-10-16 全流程审查补充（诊断，不扩大实施范围）

- AUDIT-HISTORY-001 | P1 | Open | “历史与复盘”导航去ranking，缺个人已完成报告列表与重开入口 | app-shell.tsx:39-43、ranking/page.tsx、repository.ts:261-270只查playing。结果页/打印已经实现，不重复建设。下一步补个人报告列表→已有result；最后检查2026-10-16。
- AUDIT-DESIGNER-001 | P1 | Open | 部分设计师资料/指标/公式编辑未形成保存→正式生效闭环 | key-persons/page.tsx:100-122/310-313为本地草稿，client-info/page.tsx:44-109/281-287仅state，metrics/page.tsx:118和formulas/page.tsx:63保存按钮无handler。提示词专用Excel/配置、图像、竞品保存已有实现。关联ADMIN-002；下一步按数据领域接通或明确草稿标识；最后检查2026-10-16。
- AUDIT-RANK-FILTER-001 | P2 | Open | 平台排行榜筛选参数未应用 | ranking/page.tsx发送range/track；api/ranking/route.ts:270-310只按best_score排序分页。下一步落实过滤语义或收起无效选项；最后检查2026-10-16。
- AUDIT-ENTRY-ESTIMATE-001 | P2 | Open | 静态项目值显示为AI战前预估 | start/page.tsx:27-90/299-312固定利润率/胜率，未按当前用户/对局计算。下一步标场景示例或接入有依据计算；最后检查2026-10-16。
- AUDIT-RECOVERY-001 | P1 | Open | 计时同步/复盘失败反馈不完整 | game/page.tsx:950-975同步失败沿用投影且静默重试，result/page.tsx:341-349/526-528复盘失败用规则文案无独立提示/重试。已有幂等/存档和其他错误处理保留；下一步统一状态与恢复反馈；最后检查2026-10-16。
- AUDIT-KNOWLEDGE-001 | P2 | Open | 知识库孤立样例页 | knowledge/page.tsx:22-28/65-90/151-176为硬编码样例、上传alert、查看删除无handler，主导航无入口。非当前项目一阻断；下一步明确保留范围再接资料存储/检索；最后检查2026-10-16。
- AUDIT-DOC-001 | P2 | Open | 当前架构资料仍含旧五阶段/四人事实 | context/PROJECT_CONTEXT.md、CURRENT_ARCHITECTURE.md与正式五人/20分钟代码不一致；STATE历史与最新记录并存。下一步更新当前摘要并保留历史日期，不据旧资料重建已完成能力；最后检查2026-10-16。

认证沿用AUTH-001（签名会话已有，不表示真实身份已完成），企业沿用ADMIN-001/BASE-003，教练/联机沿用ADMIN-003/MULTI-002，自定义场景沿用AI-008；NPC质量沿用PROMPT和TEST问题，本批不关闭。新手指引与个人成长路径为待批准的产品建议。完整证据/边界见outputs/2026-10-16-项目结构与用户全流程完整性检查.md。外部当前状态本批未实查。

2026-10-16结构审查最终验证：主线程复核两Worker实际源码证据，报告已保存；三组纯本地回归与TypeScript通过，harness-check和git diff --check通过。全量ESLint长时间未返回，主动中止，未记通过；本批只新增诊断报告/台账，无产品实现修改，不运行build。当前远程配置/数据库/对象存储/生产部署与完整登录态E2E未实查。新增问题与既有AUTH/ADMIN/MULTI/AI/OPS边界已双向核对，未将旧台账的四人五阶段当当前事实。


## ACTIVITY-001 — 对话约定活动后的限时文字策划
- 状态：In Progress
- 最后检查：2026-10-20
- 来源：本聊天用户明确批准，完整约束见CURRENT_ITERATION同日条目。
- 当前证据：正式与五人预览已有权威会话和评价，但缺少客户约定活动检测、300秒持久化策划及幂等指标结算。
- 下一步：按四模块分工完成实现，主线程独立复核并运行专项、类型、lint、build、harness；远程/生产未实查。

ACTIVITY-001 2026-10-20范围更新：销售提议不要求客户明示同意，结束时冻结状态并按AI/设计师数值模式判定；新增后台模式切换/门槛设置与CAS持久化。仍为In Progress，最终验收以本日追加规则为准。

## ACTIVITY-002 — 多活动可行性批次部分成功的重试一致性
- 状态：In Progress
- 最后检查：2026-10-20
- 证据：独立高风险review确认repository.ts processPendingCustomerActivityDetections在A正常reject/need_more、B provider失败时丢弃内存resolutions；CAS冲突也可能重新调用已成功判断。
- 下一步：已成功decision逐项原子checkpoint，失败保留queue，CAS重试复用本次已获判断；补A拒绝/B失败后二次A将允许的防复活测试。
- 影响：可能重抽旧提议导致不一致；未部署本批代码。

### ACTIVITY-001 — 2026-10-20 Resolved（本地实现）
正式与预览、后台AI/数值切换及三类门槛、销售模糊回应、结束时快照、300秒文字策划、自动提交/现有指标幂等结算已完成。主线程专项/回归、类型、lint、build及mock API浏览器检查通过；SQL最小fixture执行验证通过。证据：harness/evidence/customer-activities-2026-10-20/VERIFICATION.md。远程迁移与真实AI对局仍为部署验证事项，不计作已上线。

### ACTIVITY-002 — 2026-10-20 Resolved
processPendingCustomerActivityDetections逐项保存成功判断，失败保留待处理队列；同轮CAS冲突复用候选/判断，队首切换不应用旧memo。直接调用实际处理函数的A拒绝/B失败后仅重试B、CAS不重复决策、队列切换回归通过；独立高风险Review复核未发现新增P1/P2，主线程再次通过正式专项与最终检查。

## ACTIVITY-003 — 客户活动转介、重复展示与点评不符新规则
- 状态：In Progress
- 来源：2026-10-21用户四点反馈。
- 证据：customer-activity-reply.ts允许高层建议找项目同事；两条planner同时显示summary与basis；公开投影直接返回存储overallEvaluation，真实快测显示长建议。
- 下一步：按本日已批准条目修复并核查快测权威指标；内部结算不变。

### ACTIVITY-003 — 2026-10-21 Resolved（本地实现）
转介识别/重写覆盖正式与预览（customer-activity-reply.ts、project-one-preview-ai.ts）；公共toPublicCustomerActivityTask只投影简短结果，旧点评不下发；正式planner及预览HTML去重并按状态展示。内部指标及结算未变。主线程相关专项、类型、全量lint与生产build通过；快测权威数据已只读核查并记录脱敏证据。完整证据/本批边界见harness/evidence/customer-activities-2026-10-21/VERIFICATION.md，远程部署未执行。

## SEC-TEST-001 — 测试子任务误将Jev密钥输出到工具日志
- 状态：Open
- 最后检查：2026-10-21
- 来源：metric-matrix子任务自报初次rg配置搜索包含.env.local，JEV_API_KEY值进入该子任务工具结果。
- 处理：已要求禁止打印环境文件，后续dotenv加载并只输出白名单provider名称/存在性；密钥不抄录到证据。用户已告知，凭证尚未轮换，待用户在供应商后台轮换；不得无授权自动修改凭证。
- 边界：未发现写入Git/报告；工具日志披露不等于证明外部滥用。

## ACTIVITY-004 — AI活动可行性对关系指标区分不足
- 状态：Open
- 最后检查：2026-10-21
- 证据：用户授权真实Jev测试，三活动×六状态18/18返回allow，包括支持0/愉悦10；模型jev-1.13.0。请求snapshot与输入、原始答案与业务结果经主线程逐条审计一致。证据customer-activities-2026-10-21/metric-matrix/。
- 边界：固定虚构高层/采购评估背景，每单元一次判断；不代表所有角色/上下文都必然放行，也不证明单一根因。
- 下一步：用户确认更明确的AI拒绝/放行标准后再修提示或策略、重跑矩阵。当前不擅改数值门槛/后台provider。

## ACTIVITY-005 — 现有LLM决策输出示例与严格契约不一致
- 状态：Open
- 最后检查：2026-10-21
- 证据：llm-decision.ts buildDecisionMessages将response外层及choice/score/noul混为示例，而normalizeAnswers要求根answers及按题型独立type/choice字段。实测18格均产出不符格式，业务统一provider_unavailable；测试端追加准确JSON说明后18格全部通过校验。
- 下一步：批准修正通用LLM输出格式提示后，补choice/score/noul混合题型及真实模型验证；保持严格解析，不用宽松接受任意JSON掩盖问题。
- 边界：本批仅测试端补充格式，未修产品，不宣称LLM分支全局可用；ACTIVITY-004指标区分不足仍存在。

## ACTIVITY-006 — 数值匹配仅看目标NPC，需整体组合门槛
- 状态：In Progress
- 来源：2026-10-21用户授权设置整体组合数值门槛。
- 证据：customer-activities.ts原threshold与snapshot仅单人，AI numeric只比较目标支持/愉悦；正式/预览快照未附五人组织状态，后台每类仅两项数字。
- 目标：全五冻结、组合OR/AND、至少两名实际达标、客户主动亦不豁免、新numeric保存必须whole规则，保持历史读取/计时/幂等/隐藏指标。
- 下一步：按本日approved设计实现并验证，最后真实保存numeric配置与权威readback。

### ACTIVITY-006 — 2026-10-21 Resolved（本地代码+真实后台配置）
领域/AI numeric gate、正式state与预览服务完成全五冻结和多路径判定；新配置API/仓储/后台编辑完成组织规则，禁止单人numeric新写；matching专用loader阻断旧单人numeric用于新对话，历史冻结队列不变。客户主动不豁免、目标对象不影响判断，公共投影隐藏内部数值。独立review P2已修复复核。主线程相关专项/类型/全量lint/build通过；真实设计师页面保存numeric rev3且数据库readback一致，实际保存配置240条场景断言通过。证据organization-thresholds/VERIFICATION.md、config-readback.json、saved-config-scenarios.json与截图。远程代码部署及新真实模型完整对局未验证，首版难度待实战调校。

ACTIVITY-004 2026-10-21补充：AI区分不足本身仍未修改；当前活动配置已切为整体numeric v3，日常新匹配由数值门槛控制，不继续依赖AI开展判断。保留Open以追踪可选AI模式质量，不将切换数值当AI已修好。
