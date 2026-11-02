const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const Module = require('node:module');

const evidenceDir = __dirname;
const repoRoot = path.resolve(evidenceDir, '../../..');
const projectRoot = path.join(repoRoot, 'projects');
const projectRequire = createRequire(path.join(projectRoot, 'package.json'));
projectRequire('tsx/cjs/api').register();
const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveProjectAlias(request, parent, ...args) {
  const resolvedRequest = request.startsWith('@/')
    ? path.join(projectRoot, 'src', request.slice(2))
    : request;
  return resolveFilename.call(this, resolvedRequest, parent, ...args);
};
const { chromium } = require('C:/Users/17628/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const {
  connectNpc,
  consumeCommunicationTime,
  createProjectOneState,
  executeGameCommand,
  recordMeetingTurn,
  recordNpcOutbound,
  shouldNpcRespond,
  startPhoneCall,
  toPlayerVisibleGameState,
} = projectRequire(path.join(projectRoot, 'src/lib/game/state.ts'));
const { PROJECT_ONE_NPCS } = projectRequire(path.join(projectRoot, 'src/lib/game/project-one.ts'));

const baseUrl = (process.env.E2E_BASE_URL || 'http://127.0.0.1:3012').replace(/\/+$/, '');
const sessionId = 'formal-sync-ui-fixture';
const npcId = 'P1-001';
const npcName = PROJECT_ONE_NPCS.find((npc) => npc.id === npcId)?.name;
assert.ok(npcName, `fixture NPC ${npcId} must exist`);
const browserDiagnostics = [];

const workPlanEvaluation = {
  recommendations: ['先核对决策链与预算口径，再安排技术交流。'],
  disclosures: [],
};
const briefVisitEvaluation = {
  strengths: ['先确认客户当前问题，再介绍对应方案。'],
  risks: ['现场需核验决策角色与下一步负责人。'],
  nextStep: '交流后整理客户确认的验收范围。',
};
const preparationText = '目标人物：张建国。客户问题：核实重复录入和验收边界。解决方案：说明分阶段实施与交付责任。证据：准备验收清单和可核验案例。下一步：约定后续技术交流与责任人。';
const planText = '本阶段先核实项目决策链与预算来源，再安排技术交流验证兼容性，最后针对验收边界形成可量化方案。';
const applicationText = '张经理您好，我是本项目供应方负责人。后续想向您确认实施与验收细节，如您方便，申请添加工作微信用于项目沟通。';
const emailAttachmentText = '附上一页验收边界清单，说明每项交付物的确认方式和责任方。';
const wechatAttachmentText = '附上流程对比与验收清单，重点标出需要双方确认的交付口径。';

function responseJson(body, status = 200) {
  return { status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) };
}

function visible(state) {
  return toPlayerVisibleGameState(state);
}

function applySeedCommand(state, type, payload, commandId, options = {}) {
  const executed = executeGameCommand(state, {
    commandId,
    expectedVersion: state.version,
    type,
    payload,
  }, options);
  return { ...executed.state, version: state.version + 1 };
}

function createConnectedState() {
  const initial = createProjectOneState();
  return applySeedCommand(initial, 'contact', { npcId, channel: 'email' }, 'fixture-contact-email');
}

function acceptedWechatCommandId(state) {
  const support = state.npcAttitudes[npcId]?.support ?? 35;
  const chance = 18 + state.currentRound * 8 + Math.max(0, support - 35);
  for (let index = 0; index < 10000; index += 1) {
    const candidate = `fixture-wechat-accepted-${index}`;
    if (shouldNpcRespond(`${candidate}:wechat`, chance)) return candidate;
  }
  throw new Error('could not find deterministic accepted-WeChat test command ID');
}

