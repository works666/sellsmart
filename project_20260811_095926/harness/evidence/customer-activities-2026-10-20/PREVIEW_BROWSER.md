# 五人预览客户活动浏览器验收

从仓库根目录运行：

```powershell
node harness/evidence/customer-activities-2026-10-20/preview-browser.mjs
```

脚本用 bundled Playwright 启动本机 Chrome，直接加载 `projects/public/project1-prototype-v9.html`。它覆盖页面内 `fetch`，只使用脚本构造的本地客户活动 mock 队列；不会请求真实 API，也不会触发远程 AI。测试结果写入 `preview-browser-results.json`，截图为 `preview-planning-prompt.png`、`preview-planning-draft.png`、`preview-timeout-evaluation.png` 和 `preview-processing-result.png`。
