# 竞争对手资料联动浏览器验收（2026-10-14）

状态：通过

- designer /designer → 数据 → 竞品数据: all seven form fields saved in a PUT payload with project_id and expected_revision; mock source updated for both game surfaces
- formal /game: list/detail navigation, focus refresh, deletion, and a timer poll retain the same modal shell; unchanged data preserves body, focus, and scroll; no active modal entrance animation; competitor data edit, empty/error retry, legacy ABC exclusion, five contacts, mobile layout, and unchanged AP/game commands passed
- preview /project1-prototype-v9.html: list/detail navigation, focus refresh, and deletion retain the same modal shell; unchanged data preserves body, focus, and scroll; no active modal entrance animation on open/reopen; competitor data edit, empty/error retry, legacy ABC exclusion, mobile layout, and stable AP/countdown passed

## Modal 闪动排查

- 静态根因（主线程对旧实现的检查）：原型页 `openModal` 每次都通过 `modalRoot.innerHTML` 重建 backdrop 和 modal；CSS 分别为 backdrop 与 modal 设置 `backdropIn`、`modalIn` 入场动画，因此打开和内部导航会重复触发入场效果。
- 旧版本运行时 baseline 未取得：在访问旧服务前原型 HTML 已更新为稳定 shell，且本机默认沙箱拒绝了 localhost socket；报告只记录静态根因和下面对最终页面的实际浏览器断言，不声称做过旧版运行时对比。
- 最终页面实际检查打开/重开时 computed `animation-name` 为 `none` 且无活动动画；焦点刷新、列表/详情往返、删除刷新，以及正式页 timer poll 后 backdrop/modal 节点不变；相同资料刷新还检查 body 节点、焦点和真实非零滚动位置。

## Mock 边界

- 使用本地 `127.0.0.1:3000` 页面，通过 Playwright 路由 mock 所有应用 API；测试数据只存在于本脚本内存中的 profile store。
- Mock 原始资料包含旧 UUID `10000000-0000-4000-8000-000000000101` 的 `ABC竞品` 占位；mock API 按 UUID 与占位公司名同时匹配后过滤它，避免把旧资料展示给设计师和玩家。
- 设计师保存由 mock `/api/game-data/competitors` 接收并校验完整 payload，再将更新写入同一个内存 store；正式页与预览页从 mock `/api/game-data/competitor-profiles?project_id=1` 读取相同 revision 和资料。该流程验证前后端契约与页面联动，不验证数据库、权限服务或真实持久化。
- 浏览器对非本机 origin 的网络请求全部拦截；正式聊天、预览消息/拜访/电话 AI 请求均未调用。计时和行动点只通过页面/API mock 观察，竞品交互不发送游戏命令。

## 独立的真实配置检查

- 主线程另行查询了真实管理数据库：项目当前有 2 家竞品，revision 为 2，`ABC_removed=true`。这不是本次 Playwright mock 请求的结果。
- 真实 REST 浏览器保存仍未验收；外部 REST 连接受 TLS `ECONNRESET` 限制。

## 截图

- 正式页： [桌面顶部卡片](formal-competitor-cards-desktop.png) · [桌面公司列表](formal-competitor-list-desktop.png) · [桌面公司详情](formal-competitor-detail-desktop.png) · [手机顶部卡片](formal-competitor-cards-mobile.png) · [手机公司列表](formal-competitor-list-mobile.png) · [手机公司详情](formal-competitor-detail-mobile.png)
- 预览页： [桌面顶部卡片](preview-competitor-cards-desktop.png) · [桌面公司列表](preview-competitor-list-desktop.png) · [桌面公司详情](preview-competitor-detail-desktop.png) · [手机顶部卡片](preview-competitor-cards-mobile.png) · [手机公司列表](preview-competitor-list-mobile.png) · [手机公司详情](preview-competitor-detail-mobile.png)
- 交互状态： [正式页编辑后更新](formal-competitor-after-designer-update.png) · [预览页编辑后更新](preview-competitor-after-designer-update.png) · [设计师编辑表单](designer-competitor-edited-desktop.png) · [正式页空状态](formal-competitor-empty-state.png) · [正式页错误与重试](formal-competitor-error-state.png) · [预览页空状态](preview-competitor-empty-state.png) · [预览页错误与重试](preview-competitor-error-state.png)

## 浏览器诊断

- 页面运行错误：0
- Next 静态资源失败：0
- 未预期应用 API：0
- 出站外部请求（已拦截）：0
- AI/模型写请求：0
- 资料 GET：23
- 设计师保存：1

截图与本报告位于 `harness/evidence/competitor-profiles-2026-10-14/`。
