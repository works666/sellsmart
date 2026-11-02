import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Script, createContext } from 'node:vm';

const html = readFileSync(resolve(process.cwd(), 'public/project1-prototype-v9.html'), 'utf8');
const previewRoute = readFileSync(resolve(process.cwd(), 'src/app/api/project-one-preview/ai/route.ts'), 'utf8');

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) throw new Error(`${message}（实际：${String(actual)}，预期：${String(expected)}）`);
}

assert(html.includes('const COMMON_WECHAT_EMOJIS='), '缺少内置 Emoji 清单');
assert(html.includes('const WECHAT_STICKERS='), '缺少内置表情包清单');
assert((html.match(/id:'[^']+',name:'[^']+',symbol:'[^']+',hint:'[^']+'/g) ?? []).length >= 8, '系统预设表情包少于 8 个');
assert(html.includes('`[表情包：${sticker.name}]`'), '表情包未转换为 AI 可读文本');
assert(html.includes('data-expression-emoji='), 'Emoji 插入入口缺失');
assert(html.includes('data-sticker-id='), '表情包发送入口缺失');
assert(html.includes("messageType:'sticker'"), '消息未保存表情包类型');
assert(html.includes('stickerId:sticker.id'), '消息未保存白名单表情包 ID');
assert(/const res=await accountScopedApiCall\('message',payload,\{commandId:options\.commandId,retryKind:'sticker'/.test(html), '表情包未沿用账号隔离的可重试命令');
assert(/if\(!res\)\{render\(\);return\}[\s\S]*?if\(committed\.isNew\)spend\(1,'发送微信表情包',false\)/.test(html), '表情包必须在请求成功后才扣点');
assert(html.includes("if(requestBusy){toast('AI 正在处理中，请稍候。','warn');return}"), '缺少表情包重复发送保护');
assert(!/type=["']file["']/i.test(html), '不应提供玩家上传表情包入口');

assert(html.includes("responseAction:'read_no_reply'"), '缺少已读不回处理分支');
assert(html.includes("data.readStatus!=='read'"), '已读不回未严格校验已读状态');
assert(html.includes("data.invitationStatus!=='none'"), '已读不回必须禁止邀约状态');
assert(html.includes('typeof data.playerMessageId!==\'string\''), '已读不回未校验玩家消息 ID');
assert(html.includes("if(data?.responseAction==='read_no_reply')return;"), '已读不回不应触发邀约提示');
assert(html.includes("if(!data?.invitationStatus||data.invitationStatus==='none')return;"), '无邀约状态不应弹出结果提示');
assert(html.includes("const readLabel=message?.readStatus==='read'?(channel==='email'?'已阅读':'已读'):''"), '微信/邮件阅读标记未按渠道展示');
assert(/if\(outcome\.responseAction==='reply'&&outcome\.content/.test(html), '已读不回不能生成 NPC 气泡');
assert(html.includes("state.aiRetry={action,commandId,payload"), '失败请求未保留原命令用于重试');
assert(html.includes('data-action="retry-ai"'), '失败状态缺少重试入口');
assert(/retry\.kind==='message'\)return sendMessage\(\{commandId:retry\.commandId,payload:retry\.payload\}\)/.test(html), '消息重试未复用原 commandId');
assert(/retry\.kind==='sticker'\)return sendSticker\(retry\.meta\?\.stickerId/.test(html), '表情包重试未复用原 commandId');
assert(html.includes('next.aiRetry=normalizeRetryRequest(raw.aiRetry)'), '刷新恢复未规范化待重试命令');
assert(html.includes("next.aiStatus='';"), '刷新恢复不应保留处理中状态');
assert(html.includes("next.aiError='上次发送尚未确认，请重试。'"), '未确认消息刷新后缺少可见重试提示');
assert(html.includes('retryHasCommittedMessage(next.aiRetry,next.conversations)'), '刷新恢复未清理已提交消息的重试状态');
assert(html.includes('if(options.renderPending!==false)render()'), '消息等待阶段必须能够跳过全局 render');
assert(html.includes('renderPending:false'), '普通消息发送未启用无刷新等待模式');
assert(html.includes('pendingConversation={npcId:n.id,channel:ch,commandId}'), '消息发送前未建立局部 NPC 回复状态');
assert(html.includes('refreshMessageThread(ch,n);setMessageComposerBusy(true,ch)'), '消息发送前未即时更新对话区并锁定输入');
assert(html.includes('正在回复'), '缺少 NPC 正在回复的自然等待反馈');
assert(html.includes('对方已表示告辞，你还可以最后回应一次。'), 'NPC 告辞后缺少玩家最后一次回应提示');
assert(html.includes("npc_time_constraint:'NPC表示忙碌或另有会议，会面立即结束'"), '缺少 NPC 忙碌或开会的强制结束文案');
assert(html.includes("finalReply?'回应并结束':'发送'"), 'NPC 告辞后发送按钮未切换为最后回应');
assert(html.includes("name:'赵晓晨',title:'项目执行人员',category:'项目执行'"), '赵晓晨前端主档未体现项目执行人员定位');
assert(html.includes('项目经理李明辉的直属下属'), '赵晓晨前端主档未体现与李明辉的直属关系');
assert(html.includes("accept:'text/event-stream'"), '前端 AI 请求未声明 SSE 流式响应');
assert(html.includes("retryKind:'phone_message'"), '电话对话未使用独立的流式重试类型');
assert(html.includes("retryKind:'visit_turn'"), '实际拜访未使用独立的流式重试类型');
assert(html.includes('onDelta:content=>appendStreamDelta(reply,content)'), '电话或实际拜访未逐块追加 NPC 回复');
assert(previewRoute.includes('new ReadableStream<Uint8Array>'), '预览 AI 路由未创建流式响应');
assert(previewRoute.includes("send({ type: 'status', status: 'thinking' })"), '流式响应未立即发送思考状态');
assert(previewRoute.includes("send({ type: 'delta', content:"), '流式响应未发送文本增量');
assert(previewRoute.includes("send({ type: 'result', data: response })"), '流式响应未发送最终原子状态');
assert(previewRoute.includes("parsed.data.action === 'visit_turn'"), '实际拜访未加入服务端流式动作白名单');
assert(previewRoute.includes("parsed.data.channel === 'work_phone'"), '电话消息未加入服务端流式动作白名单');

const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
assert(scripts.length > 0, '未找到内联脚本');
for (const [, source] of scripts) new Function(source);

function extractFunction(source: string, name: string): string {
  const start = source.indexOf(`function ${name}`);
  assert(start >= 0, `未找到前端函数 ${name}`);
  const declarationStart = source.slice(Math.max(0, start - 6), start) === 'async ' ? start - 6 : start;
  const signatureEnd = source.indexOf('){', start);
  const open = signatureEnd + 1;
  assert(open >= 0, `${name} 缺少函数体`);
  let depth = 0;
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') { blockComment = false; index += 1; }
      continue;
    }
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (char === '\\') { escaped = true; continue; }
      if (char === quote) quote = '';
      continue;
    }
    if (char === '/' && next === '/') { lineComment = true; index += 1; continue; }
    if (char === '/' && next === '*') { blockComment = true; index += 1; continue; }
    if (char === '\'' || char === '"' || char === '`') { quote = char; continue; }
    if (char === '{') depth += 1;
    if (char === '}' && --depth === 0) return source.slice(declarationStart, index + 1);
  }
  throw new Error(`${name} 函数体未闭合`);
}

const source = scripts[0][1];
const vmContext = createContext({
  Date, Math, Object, Set, String, JSON, TextDecoder,
  crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000001' },
  state: { conversations: { P1: { email: [], wechat: [] } } },
  npc: undefined,
});
const vmCode = [
  extractFunction(source, 'newPreviewCommandId'),
  extractFunction(source, 'normalizeMessageResponse'),
  extractFunction(source, 'readPreviewStream'),
  extractFunction(source, 'channelLabel'),
  extractFunction(source, 'formatAttachment'),
  extractFunction(source, 'appendMessageResult'),
  extractFunction(source, 'retryIsMessage'),
  extractFunction(source, 'hasCommittedRetry'),
  'globalThis.hooks={normalizeMessageResponse,readPreviewStream,appendMessageResult,retryIsMessage,hasCommittedRetry};',
].join('\n');
new Script(vmCode).runInContext(vmContext);
type MessageOutcome = {
  responseAction: 'reply' | 'read_no_reply';
  content: string | null;
  invitationStatus?: 'none' | 'accepted' | 'rejected' | 'later';
  readStatus?: 'read';
  playerMessageId?: string;
};
type AppendResult = { outcome: MessageOutcome; playerMessageId: string; isNew: boolean; shouldCharge: boolean } | null;
type FrontendHooks = {
  normalizeMessageResponse: (value: unknown, channel: string) => MessageOutcome | null;
  readPreviewStream: (response: { body: ReadableStream<Uint8Array> }, onDelta: (content: string) => void) => Promise<Record<string, unknown>>;
  appendMessageResult: (...args: unknown[]) => AppendResult;
  retryIsMessage: () => boolean;
  hasCommittedRetry: (value: unknown) => boolean;
};
const hooks = (vmContext as { hooks: FrontendHooks }).hooks;
async function testPreviewStream(): Promise<void> {
  const encodedStream = new TextEncoder();
  const streamedChunks: string[] = [];
  const streamResult = await hooks.readPreviewStream({
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encodedStream.encode('data: {"type":"status","status":"thinking"}\n\ndata: {"type":"delta","content":"您好"}\n'));
        controller.enqueue(encodedStream.encode('\ndata: {"type":"delta","content":"，请讲。"}\n\ndata: {"type":"result","data":{"action":"visit_turn","version":2}}\n\n'));
        controller.close();
      },
    }),
  }, (content) => streamedChunks.push(content));
  assertEqual(streamedChunks.join(''), '您好，请讲。', 'SSE 文本增量未按顺序交给界面');
  assertEqual(streamResult.version, 2, 'SSE 最终状态未正确返回');
}
const playerId = '00000000-0000-4000-8000-000000000002';
const silentPlayerId = '00000000-0000-4000-8000-000000000003';
const replyOutcome = hooks.normalizeMessageResponse({ responseAction: 'reply', content: '收到，我会确认。', invitationStatus: 'none', readStatus: 'read', playerMessageId: playerId }, 'wechat');
assert(replyOutcome?.responseAction === 'reply', '回复分支未通过严格契约校验');
const silentOutcome = hooks.normalizeMessageResponse({ responseAction: 'read_no_reply', content: null, invitationStatus: 'none', readStatus: 'read', playerMessageId: silentPlayerId }, 'wechat');
assert(silentOutcome?.responseAction === 'read_no_reply' && silentOutcome.content === null, '已读不回分支未通过严格契约校验');
assert(hooks.normalizeMessageResponse({ content: '旧格式回复', invitationStatus: 'none' }, 'wechat') === null, '异步渠道缺少 responseAction 时不能回退为回复');
assert(hooks.normalizeMessageResponse({ responseAction: 'read_no_reply', content: null, invitationStatus: 'none', readStatus: 'read', playerMessageId: playerId, appointment: {} }, 'email') === null, '已读不回不能携带预约');
assert(hooks.normalizeMessageResponse({ content: '电话回复', invitationStatus: 'none' }, 'work_phone')?.responseAction === 'reply', '电话旧回复契约不应被破坏');

