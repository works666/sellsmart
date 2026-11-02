# EVAL-002 正常提前结束修复 · 2026-10-27

用户截图显示未评分。只读当前Chrome 5000页面并下载其现有JSON（未运行新评测），报告d64b6af4-4d1c-49d5-a35a-be6ccbb661c4：round1前meeting.ended=false，后ended=true/endReason=npc_time_constraint；round2前已ended，仍调用visit_turn并收到NO_ACTIVE_VISIT_FOR_NPC，phase partial、judge请求0。NPC首轮实际成功，错误是评测流程没有识别正常结束。完整报告仅保留用户Downloads，不纳入Git。

修复：成功visit_turn记录后检查同NPC权威meeting.ended，正常结束即停止剩余计划输入，继续对完成真实对话评分。新增termination reason/completedTurns/plannedTurns/skippedTurns；页面中文显示，即使后续judge失败也保留正常结束事实。没有改会面判定、提示词、原会话或自动重开拜访。

根实际复核四个修改文件。根独立运行：test-system-evaluation（真实预览service+模拟模型，覆盖首轮结束1/3且judge调用/源不变、未结束3轮、网络partial、零回复失败不误标正常）、test-system-evaluation-judge（真实SDK）、test-project-one-preview-ai、tsc、四文件ESLint --quiet、corepack pnpm build，全部通过。diff-check通过。

核实旧5000 PID11312的Node命令、项目health及旧build匹配后只更新本应用。新5000 exec11530及5010 exec93027运行build T7r-Us29GPjNuVBAnX6R3；实际5000页面HTTP200、health DB ok/build与磁盘一致。没有刷新原浏览器页，也没有调用真实付费AI重新评测；用户旧报告不会自动变成修后结果。
