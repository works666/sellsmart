# 重复拜访显示旧对话

2026-10-22，PREVIEW-VISIT-003，本地修复完成。

用户before.png截图显示“第1轮/完成0项”，却显示上一轮张建国告辞和玩家提议。实际入口renderMeeting读取该NPC所有meeting历史末条；startVisitSimulation重新创建meeting但没隔离历史。服务端已有customerActivityStartIndex，当次活动检测也依赖它；meetingResponse/GET recovery没有带展示边界。

只读readback-before.json最新session862a9e9d...v10时已turn1/ended=true/endReason=npc_time_constraint，起点2；说明截图之后用户继续操作，不声称实查时仍turn0。当前Chrome5/tab1062401269是5001/project-one-preview，已回工作台且有技术交流活动pending策划弹窗，根未发送玩家消息、未开启新拜访或策划。

目标：保留全历史，以服务端本次拜访边界导出显示消息ID，隔离本次展示；新拜访清旧草稿，实时生成/重试仍显示本次内容；刷新恢复不会复现旧告辞；兼容截断恢复历史。不更改模型结束判断、活动匹配或扣时。

## 实现与验证

server meetingResponse/toPreviewRecoveryDto用既有customerActivityStartIndex切片并筛visit，输出historyMessageIds，无新增持久化字段；contracts增加可选字段。HTML start初始化当前IDs/清draft，renderMeeting过滤，optimistic消息加入本地ID，GET恢复使用服务端ID。pendingMeetingDraftForRecovery的失败消息回退也按本次范围过滤。旧记录完整保留，缺可靠起点的旧存档沿既有迁移策略避免误引用前场消息。

根实际审阅本批HTML/server/contracts diff及专项。七项明确通过：test-preview-recovery-ui、test-project-one-preview-ai、test-preview-countdown、test-preview-stream-protocol、test-preview-account-isolation、test-preview-test-controls、test-preview-customer-activities。包含连续两次拜访、新turn0开场、保留历史但不显示旧双方台词/旧failed草稿、本场实时回复可见、150条跨渠道历史与100条截断恢复、重复恢复不重复扣时。最终tsc --noEmit、四文件ESLint --quiet、corepack pnpm build（Next+tsup）均通过。前端VM保留15s watchdog，不以未settled提前退出视为通过。

## 服务更新与实际页面范围

只读更新前最新session862a9e9d...v12仍turn1/endedtrue，无lease。核实5001 PID22460命令node dist/server.js后更新为exec1642，production监听5001。HTTP静态HTML200且含新visitMessages过滤；startup health app=weixun-project/database=ok/buildId=c_2mkh65wvo9qp3JGIoXm，与当前.next/BUILD_ID一致。5000旧服务未动。

Chrome仅查看当前页，未刷新/发送/结束/开启新拜访/开启策划/重置。最后只读页面已自然倒计时到结算，仍有活动pending弹窗；不以此当作本次显示修复E2E。未进行真实外部AI两场浏览器测试，连续拜访结论来自确定性mock专项。用户下次刷新加载新前端，原记录不清除。
