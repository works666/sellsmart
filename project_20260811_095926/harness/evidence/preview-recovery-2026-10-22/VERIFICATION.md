# 预览拜访恢复排查

2026-10-22，PREVIEW-RECOVERY-002，本地修复与实际页面验收完成。

真实Chrome用户页重新进入实际测试，沉浸式张建国拜访显示“本轮回应失败，请重试。”，发送/主动告辞按钮暂禁用，底部提示“预览会话已在其他操作中更新，请刷新预览会话后重试。”，没有恢复按钮（before.png）。server exec2591连续记录customer_activity_sync 409 PREVIEW_SESSION_VERSION_CONFLICT。只读DB原session701f74b4...v3仍meeting turn1；没有重置用户存档。

实际代码restorePreviewSession仅读本地id/version，refreshPreview清运行态并reload，沉浸式render不带普通反馈按钮。已有鉴权GET recovery DTO可直接复用，拟修前端权威恢复、加载时先GET再后台POST、沉浸式可见入口，保留身份隔离/拜访暂停/结束一次扣时。

此处是实证的版本恢复缺陷，不将它倒推为此前一次AI服务不可用的唯一根因。

## 真实页面恢复验证

在原Chrome用户标签1062401161重新加载后，先显示读取状态，再恢复张建国原首轮回复；发送/主动告辞均恢复可用，失败的告辞文字保留为输入草稿。点击沉浸式拜访内“同步预览会话”成功，再次浏览器刷新也成功恢复。未点击发送、主动告辞、重置或提交；after.png为恢复后原用户页面。

只读DB evidence见visit-farewell-2026-10-22/recovery-after.json：原session701f74b4-dd93-4eec-9325-83fd9fd6a6f1仍activeMeeting P1-001/turn1/ended=false/无lease，版本3→5。后台活动同步会推进版本，不代表新增玩家沟通；没有替用户结束拜访。初次409与加载旧页面的历史日志不归为新版本回归结果。

独立Review发现并修复：合法wechat_request频道需要恢复映射；活跃拜访必须先恢复暂停状态再应用活动计时。根最终VM另检出boot未恢复前计时先结算，需要门控到恢复完成。

## 最终检查

主线程实际diff审阅，独立Review无剩余P1/P2。七项专项均有明确通过输出：test-preview-recovery-ui、test-preview-account-isolation、test-preview-test-controls、test-preview-countdown、test-preview-stream-protocol、test-preview-error-diagnostics、test-project-one-preview-ai。新VM增加15秒watchdog，实际等待各异步用例完成，未以未settled提前退出视为通过。

最终tsc --noEmit、三测试文件ESLint --quiet、corepack pnpm build（Next+tsup）、harness-check.ps1、相关tracked diff --check全部通过。新恢复VM覆盖GET先于POST、渠道含wechat_request、404保留、过期GET账号隔离、active/ended/finalReply恢复及计时幂等；静态HTML直接由当前5000服务提供，无后端修改或重启。最终Chrome刷新恢复可用后保存after.png，画面保留未发送的告别草稿，原用户可自行继续操作。