function createHarness(seedState = createConnectedState()) {
  const harness = {
    state: seedState,
    commands: [],
    chatRequests: [],
    routeCounts: new Map(),
    messages: [
      {
        id: 'fixture-email-read-no-reply',
        role: 'user',
        content: '历史邮件：请核对验收范围与交付责任。',
        createdAt: '2026-10-12T02:00:00.000Z',
        metadata: {
          npcId,
          channel: 'email',
          deliveryStatus: 'read_no_reply',
          readStatus: 'read',
          emailAttachments: [{ fileName: '历史附件说明', description: '验收范围和责任人清单。' }],
        },
      },
      {
        id: 'fixture-wechat-read-no-reply',
        role: 'user',
        content: '历史微信：补充了交付边界清单，方便您有空时查看。',
        createdAt: '2026-10-12T02:05:00.000Z',
        metadata: {
          npcId,
          channel: 'online',
          deliveryStatus: 'read_no_reply',
          readStatus: 'read',
          attachments: [{
            fileName: '微信附件说明',
            description: '交付边界清单。',
            viewed: false,
            impact: '收件人尚未查看。',
          }],
        },
      },
    ],
    conflictInjected: false,
    conflictedCommandId: null,
    conflictRetryAsserted: false,
    chatScenario: 0,
    sessionReads: [],
    streamEvents: [],
  };

  harness.incrementRoute = (pathname) => harness.routeCounts.set(pathname, (harness.routeCounts.get(pathname) || 0) + 1);

  harness.route = async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (!url.pathname.startsWith('/api/')) return route.continue();
    harness.incrementRoute(url.pathname);

    if (url.pathname === `/api/game/sessions/${sessionId}` && request.method() === 'GET') {
      harness.sessionReads.push(visible(harness.state));
      return route.fulfill(responseJson({ success: true, gameSession: { id: sessionId, state: visible(harness.state) } }));
    }
    if (url.pathname === `/api/game/sessions/${sessionId}/messages` && request.method() === 'GET') {
      return route.fulfill(responseJson({ success: true, messages: harness.messages }));
    }
    if (url.pathname === `/api/game/sessions/${sessionId}/call-history` && request.method() === 'GET') {
      return route.fulfill(responseJson({ success: true, calls: [] }));
    }
    if (url.pathname.startsWith('/api/game-data/npcs')) {
      return route.fulfill(responseJson({ success: true, data: PROJECT_ONE_NPCS.map((profile) => ({ ...profile, weakness: null })) }));
    }
    if (url.pathname === '/api/designer/image-assets') {
      return route.fulfill(responseJson({ success: true, assets: {} }));
    }
    if (url.pathname === `/api/game/sessions/${sessionId}/commands` && request.method() === 'POST') {
      const body = request.postDataJSON();
      harness.commands.push(body);

      if (body.type === 'work_plan' && !harness.conflictInjected) {
        harness.conflictInjected = true;
        harness.conflictedCommandId = body.commandId;
        return route.fulfill(responseJson({ error: 'STATE_VERSION_CONFLICT', state: visible(harness.state) }, 409));
      }
      if (body.type === 'work_plan' && harness.conflictedCommandId && !harness.conflictRetryAsserted) {
        assert.equal(body.commandId, harness.conflictedCommandId, 'retry must reuse the original idempotency key');
        harness.conflictRetryAsserted = true;
      }

      const options = body.type === 'work_plan'
        ? { workPlanEvaluation }
        : body.type === 'prepare'
          ? { visitPreparationEvaluation: {
            needsDetail: false,
            strengths: ['准备了验收清单，并明确了需要确认的责任方。'],
            risks: ['现场需验证客户给出的流程细节。'],
            nextStep: '确认技术交流参与人和时间。',
          } }
        : body.type === 'brief_visit'
          ? { briefVisitEvaluation }
          : {};
      // Keep the real reducer path while choosing an accepted deterministic
      // idempotency seed for the synthetic WeChat outcome.
      const reducerCommandId = body.type === 'request_wechat'
        ? acceptedWechatCommandId(harness.state)
        : body.commandId;
      const executed = executeGameCommand(harness.state, {
        commandId: reducerCommandId,
        expectedVersion: body.expectedVersion,
        type: body.type,
        payload: body.payload,
      }, options);
      harness.state = { ...executed.state, version: harness.state.version + 1 };
      return route.fulfill(responseJson({
        success: true,
        result: executed.result,
        state: visible(harness.state),
      }));
    }
    if (url.pathname === '/api/chat/stream' && request.method() === 'POST') {
      const body = request.postDataJSON();
      harness.chatRequests.push(body);
      let event;
      let content = '';

      if (body.intent === 'call_connect' && body.channel === 'work_phone') {
        const nextState = startPhoneCall(
          connectNpc(
            recordNpcOutbound(consumeCommunicationTime(harness.state, 'work_phone'), npcId),
            npcId,
          ),
          npcId,
        );
        harness.state = { ...nextState, version: harness.state.version + 1 };
        content = '您好，我是张建国，您可以讲一下这次要确认的事项。';
        harness.messages.push({
          id: `fixture-phone-greeting-${harness.chatRequests.length}`,
          role: 'assistant',
          content,
          createdAt: new Date(Date.now() + 5).toISOString(),
          metadata: { npcId, channel: 'work_phone', deliveryStatus: 'replied', callConnected: true },
        });
        event = { type: 'result', state: visible(harness.state), deliveryStatus: 'replied', callConnected: true };
      } else if (body.channel === 'offline' && harness.state.activeMeeting?.awaitingFinalReplyFrom === 'player') {
        harness.state = {
          ...recordMeetingTurn(harness.state),
          version: harness.state.version + 1,
        };
        harness.messages.push({
          id: `fixture-farewell-player-${harness.chatRequests.length}`,
          role: 'user',
          content: body.message,
          createdAt: new Date().toISOString(),
          metadata: { npcId, channel: 'offline', deliveryStatus: 'replied', meetingId: body.appointmentId },
        });
        event = { type: 'result', state: visible(harness.state), deliveryStatus: 'replied', responseAction: 'final_player_reply' };
      } else if (body.channel === 'offline' && harness.state.activeMeeting) {
        harness.state = {
          ...harness.state,
          npcAttitudes: {
            ...harness.state.npcAttitudes,
            [npcId]: { ...harness.state.npcAttitudes[npcId], pleasantness: 75 },
          },
        };
        harness.state = {
          ...recordMeetingTurn(harness.state, { npcFarewell: true }),
          version: harness.state.version + 1,
        };
        assert.equal(visible(harness.state).npcExpressions[npcId], 'pleasant', 'visible NPC expression is derived from pleasantness 75 through the real mapper');
        harness.messages.push(
          {
            id: `fixture-visit-player-${harness.chatRequests.length}`,
            role: 'user',
            content: body.message,
            createdAt: new Date().toISOString(),
            metadata: { npcId, channel: 'offline', deliveryStatus: 'replied', meetingId: body.appointmentId },
          },
          {
            id: `fixture-visit-npc-${harness.chatRequests.length}`,
            role: 'assistant',
            content: '今天先聊到这里。感谢你把验收范围讲清楚，后续有进展我们再保持沟通。',
            createdAt: new Date().toISOString(),
            metadata: { npcId, channel: 'offline', deliveryStatus: 'replied', npcExpression: 'pleasant', meetingId: body.appointmentId },
          },
        );
        event = {
          type: 'result',
          state: visible(harness.state),
          deliveryStatus: 'replied',
          npcExpression: 'pleasant',
        };
      } else {
        harness.chatScenario += 1;
        const noReply = harness.chatScenario % 2 === 1;
        harness.messages.push({
          id: `fixture-chat-player-${harness.chatRequests.length}`,
          role: 'user',
          content: body.message,
          createdAt: new Date().toISOString(),
          metadata: {
            npcId,
            channel: body.channel,
            deliveryStatus: noReply ? 'read_no_reply' : 'replied',
            ...(noReply ? { readStatus: 'read' } : {}),
            ...(Array.isArray(body.attachments) ? { attachments: body.attachments.map((item) => ({ ...item, viewed: false, impact: '待联系人查看。' })) } : {}),
          },
        });
        event = {
          type: 'result',
          state: visible(harness.state),
          deliveryStatus: noReply ? 'read_no_reply' : 'replied',
          responseAction: noReply ? 'read_no_reply' : 'reply',
          ...(noReply ? { readStatus: 'read' } : {}),
          ...(Array.isArray(body.attachments) ? { attachments: body.attachments.map((item) => ({ ...item, viewed: false, impact: '待联系人查看。' })) } : {}),
          ...(!noReply ? { npcExpression: 'pleasant' } : {}),
        };
        if (!noReply) content = '收到，我会按你说明的交付范围核对。';
        if (!noReply) {
          harness.messages.push({
            id: `fixture-chat-npc-${harness.chatRequests.length}`,
            role: 'assistant',
            content: '收到，我会按你说明的交付范围核对。',
            createdAt: new Date().toISOString(),
            metadata: { npcId, channel: body.channel, deliveryStatus: 'replied', npcExpression: 'pleasant' },
          });
        }
      }

      if (body.channel === 'offline' && event.type === 'result' && event.npcExpression) {
        content = '今天先聊到这里。感谢你把验收范围讲清楚，后续有进展我们再保持沟通。';
      }
      harness.streamEvents.push(event);
      const sse = [
        ...(content ? [{ type: 'delta', content }] : []),
        event,
        '[DONE]',
      ].map((item) => `data: ${item === '[DONE]' ? item : JSON.stringify(item)}\n\n`).join('');
      return route.fulfill({ status: 200, contentType: 'text/event-stream; charset=utf-8', body: sse });
    }

    // The game page may add read-only app endpoints over time; keep the harness
    // deterministic by mocking every /api path, while recording any fallback.
    harness.unhandledApiPaths ??= new Set();
    harness.unhandledApiPaths.add(`${request.method()} ${url.pathname}`);
    return route.fulfill(responseJson({ success: true, data: {} }));
  };

  return harness;
}

