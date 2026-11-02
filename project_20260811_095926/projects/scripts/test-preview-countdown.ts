import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

const html = readFileSync(resolve(process.cwd(), 'public/project1-prototype-v9.html'), 'utf8');
const source = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)?.[1];
assert.ok(source, '预览页缺少应用脚本');
const end = source.lastIndexOf('})();');
assert.notEqual(end, -1, '预览页 IIFE 不完整');

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
  removeItem(key: string) { this.values.delete(key); }
}

let now = 1_700_000_000_000;
class ClockDate extends Date {
  static override now() { return now; }
}

const localStorage = new MemoryStorage();
localStorage.setItem('weixun_identity', JSON.stringify({ userId: 'timer-test-user' }));
localStorage.setItem('weixun_session', 'timer-test-token');
const app = { innerHTML: '' };
const modalRoot = { innerHTML: '', querySelectorAll: () => [], querySelector: () => null };
const testInputs = new Map<string, { value: string }>();
const document = {
  hidden: false,
  body: { appendChild: () => undefined },
  getElementById(id: string) { return testInputs.get(id) ?? (id === 'app' ? app : id === 'modal-root' ? modalRoot : id === 'toast-root' ? { appendChild: () => undefined } : null); },
  querySelectorAll: () => [], querySelector: () => null,
  createElement: () => ({ className: '', textContent: '', remove: () => undefined }),
  addEventListener: () => undefined,
};
const injected = `${source.slice(0, end)}
globalThis.__timerHooks={
 snapshot:()=>JSON.parse(JSON.stringify(state.timer)),
 set:(points,elapsed=0)=>{state.screen='game';state.actionPoints=points;state.timer={...freshTimer(),started:true,elapsedMs:elapsed,lastResumedAt:Date.now(),refillsApplied:Math.floor(elapsed/TIMER_REFILL_INTERVAL_MS)}},
 sync:at=>syncCountdown(at), pause:()=>pauseCountdown(), resume:turns=>resumeCountdown(turns), points:()=>state.actionPoints, remaining:()=>remainingCountdownMs(),
  applyActivities:(tasks,serverNow)=>applyPreviewCustomerActivities({version:1,tasks,serverNow},serverNow),
  normalizeTimer:()=>{state.timer=normalizeTimer(JSON.parse(JSON.stringify(state.timer)),state.meeting);return JSON.parse(JSON.stringify(state.timer))},
 project:()=>{state=initialState();state.screen='projects'}, start:at=>startCountdown(at), finalize:()=>finalizePreview('timeout'), screen:()=>state.screen,
 prepareLate:()=>{let aborted=false;state.screen='game';state.timer={...freshTimer(),started:true,expired:true};state.aiRetry={action:'plan',commandId:'late-command',payload:{text:'late'},kind:'plan',meta:null};requestBusy=true;activeRequestSerial=41;activeRequestController={abort:()=>{aborted=true}};return ()=>({aborted,serial:activeRequestSerial,busy:requestBusy,retry:state.aiRetry,screen:state.screen})},
 testControls:async(meeting=false)=>{state=initialState();state.screen='game';state.meeting=meeting?{npcId:'P1-004',turn:0,messages:[],completedTasks:[]}:null;state.timer={...freshTimer(),started:true,lastResumedAt:Date.now()};customerActivityModalLocked=false;requestBusy=false;await applyTestControls()},
 applyTestControlsCurrent:async()=>{customerActivityModalLocked=false;requestBusy=false;await applyTestControls()},
 prepareActivityTimer:(task,marker=true,paused=false)=>{state=initialState();state.screen='game';state.customerActivities={version:1,tasks:[task]};state.timer={...freshTimer(),started:true,paused,lastResumedAt:paused?null:Date.now(),customerActivityTaskId:marker?task.id:null,customerActivityPhase:marker?'resumed':null};customerActivityModalLocked=false;requestBusy=false;},
 setTimer:timer=>{state.timer={...freshTimer(),...timer}}, setMeeting:meeting=>{state.meeting=meeting?{npcId:'P1-004',turn:0,messages:[],completedTasks:[]}:null}, setSeen:ids=>{customerActivitySeenIds=new Set(ids)}, continueActivity:task=>continueCustomerActivity(task),
};
})();`;
const context = vm.createContext({
  console, document, localStorage, sessionStorage: new MemoryStorage(),
  window: { matchMedia: () => ({ matches: false }), addEventListener: () => undefined },
  fetch: async () => ({ ok: false, json: async () => ({}) }), AbortController, TextDecoder, TextEncoder, URL, Event, Math, Date: ClockDate,
  crypto: { randomUUID: () => 'timer-command-id' }, setTimeout: () => 0, clearTimeout: () => undefined, setInterval: () => 0, clearInterval: () => undefined,
  requestAnimationFrame: () => 0, performance: { now: () => 0 },
});
vm.runInContext(injected, context, { filename: 'project1-prototype-v9.timer.js' });
const hooks = vm.runInContext('globalThis.__timerHooks', context) as {
  snapshot: () => { elapsedMs: number; paused: boolean; expired: boolean; settled: boolean; customerActivityTaskId: string | null; customerActivityPhase: string | null; customerActivityUiTaskId: string | null }; set: (points: number, elapsed?: number) => void;
  sync: (at: number) => boolean; pause: () => void; resume: (turns: number) => boolean; points: () => number; remaining: () => number;
  applyActivities: (tasks: Array<Record<string, unknown>>, serverNow: number) => boolean;
  normalizeTimer: () => { elapsedMs: number; paused: boolean; customerActivityTaskId: string | null; customerActivityPhase: string | null };
  project: () => void; start: (at: number) => void; finalize: () => void; screen: () => string;
  prepareLate: () => () => { aborted: boolean; serial: number; busy: boolean; retry: unknown; screen: string };
  testControls: (meeting?: boolean) => Promise<void>; applyTestControlsCurrent: () => Promise<void>;
  prepareActivityTimer: (task: Record<string, unknown>, marker?: boolean, paused?: boolean) => void;
  setTimer: (timer: Record<string, unknown>) => void; setMeeting: (meeting: boolean) => void; setSeen: (ids: string[]) => void; continueActivity: (task: Record<string, unknown>) => void;
};