type ConversationMessage = { readStatus?: string; [key: string]: unknown };
const conversationState = vmContext.state as { conversations: Record<string, Record<string, ConversationMessage[]>> };
const person = { id: 'P1', name: '张建国' };
const firstMessage = hooks.appendMessageResult(person, 'wechat', '已发送的有效信息', '', replyOutcome, { commandId: 'cmd-1' }, 'local-cmd-1');
assert(firstMessage?.isNew === true, '回复成功后的玩家消息未标记为新消息');
assertEqual(conversationState.conversations.P1.wechat.length, 2, '回复成功后应保存玩家消息和 NPC 气泡');
const secondMessage = hooks.appendMessageResult(person, 'wechat', '收到，谢谢。', '', silentOutcome, { commandId: 'cmd-2' }, 'local-cmd-2');
assert(secondMessage?.isNew === true, '已读不回后的玩家消息未标记为新消息');
assertEqual(conversationState.conversations.P1.wechat.length, 3, '已读不回只应保存玩家消息，不应创建 NPC 假气泡');
assert(conversationState.conversations.P1.wechat[2].readStatus === 'read', '已读不回未在消息历史中保存已读标记');
assert(hooks.hasCommittedRetry({ commandId: 'cmd-2' }) === true, '已提交消息未被幂等重试检测到');
assert(hooks.hasCommittedRetry({ commandId: 'cmd-unknown' }) === false, '不存在的命令不应被视为已提交');
conversationState.conversations.P1.email.push({ role: 'player', text: '先显示的玩家消息', messageId: 'local-cmd-3', commandId: 'cmd-3', pending: true, charged: false });
assert(hooks.hasCommittedRetry({ commandId: 'cmd-3' }) === false, '乐观消息不能被误判为已提交');
const optimisticOutcome = hooks.normalizeMessageResponse({ responseAction: 'reply', content: '这是稍后返回的回复。', invitationStatus: 'none', readStatus: 'read', playerMessageId: 'server-message-3' }, 'email');
const completedOptimistic = hooks.appendMessageResult(person, 'email', '先显示的玩家消息', '', optimisticOutcome, { commandId: 'cmd-3' }, 'local-cmd-3');
assert(completedOptimistic?.isNew === false, '服务端返回后应就地完成乐观消息，不能重复追加玩家气泡');
assert(completedOptimistic?.shouldCharge === true, '首次完成乐观消息时应结算行动点');
assertEqual(conversationState.conversations.P1.email.length, 2, '乐观消息完成后应只有一个玩家气泡和一个 NPC 气泡');
assert(conversationState.conversations.P1.email[0].pending === false, '服务端返回后应清除玩家消息的等待状态');
assert(hooks.hasCommittedRetry({ commandId: 'cmd-3' }) === true, '完成后的乐观消息应被幂等重试检测到');
vmContext.state.aiRetry = { kind: 'message' };
assert(hooks.retryIsMessage() === true, '消息重试状态未识别');

testPreviewStream()
  .then(() => console.log('微信、电话、实际拜访流式交互与已读不回前端回归通过'))
  .catch((error) => { console.error(error); process.exitCode = 1; });
