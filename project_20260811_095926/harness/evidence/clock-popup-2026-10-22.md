# 弹窗后倒计时归零

ACTIVITY-TIMER-011，2026-10-22，当前五人预览本地修复完成。

只读Chrome5/tab1062401269当前项目倒计时00:00。只读DB session862a9e9d...v29有两技术交流任务，均空稿手动提交，分别北京时间14:40:04、14:58:27提交，当前无请求lease；记录见同名json。前端timer存本地，本次未读取隐藏浏览器状态，因此不能据DB推断用户曾设定的剩余时间。已异步询问是否通过测试调节改时间、归零发生在哪个弹窗之后。

代码已证缺口：applyTestControls整体重建freshTimer，丢customerActivityTaskId/Phase；reconcile最新started任务在submitted且marker不匹配时重设lastResumedAt到旧submittedAt，再syncCountdown。旧任务会覆盖较新的计时检查点，可能补扣已经算过的墙钟时间。空方案评价delta应用本身没有扣AP或游戏时间。

范围限定：修确认的历史活动回放/测试调时标记丢失，保留真正离线越过deadline应产生的正常计时，不重置用户预算，不擅自改变pending/结果弹窗暂停规则或正式计时。

## 用户补充后的范围修订

用户明确未改剩余时间、不确定归零时点，仅在提交后注意到；后要求继续。测试调时路径已独立复现并修，但不能据此解释用户实际操作。历史Chrome已有第一任务pending时00:00记录（repeat-visit证据），其创建14:01、开始14:39，中间超过项目20分钟预算；当前只planning5min暂停，其他阻塞活动弹窗继续计时。

基于活动不扣游戏时间及用户继续授权，当前预览扩为完整活动UI暂停：pending/planning/submitted评估等待/未读结果，最后确认才恢复now。五分钟服务器deadline照常自动提交；离线未读仍冻结，不再从deadline补扣结果等待。已读历史正常计时；拜访暂停独立；已expired/settled不复活。不改正式多人服务端timer，不重置用户已归零预算。

## 最终实现与检查

HTML持久化customerActivityUiTaskId及ui_paused phase，normalize保留；boot先loadSeen/reconcile再GET/render，恢复未读活动不会先补扣整段离线时间。受限syncCountdown(anchor,true)只用于可信活动创建锚点，取已结算checkpoint和createdAt较晚值并cap now；普通recovery gate继续保护sync(now)。continue标记seen后若有下一任务不恢复，最后结果确认才以当前时间恢复。拜访每轮15秒先扣，再保留活动UI暂停；已expired/settled不复活。测试调节保留活动标记，历史已读不再回放旧提交时间。

主线程实际diff复核，独立sol read-only Review发现并确认修正三边界：不能因活动UI暂停豁免拜访轮次；恢复合法创建前耗时不能被recovery guard漏扣；future anchor不得提前消费预算。最终无剩余P1/P2。

五项明确通过：test-preview-countdown、test-preview-recovery-ui、test-preview-test-controls、test-preview-account-isolation、test-preview-customer-activities。覆盖pending>20min、planning五分钟、评估和结果>20min、最终确认后10秒只扣10秒、多任务无缝暂停、离线首次恢复与刷新未读、已读历史、未来时间、拜访轮次+暂停、expired/settled。test-controls原静态断言精确匹配旧syncCountdown签名，根适配允许新增参数后该专项通过；未改实际功能以迎合旧断言。最终tsc、两个worker测试文件ESLint --quiet、production build通过。

当前5001静态HTML HTTP200，含customerActivityUiTaskId及saveSeen后reconcile确认恢复；本批无后端源码改动，未重启服务、未操作真实玩家、未加时或重置，也未做真实外部AI/新对局E2E。用户需刷新加载新前端。正式多人服务端仍按提交/截止恢复，未纳入此次预览修复，记录ACTIVITY-TIMER-012后续方案。
