# Supabase 网络诊断 · 2026-10-27

只读请求health_check.select(id).limit(1)，不写DB，不输出API key、项目URL或业务数据，不启动本地服务。

本轮用户提供SUPABASE_NETWORK_ERROR。诊断包装原生fetch，仅提取安全的Error name/code/cause及无URL消息。第一次直连16/16失败，176–186ms，status0，cause ECONNRESET / Client network socket disconnected before secure TLS connection was established。OS lookup有两个公网IPv4；独立resolve4出现queryA ECONNREFUSED，系统DNS并非完全不可用，未据此归因为唯一DNS错误。

对照仅子进程设置NODE_USE_ENV_PROXY=1、HTTP_PROXY及HTTPS_PROXY为现有本地127.0.0.1:7897，不写系统或.env。代理同配置16/16 HTTP200，首请求6309ms、后续292–704ms。回到直连后再次16/16失败，约181–234ms，仍ECONNRESET。

当前Windows系统代理disabled，7897有监听。Node v24.15.0，原进程未设proxy env。证据支持“该Supabase直连路线被重置，代理路线当前可用”，不支持推断具体路由/防火墙节点或Supabase全局故障。此前4次成功描述的是更早时点，不代表故障不能复现。

诊断脚本在忽略的tmp/supabase-network-detail-20261027.ts；未改变客户端实现和写请求重试策略。现有启动脚本只归类通用错误，底层原因被掩盖。建议操作仅在用户启动终端显式设置proxy env，NO_PROXY应含localhost/127.0.0.1/::1；代理软件需要继续运行。没有自动应用或启动项目。
