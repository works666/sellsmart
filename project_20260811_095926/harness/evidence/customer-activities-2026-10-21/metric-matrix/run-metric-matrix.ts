import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { decideCustomerActivityFeasibility } from '@/lib/ai/customer-activities';
import { invokeConfiguredJev } from '@/lib/ai/jev-designer-config';
import { invokeJev } from '@/lib/ai/jev-client';
import type { ActivityDecisionConfig, CustomerActivityProposalCandidate, CustomerActivityRelationshipSnapshot, CustomerActivityType } from '@/lib/game/customer-activities';

const outputDir = resolve(process.cwd(), '../harness/evidence/customer-activities-2026-10-21/metric-matrix');
const requireProject = createRequire(resolve(process.cwd(), 'package.json'));
const dotenv = requireProject('dotenv') as typeof import('dotenv');
dotenv.config({ path: resolve(process.cwd(), '.env.local'), quiet: true });
mkdirSync(outputDir, { recursive: true });

type MatrixPoint = { support: number; pleasantness: number };
type Captured = { request: unknown; response: unknown };

const points: MatrixPoint[] = [
  { support: 0, pleasantness: 10 }, { support: 0, pleasantness: 50 }, { support: 0, pleasantness: 90 },
  { support: 50, pleasantness: 50 }, { support: 90, pleasantness: 10 }, { support: 90, pleasantness: 90 },
];
const activityText: Record<CustomerActivityType, string> = {
  technical_meeting: '邀请贵司技术团队参加一次技术交流会，围绕采购项目的实施方案、接口和风险控制进行沟通。',
  case_site_visit: '邀请您和相关同事考察一个已落地的同类客户现场，了解实际运行效果和项目经验。',
  company_visit: '邀请您和相关同事到我司参观，与交付和产品团队交流采购项目的保障安排。',
};
const reply = '这件事我还需要考虑一下，内部商量后再答复。';

function candidate(type: CustomerActivityType, id: string): CustomerActivityProposalCandidate {
  const proposal = activityText[type];
  return {
    conversationId: `metric-matrix-${id}`, npcId: 'P1-001', type, initiator: 'sales',
    proposalMessageId: `${id}-proposal`, responseMessageId: `${id}-response`, finalOutcomeMessageId: `${id}-response`,
    responseKind: 'ambiguous', finalStatus: 'active', requiresFeasibility: true,
    sourceConversation: [
      { messageId: `${id}-proposal`, speaker: 'sales', text: proposal },
      { messageId: `${id}-response`, speaker: 'customer', text: reply },
    ],
    evidence: [
      { messageId: `${id}-proposal`, speaker: 'sales', kind: 'proposal', quote: proposal },
      { messageId: `${id}-response`, speaker: 'customer', kind: 'response', quote: reply },
      { messageId: `${id}-response`, speaker: 'customer', kind: 'final_outcome', quote: reply },
    ],
    summary: `销售提议${type}，客户作模糊回应。`,
  };
}

function snapshot(support: number, pleasantness: number): CustomerActivityRelationshipSnapshot {
  return {
    npcId: 'P1-001', role: '高层角色', title: '副总经理', context: '采购项目背景：正在评估解决方案和供应商，需兼顾实施风险与内部意见。', stage: '采购评估',
    support, pleasantness,
    dimensions: { decisionAnalysis: 0, relationshipBuilding: 0, valuePresentation: 0, objectionHandling: 0, informationDiscovery: 0 },
  };
}

