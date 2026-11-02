# 张建国拜访主动告辞排查

2026-10-22，用户报告第一轮拜访回复后点击“主动告辞”，界面显示AI服务不可用。

已实查：

- HTML endVisit实际发送visit_turn固定文本“谢谢您的时间，今天先到这里，再见。”，不是直接调用end_visit。
- 权威DB session701f74b4-dd93-4eec-9325-83fd9fd6a6f1 v2仅保存首轮提议与张回复；activeMeeting turn1、ended=false，无awaitingFinalReplyFrom，表明告辞请求未成功提交。before.json保存。
- 原失败未保存具体模型/后端错误，命令表仅成功start/turn，不能认定服务宕机、模型格式错误或状态提交错误中的哪一种。
- 第一次隔离重放被自动审批拒绝外传已存拜访对话。用户随后明确回答“是”，允许将这次对话与角色上下文发送当前配置的外部AI，并在本地保存诊断。授权后真实隔离重放成功：NPC“好，今天谢谢您来，先这样。”，meetingEnded=true/player_farewell/turn2；调用阶段visit_narrative→semantic_review→memory suggestions→activity detection。isolated-replay.json保存。原数据库会话未写入。
- 本地mock短告别“再见。”可通过schema并结束；注入记忆摘要生成provider失败可模拟503且克隆状态回滚。这仅证明可能失败路径，不证明用户旧请求具体根因。
- 固定告别中的“时间”使此前活动话题上下文进入额外语义复核，本次allowed；不作为原失败根因。

确认排障缺口：frontend对502和503统一覆盖为AI服务不可用，后端known错误日志只有status。当前仅完善安全错误分类与前端协议错误保真，不改变结束拜访/计分/门槛/Provider。

验证完成：新增preview-error-diagnostics helper只日志固定code/kind和受限action/npcId/commandId，协议异常不含后缀原文、未知仅PREVIEW_UNEXPECTED_ERROR。route普通/SSE接入，前端502保留安全协议文案、503仍generic。主线程实查实际实现，3专项（test-preview-error-diagnostics、test-preview-session-errors、test-project-one-preview-ai）、最终tsc --noEmit、定向ESLint --quiet、Next+tsup production build通过。worker最后按kind分组code白名单后，根再次检查、专项及lint通过，build包含最终内容。

重启前只读DB证实原session仍v2/turn1/lease=null，pre-diagnostic-update.json保存；用户原拜访没有写入。旧本地5000 PID32532核实dist\\server.js后更新为production exec2591，静态页HTTP200及新502映射已实际确认。未对原用户拜访点击重试，未远程部署。

原偶发失败VISIT-FAREWELL-001保持未定位/Open；不能将错误展示改进冒称已修原失败。没有失败原始trace，当前安全日志也没有发生新真实失败，不声称已用真实失败验证新增code；相应校验为注入专项。后续若复发按code/action/npc/commandId及时间查。
