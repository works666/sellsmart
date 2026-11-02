# 应用测试值后倒计时停止

2026-10-21：实际 `public/project1-prototype-v9.html` 的 applyTestControls 重建timer，freshTimer默认started=false；syncCountdown遇false不累计时间。测试值/NPC请求仍可提交，不能将此解释为整个页面或活动后端停止执行。

范围：补 `started:true`；不改变NPC值、活动识别、数值门槛或服务端会话。test-preview-countdown.ts 在VM内运行真实HTML函数，覆盖调值后运行、归一化后继续运行、拜访中保持暂停和结束后恢复。旧代码10秒后仍600秒失败，修复后降为590秒通过。

已通过：专项、ts-check、修改测试文件ESLint、diff-check。HTTP读取当前5000服务，status200、fixServed=true。全量ESLint长时间无输出，主动中止，不记通过。HTML直接由public提供且当前服务已读取新内容，无Next打包依赖，本轮未执行生产重建/重启，避免影响用户测试；不声称新的生产build通过。未实际操作用户浏览器。

已有页面仍持有旧脚本/旧started=false；应刷新后，在测试调节确认所需剩余秒数再应用。旧计时状态normalize会把未开始时间归零，因此不要声称仅刷新自动恢复原剩余值。没有修改用户localStorage或数据库。

ACTIVITY-007未修复：用户真实电话命令在调值后已成功挂断和同步，却没有candidate/decision/task；本次计时修复不会自动生成此前漏掉的活动。