async function waitVisible(locator, description) {
  try {
    await locator.waitFor({ state: 'visible', timeout: 8000 });
  } catch {
    const pageText = await locator.page().locator('body').innerText().catch(() => '');
    throw new Error(`Expected visible UI: ${description}\nPage text: ${pageText.slice(0, 1200)}`);
  }
}

async function waitUntil(predicate, description, timeoutMs = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function clickButton(page, name, description = name) {
  const locator = page.getByRole('button', { name }).first();
  await waitVisible(locator, description);
  await locator.click();
}

async function assertNoHorizontalOverflow(page, label) {
  const metrics = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  assert.ok(
    Math.max(metrics.document, metrics.body) <= metrics.viewport + 1,
    `${label} overflows horizontally: ${JSON.stringify(metrics)}`,
  );
}

async function assertMobileColumnFlow(page, label) {
  const columns = [
    page.locator('aside').first(),
    page.locator('section').filter({ has: page.getByText('接触状态与公开信息数量会更新在对应卡片', { exact: true }) }).first(),
    page.getByRole('main'),
  ];
  const boxes = await Promise.all(columns.map((column) => column.boundingBox()));
  assert.ok(boxes.every(Boolean), `${label} should expose all three stacked workspace columns`);
  for (let index = 0; index < boxes.length - 1; index += 1) {
    const current = boxes[index];
    const next = boxes[index + 1];
    assert.ok(
      current.y + current.height <= next.y + 1,
      `${label} columns overlap or are out of document order: ${JSON.stringify(boxes)}`,
    );
  }
}

async function capture(page, filename) {
  await page.waitForFunction(() => Array.from(document.images).every((image) => image.complete), null, { timeout: 5000 });
  await page.screenshot({ path: path.join(evidenceDir, filename), fullPage: true, animations: 'disabled', caret: 'initial' });
}

async function fillAndSend(page, message, attachment) {
  const attachmentBox = page.getByLabel('附加材料（可选）');
  await waitVisible(attachmentBox, 'single natural-language attachment field');
  await attachmentBox.fill(attachment);
  const messageBox = page.locator('textarea[placeholder*="撰写邮件正文"], textarea[placeholder*="输入微信消息"]').first();
  await waitVisible(messageBox, 'email/WeChat message composer');
  await messageBox.fill(message);
  await messageBox.press('Enter');
}

async function prepareDesktopFlow(browser) {
  const harness = createHarness();
  const pageErrors = [];
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await context.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('weixun_session', 'formal-sync-ui-fixture-token');
    localStorage.setItem('weixun_identity', JSON.stringify({ role: 'platform_designer', displayName: '正式同步验收' }));
  });
  await context.route('**/api/**', harness.route);
  const page = await context.newPage();
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
    browserDiagnostics.push(`pageerror: ${error.message}`);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') browserDiagnostics.push(`console.error: ${message.text()}`);
  });
  page.on('requestfailed', (request) => {
    const url = new URL(request.url());
    browserDiagnostics.push(`requestfailed: ${request.method()} ${url.pathname} (${request.failure()?.errorText || 'unknown'})`);
  });
  page.on('dialog', (dialog) => {
    browserDiagnostics.push(`dialog: ${dialog.type()} ${dialog.message()}`);
    void dialog.accept();
  });
  await page.goto(`${baseUrl}/game?location=project-1&mode=solo&sessionId=${sessionId}`, { waitUntil: 'domcontentloaded' });
  await waitVisible(page.getByRole('heading', { name: '整体工作计划' }), 'initial overall work plan');
  await page.waitForLoadState('networkidle', { timeout: 10_000 });
  assert.equal(harness.state.activeMeeting, null, 'fixture starts without an active meeting');
  await assertNoHorizontalOverflow(page, '1440x900 global plan');
  await capture(page, 'after-global-desktop.png');

  const planBox = page.getByRole('textbox', { name: /整体工作计划/ }).or(page.getByPlaceholder(/核实项目决策链/)).first();
  await waitVisible(planBox, 'overall work plan editor');
  await planBox.fill(planText);
  await clickButton(page, /提交计划/, 'submit overall work plan');
  await waitVisible(page.getByText(/房间状态已同步|状态已同步/), 'visible version-conflict recovery hint');
  assert.equal(harness.commands.filter((command) => command.type === 'work_plan').length, 1, 'first plan attempt is rejected by the mock conflict');
  await clickButton(page, /提交计划/, 'retry overall work plan');
  await waitUntil(() => harness.commands.filter((command) => command.type === 'work_plan').length === 2, 'work-plan retry');
  assert.equal(harness.commands[0].commandId, harness.commands[1].commandId, 'version-conflict retry preserves command ID');
  assert.equal(harness.commands[1].payload.content, planText, 'work-plan command sends its natural-language text');

  await clickButton(page, new RegExp(npcName), `${npcName} contact card`);
  await waitVisible(page.getByRole('heading', { name: /联系人概览|CONTACT OVERVIEW/ }), `${npcName} contact overview heading`);
  await assertNoHorizontalOverflow(page, '1440x900 contact overview');
  await capture(page, 'after-contact-desktop.png');
  for (const channel of ['邮件', '电话', '微信', '邮寄', '拜访']) {
    await waitVisible(page.getByRole('button', { name: new RegExp(channel) }).first(), `${channel} channel action`);
  }

  await clickButton(page, '电话', 'open work phone');
  await clickButton(page, '拨打工作电话', 'start a formal phone call');
  await waitUntil(() => harness.chatRequests.some((request) => request.intent === 'call_connect'), 'work-phone connection stream');
  assert.ok(harness.state.activePhoneCall?.npcId === npcId, 'mock phone connection persists activePhoneCall');
  assert.equal(harness.chatRequests.find((request) => request.intent === 'call_connect').channel, 'work_phone');
  await waitVisible(page.getByText('通话已接通', { exact: true }), 'connected work-phone state');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitVisible(page.getByText('通话已接通', { exact: true }), 'restored connected phone workspace after reload');
  await waitVisible(page.getByText('您好，我是张建国，您可以讲一下这次要确认的事项。'), 'restored phone greeting');
  assert.equal(harness.sessionReads.at(-1).activePhoneCall?.npcId, npcId, 'reload reads the active phone call from persisted fixture state');
  await capture(page, 'after-phone-restored-desktop.png');
  await clickButton(page, '← 总体计划', 'return from connected phone to the overall plan');
  await waitUntil(() => harness.commands.some((command) => command.type === 'end_phone_call'), 'end_phone_call request after leaving the active call');
  assert.equal(harness.state.activePhoneCall, null, `end_phone_call reducer should clear activePhoneCall: ${JSON.stringify({ command: harness.commands.find((command) => command.type === 'end_phone_call'), processedCommandIds: harness.state.processedCommandIds })}`);
  const endCallCommand = harness.commands.find((command) => command.type === 'end_phone_call');
  assert.ok(endCallCommand, 'returning to the global plan first submits end_phone_call');
  assert.equal(endCallCommand.payload.npcId, npcId);
  assert.notEqual(endCallCommand.commandId, harness.commands[0].commandId, 'the phone-end command has a distinct ID from the earlier conflict retry');
  await waitVisible(page.getByRole('heading', { name: '整体工作计划' }), 'global plan after ending phone call');
  assert.match(await page.locator('body').innerText(), /再次查看计划/, 'saved plan can be submitted again after ending the call');
  await clickButton(page, /再次查看计划/, 'verify the global-plan command succeeds after ending the call');
  await waitUntil(() => harness.commands.filter((command) => command.type === 'work_plan').length === 3, 'post-call work-plan command');
  await clickButton(page, new RegExp(npcName), `${npcName} contact card after call`);
  await waitVisible(page.getByRole('heading', { name: /联系人概览|CONTACT OVERVIEW/ }), `${npcName} contact overview after call`);

  await clickButton(page, '邮件', 'open email');
  const mailReadNoReply = page.getByText('历史邮件：请核对验收范围与交付责任。', { exact: true });
  await waitVisible(mailReadNoReply, 'restored historical email');
  await waitVisible(page.getByText('已读', { exact: true }).first(), 'restored read-no-reply metadata');
  await fillAndSend(page, '请查看本次整理的验收边界。', emailAttachmentText);
  await waitUntil(() => harness.chatRequests.filter((request) => request.channel === 'email').length === 1, 'email send');
  const emailRequest = harness.chatRequests.find((request) => request.channel === 'email');
  assert.equal(emailRequest.message, '请查看本次整理的验收边界。');
  assert.deepEqual(emailRequest.attachments, [{ fileName: '邮件附件说明', description: emailAttachmentText }], 'email attachment is one natural-language description');
  await waitVisible(page.getByText('请查看本次整理的验收边界。', { exact: true }), 'sent email and composer state');
  await capture(page, 'after-email-desktop.png');
  await waitVisible(page.getByText('请查看本次整理的验收边界。', { exact: true }), 'sent email and composer state');
  await capture(page, 'after-email-desktop.png');

  const beforeWechatClick = harness.commands.filter((command) => command.type === 'request_wechat').length;
  await clickButton(page, /微信/, 'open WeChat request page');
  await waitVisible(page.getByLabel('申请说明（用自己的话说明添加工作微信的原因）'), 'natural-language WeChat application field');
  assert.equal(harness.commands.filter((command) => command.type === 'request_wechat').length, beforeWechatClick, 'opening WeChat does not send a request');
  await page.getByLabel('申请说明（用自己的话说明添加工作微信的原因）').fill(applicationText);
  await clickButton(page, '提交微信申请', 'submit WeChat application');
  await waitUntil(() => harness.commands.some((command) => command.type === 'request_wechat'), 'WeChat request command');
  const wechatCommand = harness.commands.find((command) => command.type === 'request_wechat');
  assert.equal(wechatCommand.payload.message, applicationText, 'application uses the player-authored natural-language reason');
  assert.equal(harness.state.npcContacts[npcId].wechatStatus, 'accepted', 'fixture command produces an accepted result via the real reducer');
  await waitVisible(page.getByRole('button', { name: '😊 Emoji', exact: true }), 'Emoji picker control');
  await waitVisible(page.getByText('历史微信：补充了交付边界清单，方便您有空时查看。', { exact: true }), 'restored historical WeChat message');
  await waitVisible(page.getByText('已读', { exact: true }).last(), 'restored WeChat read-no-reply metadata');

  await clickButton(page, '😊 Emoji', 'open Emoji picker');
  await clickButton(page, '插入 😊', 'insert preset Emoji');
  await fillAndSend(page, '😊', wechatAttachmentText);
  await waitUntil(() => harness.chatRequests.filter((request) => request.channel === 'online').length === 1, 'WeChat send with Emoji and attachment');
  const wechatRequest = harness.chatRequests.find((request) => request.channel === 'online');
  assert.equal(wechatRequest.message, '😊');
  assert.deepEqual(wechatRequest.attachments, [{ fileName: '微信附件说明', description: wechatAttachmentText }], 'WeChat attachment is one natural-language description');
  await waitVisible(page.getByText('😊', { exact: true }).last(), 'sent Emoji and WeChat composer state');
  await capture(page, 'after-wechat-desktop.png');
  await waitVisible(page.getByText('😊', { exact: true }).last(), 'sent Emoji and WeChat composer state');
  await capture(page, 'after-wechat-desktop.png');

  const visitButton = page.getByRole('button', { name: '拜访', exact: true });
  await waitVisible(visitButton, 'visit channel action');
  await visitButton.click();
  await waitVisible(page.getByText('当前没有已接受的预约。直接登门存在关系风险；继续后可先做准备，再由正式服务确认能否开始拜访。'), 'unbooked visit risk warning');
  await clickButton(page, '继续拜访', 'confirm the visit warning');
  const prepEditor = page.getByLabel('你的拜访前准备');
  await waitVisible(prepEditor, 'visit preparation editor');
  await assertNoHorizontalOverflow(page, '1440x900 visit preparation');
  await capture(page, 'after-preparation-desktop.png');
  await prepEditor.fill(preparationText);
  await clickButton(page, '保存并选择拜访方式', 'save visit preparation');
  await waitUntil(() => harness.commands.some((command) => command.type === 'prepare'), 'visit preparation command');
  const preparationCommand = harness.commands.find((command) => command.type === 'prepare');
  assert.equal(preparationCommand.payload.content, preparationText);
  assert.equal(harness.state.preparations.at(-1).costPoints, 0, 'formal preparation is free in the synchronized flow');

  await clickButton(page, '简述拜访方案', 'open visit-brief entry');
  const briefEditor = page.getByRole('textbox', { name: /拜访方案|方案描述/ }).or(page.getByPlaceholder(/如何开场/)).first();
  await waitVisible(briefEditor, 'natural-language visit brief editor');
  const briefText = '先了解客户现有流程与验收责任，再用一页对照清单说明可验证的改进点，最后确认技术交流的参与人和时间。';
  await briefEditor.fill(briefText);
  await clickButton(page, '提交拜访方案 · 2行动点', 'submit visit brief');
  await waitUntil(() => harness.commands.some((command) => command.type === 'brief_visit'), 'visit brief command');
  const briefCommand = harness.commands.find((command) => command.type === 'brief_visit');
  assert.equal(briefCommand.payload.content, briefText, 'visit brief payload preserves the natural-language plan');
  assert.equal(harness.state.visitBriefs.at(-1).costPoints, 2);

  await waitVisible(page.getByRole('heading', { name: /拜访方案评估/ }), 'visit brief result');
  await clickButton(page, '返回联系人概览', 'return from brief result to contact overview');
  await clickButton(page, '拜访', 'reopen the visit flow after the brief');
  await clickButton(page, '返回拜访准备', 'reopen saved visit preparation before an explicit skip');
  await waitVisible(page.getByLabel('你的拜访前准备'), 'preparation page before explicit skip');
  await clickButton(page, '跳过准备', 'explicitly skip preparation before the actual visit');
  await clickButton(page, '实际模拟 · 3行动点', 'start actual visit after explicit preparation skip');
  await waitUntil(() => harness.commands.some((command) => command.type === 'start_visit'), 'start actual visit command');
  assert.ok(harness.state.activeMeeting, 'reducer result restores a formal activeMeeting');
  assert.equal(harness.commands.find((command) => command.type === 'start_visit').payload.preparationIds.length, 0, 'the explicit skip starts without assigning previously saved preparation');
  await waitVisible(page.getByRole('region', { name: new RegExp(`与${npcName}的沉浸式拜访`) }), 'active meeting screen');
  await assertNoHorizontalOverflow(page, '1440x900 active meeting');
  await capture(page, 'after-meeting-desktop.png');
  const meetingComposer = page.getByPlaceholder('输入你想说的话；也可以直接表达告辞…');
  await waitVisible(meetingComposer, 'active meeting composer');
  await meetingComposer.fill('今天先按准备好的验收范围逐项确认，后续我再整理成书面清单。');
  await meetingComposer.press('Enter');
  await waitUntil(() => harness.chatRequests.some((request) => request.channel === 'offline'), 'NPC farewell stream');
  assert.equal(harness.state.activeMeeting.awaitingFinalReplyFrom, 'player', 'NPC farewell leaves the meeting open for one final player reply');
  await waitVisible(page.getByText('客户已表示告辞，请回复最后一句后结束拜访。'), 'NPC farewell notice');
  await waitVisible(page.getByPlaceholder('输入最后一句回应…'), 'farewell final-reply composer');
  await capture(page, 'after-farewell-desktop.png');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitVisible(page.getByRole('region', { name: new RegExp(`与${npcName}的沉浸式拜访`) }), 'restored activeMeeting after page reload');
  await waitVisible(page.getByText('今天先聊到这里。感谢你把验收范围讲清楚，后续有进展我们再保持沟通。'), 'restored NPC farewell message');
  await waitVisible(page.getByText('客户已表示告辞，请回复最后一句后结束拜访。'), 'restored farewell state');
  assert.equal(harness.sessionReads.at(-1).npcExpressions[npcId], 'pleasant', 'reload restores the pleasant expression derived from the saved NPC attitude');
  await capture(page, 'after-farewell-restored-desktop.png');
  const finalReply = page.getByPlaceholder('输入最后一句回应…');
  await finalReply.fill('好的，感谢今天的交流，我按刚才确认的范围整理后再联系您。');
  await clickButton(page, '回应并结束', 'send the one permitted final reply');
  await waitUntil(() => harness.state.activeMeeting === null, 'reducer to close meeting after the final reply');
  assert.equal(harness.chatRequests.at(-1).message, '好的，感谢今天的交流，我按刚才确认的范围整理后再联系您。');
  assert.equal(harness.messages.at(-1).role, 'user', 'the final player acknowledgement is persisted without a fabricated NPC reply');
  assert.equal(harness.streamEvents.at(-1).responseAction, 'final_player_reply', 'mock SSE mirrors the formal final-player response action');
  assert.equal(harness.chatRequests.filter((request) => request.channel === 'offline').length, 2, 'NPC farewell and player acknowledgement produce exactly two offline turns');
  assert.equal(harness.sessionReads.at(-1).npcExpressions[npcId], 'pleasant');
  assert.ok(pageErrors.length === 0, `browser page errors: ${pageErrors.join('; ')}`);
  assert.ok(!harness.unhandledApiPaths?.size, `unclassified mock API endpoints: ${[...(harness.unhandledApiPaths || [])].join(', ')}`);
  await context.close();
  return { harness, pageErrors };
}