hooks.project();
hooks.sync(now + 10 * 60_000);
hooks.start(now + 10 * 60_000);
assert.equal(hooks.remaining(), 20 * 60_000, '停留在项目选择页不会消耗项目时间');

hooks.set(20);
hooks.sync(now + 5 * 60_000);
assert.equal(hooks.points(), 25, '5 分钟补充 5 点行动点');
hooks.sync(now + 15 * 60_000);
assert.equal(hooks.points(), 28, '跨多个恢复点仍受 28 点上限限制');

hooks.set(12, 4 * 60_000);
hooks.pause();
now += 10 * 60_000;
hooks.sync(now);
assert.equal(hooks.snapshot().elapsedMs, 4 * 60_000, '拜访暂停时不累计真实时间');
assert.equal(hooks.resume(4), false, '4 轮扣 60 秒后尚未超时');
assert.equal(hooks.snapshot().elapsedMs, 5 * 60_000, '拜访结束按每轮 15 秒扣时');
assert.equal(hooks.points(), 17, '扣时跨 5 分钟恢复点后补充 5 点');

hooks.set(24, 19 * 60_000 + 45_000);
assert.equal(hooks.resume(1), true, '第 20 分钟的最后一轮扣时触发超时');
assert.equal(hooks.snapshot().expired, true, '超时状态持久化');
assert.equal(hooks.remaining(), 0, '超时后剩余时间为零');

hooks.set(28);
hooks.finalize();
assert.equal(hooks.screen(), 'result', '统一结算收口进入结果页，后续异步响应不能回到游戏页面');

const lateStatus = hooks.prepareLate();
hooks.finalize();
const settledLate = lateStatus();
assert.equal(settledLate.aborted, true, '超时统一结算取消延迟 AI 请求');
assert.equal(settledLate.serial, 42, '超时统一结算使延迟请求上下文失效');
assert.equal(settledLate.busy, false, '超时统一结算释放请求忙碌态');
assert.equal(settledLate.retry, null, '超时统一结算清理重试状态');
assert.equal(settledLate.screen, 'result', '超时统一结算保留结果页');