function writeJson(name: string, value: unknown) {
  writeFileSync(resolve(outputDir, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function errorRecord(error: unknown) {
  return error instanceof Error ? { name: error.name, message: error.message } : { name: 'UnknownError', message: String(error) };
}

async function runAiCase(type: CustomerActivityType, point: MatrixPoint, config: ActivityDecisionConfig) {
  const id = `${type}-s${point.support}-p${point.pleasantness}`;
  const captured: Captured = { request: null, response: null };
  try {
    const decision = await decideCustomerActivityFeasibility(candidate(type, id), snapshot(point.support, point.pleasantness), config, {
      jevInvoker: async (request) => {
        captured.request = request;
        const response = await invokeConfiguredJev('customer_activity_feasibility', request, invokeJev);
        captured.response = {
          model: response.model,
          usage: response.usage,
          answers: Object.fromEntries(Object.entries(response.answers).map(([key, answer]) => [key, answer.type === 'choice'
            ? { type: answer.type, choice: answer.choice, probabilities: answer.probabilities, confidence: answer.confidence }
            : answer])),
        };
        return response;
      },
    });
    const record = { id, type, support: point.support, pleasantness: point.pleasantness, status: 'ok', decision, captured };
    writeJson(`${id}.json`, record);
    return record;
  } catch (error) {
    const record = { id, type, support: point.support, pleasantness: point.pleasantness, status: 'error', error: errorRecord(error), captured };
    writeJson(`${id}.json`, record);
    return record;
  }
}

async function pool<T>(items: T[], max: number, work: (item: T) => Promise<unknown>) {
  let next = 0;
  const workers = Array.from({ length: max }, async () => {
    while (next < items.length) await work(items[next++]);
  });
  await Promise.all(workers);
}

async function main() {
  const numericConfig: ActivityDecisionConfig = { revision: 1, mode: 'numeric', thresholds: {
    technical_meeting: { supportMin: 50, pleasantnessMin: 50 }, case_site_visit: { supportMin: 50, pleasantnessMin: 50 }, company_visit: { supportMin: 50, pleasantnessMin: 50 },
  }};
  const numericPoints: MatrixPoint[] = [{ support: 49, pleasantness: 50 }, { support: 50, pleasantness: 49 }, { support: 50, pleasantness: 50 }, { support: 51, pleasantness: 51 }];
  const numericRows = await Promise.all((Object.keys(activityText) as CustomerActivityType[]).flatMap((type) => numericPoints.map(async (point) => ({
    type, ...point, decision: await decideCustomerActivityFeasibility(candidate(type, `numeric-${type}-s${point.support}-p${point.pleasantness}`), snapshot(point.support, point.pleasantness), numericConfig),
  }))));
  if (process.argv.includes('--numeric-only')) {
    writeJson('numeric-summary.json', {
      generatedAt: new Date().toISOString(),
      scope: 'Local numeric-threshold service decision test; no persisted-config read, database call, or AI request.',
      aiCalls: 0,
      numericConfig,
      numericRows,
    });
    writeJson('approval-blocked.json', {
      generatedAt: new Date().toISOString(), aiCalls: 0,
      status: 'blocked_pending_explicit_external_jev_permission',
      detail: 'Real JEV matrix was not run while explicit permission to send the synthetic fixed context to TypeSafe JEV is pending.',
    });
    return;
  }

  const { loadActivityDecisionConfig } = await import('@/lib/designer/customer-activity-config-repository');
  const stored = await loadActivityDecisionConfig();
  const config = stored.config;
  if (config.mode !== 'ai' || config.revision !== 2) throw new Error(`Expected persisted ai config revision 2; received ${config.mode} revision ${config.revision}`);
  const aiRows: unknown[] = [];
  const cases = (Object.keys(activityText) as CustomerActivityType[]).flatMap((type) => points.map((point) => ({ type, point })));
  await pool(cases, 2, async ({ type, point }) => { aiRows.push(await runAiCase(type, point, config)); });
  writeJson('summary.json', { generatedAt: new Date().toISOString(), scope: 'Synthetic fixed-context service decision test; not a browser end-to-end flow.', persistedActivityConfig: { mode: config.mode, revision: config.revision }, aiRows, numericConfig, numericRows });
}

main().catch((error) => { console.error(errorRecord(error)); process.exitCode = 1; });