async function verifyMobile(browser) {
  const harness = createHarness();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await context.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('weixun_session', 'formal-sync-ui-fixture-token');
    localStorage.setItem('weixun_identity', JSON.stringify({ role: 'platform_designer', displayName: '正式同步验收' }));
  });
  await context.route('**/api/**', harness.route);
  const page = await context.newPage();
  page.on('pageerror', (error) => browserDiagnostics.push(`mobile pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') browserDiagnostics.push(`mobile console.error: ${message.text()}`);
  });
  page.on('requestfailed', (request) => {
    const url = new URL(request.url());
    browserDiagnostics.push(`mobile requestfailed: ${request.method()} ${url.pathname} (${request.failure()?.errorText || 'unknown'})`);
  });
  await page.goto(`${baseUrl}/game?location=project-1&mode=solo&sessionId=${sessionId}`, { waitUntil: 'domcontentloaded' });
  await waitVisible(page.getByRole('heading', { name: '整体工作计划' }), 'mobile overall work plan');
  await page.waitForLoadState('networkidle', { timeout: 10_000 });
  await assertNoHorizontalOverflow(page, '390x844 global plan');
  await capture(page, 'after-global-mobile.png');
  await clickButton(page, new RegExp(npcName), `mobile ${npcName} contact card`);
  await waitVisible(page.getByRole('heading', { name: /联系人概览|CONTACT OVERVIEW/ }), 'mobile contact overview heading');
  await assertNoHorizontalOverflow(page, '390x844 contact overview');
  await assertMobileColumnFlow(page, '390px contact overview');
  for (const channel of ['邮件', '电话', '微信', '邮寄', '拜访']) {
    await waitVisible(page.getByRole('button', { name: new RegExp(channel) }).first(), `mobile ${channel} action`);
  }
  await capture(page, 'after-contact-mobile.png');
  await context.close();
  return harness;
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  });
  try {
    if (process.env.FORMAL_SYNC_MOBILE_ONLY === '1') {
      const mobile = await verifyMobile(browser);
      assert.equal(mobile.state.activeMeeting, null);
      console.log(`mock mobile browser checks passed against ${baseUrl}`);
      console.log('Coverage: 390x844 overall plan/contact overview, channel actions, image readiness, and horizontal overflow.');
      console.log('This harness does not validate the real database or AI/model behavior.');
      if (browserDiagnostics.length) console.log(`Browser diagnostics to review:\n${browserDiagnostics.join('\n')}`);
      return;
    }
    const desktop = await prepareDesktopFlow(browser);
    const mobile = await verifyMobile(browser);
    const requestTypes = desktop.harness.commands.map((command) => command.type);
    for (const required of ['work_plan', 'request_wechat', 'prepare', 'brief_visit', 'start_visit']) {
      assert.ok(requestTypes.includes(required), `mock backend must receive ${required}`);
    }
    assert.equal(mobile.state.activeMeeting, null);
    console.log(`mock browser sync checks passed against ${baseUrl}`);
    console.log('Coverage: reducer-backed commands, retry/version conflict, read-no-reply metadata, attachments, Emoji, meeting/farewell restore, and desktop/mobile overflow.');
    if (browserDiagnostics.length) console.log(`Browser diagnostics to review:\n${browserDiagnostics.join('\n')}`);
    console.log('This harness does not validate the real database or AI/model behavior.');
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'formal sync browser check failed');
  if (browserDiagnostics.length) console.error(`Browser diagnostics:\n${browserDiagnostics.join('\n')}`);
  process.exitCode = 1;
});