async function verifyCustomerActivityTimerRecovery() {
 const pending = { id: 'activity-one', type: 'technical_meeting', status: 'pending', createdAt: now, summary: '活动提议已匹配' };
 hooks.set(28, 3 * 60_000);
 hooks.applyActivities([pending], now);
 assert.equal(hooks.snapshot().paused, true, '匹配后的待确认弹窗暂停项目倒计时');
 now += 20 * 60_000;
 hooks.sync(now);
 assert.equal(hooks.snapshot().elapsedMs, 3 * 60_000, '待确认弹窗停留二十分钟不扣项目时间');

 const planning = { ...pending, status: 'planning', startedAt: now, deadlineAt: now + 5 * 60_000 };
 hooks.applyActivities([planning], now);
 now += 5 * 60_000;
 hooks.sync(now);
 assert.equal(hooks.snapshot().elapsedMs, 3 * 60_000, '五分钟活动策划期间不扣项目时间');

 const waiting = { ...planning, status: 'submitted', submittedAt: now };
 hooks.applyActivities([waiting], now);
 now += 20 * 60_000;
 hooks.sync(now);
 assert.equal(hooks.snapshot().elapsedMs, 3 * 60_000, '提交后的评估等待不扣项目时间');

 const result = { ...waiting, evaluation: { overallEvaluation: '总体评价' } };
 hooks.applyActivities([result], now);
 now += 20 * 60_000;
 hooks.sync(now);
 assert.equal(hooks.snapshot().elapsedMs, 3 * 60_000, '结果弹窗未确认前不扣项目时间');
 hooks.continueActivity(result);
 assert.equal(hooks.snapshot().paused, false, '确认最后一项结果后恢复项目倒计时');
 now += 10_000;
 hooks.sync(now);
 assert.equal(hooks.snapshot().elapsedMs, 3 * 60_000 + 10_000, '关闭最后结果后只扣新的十秒');

 const queued = { id: 'activity-two', type: 'company_visit', status: 'pending', createdAt: now };
 hooks.applyActivities([result, queued], now);
 hooks.continueActivity(result);
 assert.equal(hooks.snapshot().paused, true, '第一项确认后下一项活动无间隙地继续暂停');
 now += 20 * 60_000;
 hooks.sync(now);
 assert.equal(hooks.snapshot().elapsedMs, 3 * 60_000 + 10_000, '队列下一项活动等待期间不扣项目时间');

 const stalePending = { id: 'stale-pending', type: 'technical_meeting', status: 'pending', createdAt: now - 20 * 60_000 };
 hooks.setTimer({ started: true, elapsedMs: 2 * 60_000, lastResumedAt: now - 30 * 60_000 });
 hooks.setSeen([]);
 hooks.applyActivities([stalePending], now);
 assert.equal(hooks.snapshot().elapsedMs, 12 * 60_000, '刷新恢复缺少暂停标记时最多补扣到活动创建时刻');
 assert.equal(hooks.snapshot().paused, true, '刷新恢复的未读活动仍暂停');
 hooks.normalizeTimer();
 now += 20 * 60_000;
 hooks.applyActivities([stalePending], now);
 assert.equal(hooks.snapshot().elapsedMs, 12 * 60_000, '离线未读活动刷新后保持冻结');

 const historical = { ...result, id: 'seen-history', createdAt: now - 30 * 60_000 };
 hooks.setTimer({ started: true, elapsedMs: 2 * 60_000, lastResumedAt: now });
 hooks.setSeen([historical.id]);
 hooks.applyActivities([historical], now);
 assert.equal(hooks.snapshot().paused, false, '已确认的历史活动不会冻结项目倒计时');
 now += 10_000;
 hooks.sync(now);
 assert.equal(hooks.snapshot().elapsedMs, 2 * 60_000 + 10_000, '已确认历史活动仍正常计时');

 const futurePending = { id: 'future-pending', type: 'technical_meeting', status: 'pending', createdAt: now + 30 * 60_000 };
 hooks.setTimer({ started: true, elapsedMs: 2 * 60_000, lastResumedAt: now - 10_000 });
 hooks.setSeen([]);
 hooks.applyActivities([futurePending], now);
 assert.equal(hooks.snapshot().elapsedMs, 2 * 60_000 + 10_000, '未来的活动创建时间不会让恢复锚点越过当前时刻');

 testInputs.set('test-remaining-seconds', { value: '600' });
 testInputs.set('test-action-points', { value: '20' });
 testInputs.set('test-total-spent', { value: '3' });
 await hooks.applyTestControlsCurrent();
 assert.equal(hooks.snapshot().customerActivityUiTaskId, futurePending.id, '测试调节保留未读活动的界面暂停标记');
 assert.equal(hooks.snapshot().paused, true, '测试调节不会解除未读活动的暂停');

 const visitPending = { ...pending, id: 'visit-pending', createdAt: now };
 hooks.setTimer({ started: true, elapsedMs: 2 * 60_000, paused: true, lastResumedAt: null });
 hooks.setMeeting(true);
 hooks.setSeen([]);
 hooks.applyActivities([visitPending], now);
 hooks.resume(3);
 assert.equal(hooks.snapshot().elapsedMs, 2 * 60_000 + 45_000, '拜访结束仍结算对话轮次扣时');
 assert.equal(hooks.snapshot().paused, true, '拜访结束后未读活动仍保持暂停');

 hooks.setTimer({ started: true, elapsedMs: 20 * 60_000, expired: true, lastResumedAt: now });
 hooks.setMeeting(false);
 hooks.applyActivities([visitPending], now);
 assert.equal(hooks.snapshot().expired, true, '已超时倒计时不会被活动暂停复活');
}

async function verifyTestControls() {
  testInputs.set('test-remaining-seconds', { value: '600' });
  testInputs.set('test-action-points', { value: '20' });
  testInputs.set('test-total-spent', { value: '3' });
  await hooks.testControls();
  assert.equal(hooks.remaining(), 600_000, '应用测试值设置指定剩余时间');
  now += 10_000;
  hooks.sync(now);
  assert.equal(hooks.remaining(), 590_000, '应用测试值后倒计时继续走，不能退回未开始状态');
  hooks.normalizeTimer();
  now += 10_000;
  hooks.sync(now);
  assert.equal(hooks.remaining(), 580_000, '测试调值后的计时状态经刷新归一化仍继续走');
  await hooks.testControls(true);
  now += 10_000;
  hooks.sync(now);
  assert.equal(hooks.remaining(), 600_000, '拜访中应用测试值仍保持暂停');
  hooks.resume(0);
  now += 10_000;
  hooks.sync(now);
  assert.equal(hooks.remaining(), 590_000, '拜访结束后恢复调值后的倒计时');
  console.log('五人预览倒计时、测试调节、补点、拜访扣时及活动暂停恢复幂等回归通过');
}
void verifyCustomerActivityTimerRecovery().then(verifyTestControls).catch((error: unknown) => { console.error(error); process.exitCode = 1; });
