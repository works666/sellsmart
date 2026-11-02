import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const readSource = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const gamePage = readSource('../src/app/game/page.tsx');
const resultPage = readSource('../src/app/result/page.tsx');
const startPage = readSource('../src/app/start/page.tsx');
const stateModule = readSource('../src/lib/game/state.ts');

// The old competitor dialogs had state and JSX but no reachable opener. Keep
// competitor progress server-side and avoid carrying dead client fetch/UI code.
assert.doesNotMatch(gamePage, /showCompetitors|competitorEvent|competitorMeta|竞品实时竞争情况/);
assert.doesNotMatch(gamePage, /game-data\/competitors\?project_id=/);

// Result pages must speak the current five-stage/action-point language while
// the state module retains legacy time fields for persisted-save migration.
assert.doesNotMatch(resultPage, /累计投入|formatDuration|cumulativeTimeMinutes|totalInvestedMinutes/);
assert.match(resultPage, /label="阶段进度"/);
assert.match(resultPage, /state\.currentStage/);
assert.match(resultPage, /state\.maxStages/);
assert.match(resultPage, /label="行动点"/);
assert.match(resultPage, /cumulativeSpentPoints/);
assert.match(stateModule, /cumulativeTimeMinutes: number/);
assert.match(stateModule, /simulatedClockMinutes: number/);

// The start dialog must fit a 375px viewport, and the old hidden competitor
// table must not remain as dead markup or trigger a needless fetch.
assert.match(startPage, /flex items-center justify-center p-4/);
assert.match(startPage, /w-full max-w-\[620px\]/);
assert.doesNotMatch(startPage, /竞品公司特点表|game-data\/competitors|className="hidden mb-4/);

// Player-facing solo play must have exactly one authoritative client.  The
// HTML preview remains a design/test route, never an entry from /start.
assert.match(startPage, /router\.push\('\/game\?location=project-1&mode=solo'\)/);
assert.doesNotMatch(startPage, /router\.push\('\/project-one-preview'\)/);
assert.match(startPage, /单机 · 正式五人对局/);
assert.match(startPage, /客户沟通、阶段进度、行动点与最终结算将写入正式存档/);

console.log('legacy UI contracts passed');
