import {
  PROJECT_ONE_FIVE_PERSON_IDS,
  PROJECT_ONE_FIVE_PERSON_NPCS,
  type ProjectOneFivePersonId,
} from '@/lib/designer/project-one-five-person';
import type { SupplierProfile } from '@/lib/game/bid-rules';
export { BID_RULES, BID_RULE_PROPOSAL_COST } from '@/lib/game/bid-rules';
export type { BidRule, OverallSupportState, SupplierAdvantageType, SupplierProfile } from '@/lib/game/bid-rules';

export const PROJECT_ONE_CODE = 'project-1';
export const PROJECT_ONE_MAX_ROUNDS = 5;
export const PROJECT_ONE_INITIAL_ACTION_POINTS = 28;
/** Legacy time constants are retained only to read old saves. */
export const PROJECT_ONE_PHASE_DURATION_MS = 0;
export const PROJECT_ONE_DAY_START_MINUTE = 9 * 60;
export const PROJECT_ONE_STANDARD_DAY_MINUTES = 8 * 60;
export const PROJECT_ONE_WORK_END_MINUTE = 17 * 60;
export const PROJECT_ONE_OVERTIME_END_MINUTE = 19 * 60;
export const PROJECT_ONE_EVENING_END_MINUTE = 22 * 60;
export const PROJECT_ONE_PHASE_ACTION_POINT_GAIN = 8;
export const PROJECT_ONE_ACTION_POINT_CAP = 28;

export const PROJECT_ONE_PHASE_NAMES = [
  '初识建联',
  '信息摸底',
  '关系深化',
  '方案推动',
  '决策冲刺',
] as const;

export type ContactChannel = 'email' | 'work_phone' | 'wechat' | 'online' | 'offline';

export const PROJECT_ONE_COMMUNICATION_MINUTES = {
  wechat: 0,
  online: 0,
  email: 10,
  work_phone: 15,
  offline: 0,
} as const satisfies Record<ContactChannel, number>;

export const PROJECT_ONE_COMMUNICATION_POINTS = {
  wechat: 1,
  online: 1,
  email: 1,
  work_phone: 1,
  offline: 0,
} as const satisfies Record<ContactChannel, number>;

export const PROJECT_ONE_VISIT_RULES = {
  short: { durationMinutes: 5, maxTurns: 2 },
  formal: { durationMinutes: 40, maxTurns: 6 },
  informal: { durationMinutes: 60, maxTurns: 5 },
} as const;

export const PROJECT_ONE_PREPARATION_RULES = {
  visit_preparation: { timeMinutes: 0, costPoints: 0, reusable: true },
  /** Legacy save compatibility; new clients cannot create these types. */
  agenda: { timeMinutes: 0, costPoints: 1, reusable: true },
  ppt: { timeMinutes: 0, costPoints: 4, reusable: true },
  materials: { timeMinutes: 0, costPoints: 2, reusable: true },
  courtesy_gift: { timeMinutes: 0, costPoints: 3, reusable: false },
  boundary_gift: { timeMinutes: 0, costPoints: 8, reusable: false },
} as const;

export const PROJECT_ONE_PREPARATION_TITLES: Record<keyof typeof PROJECT_ONE_PREPARATION_RULES, string> = {
  visit_preparation: '拜访前准备',
  agenda: '历史准备记录',
  ppt: '历史方案材料',
  materials: '历史项目材料',
  courtesy_gift: '历史合规伴手礼',
  boundary_gift: '历史边界礼品',
};

export const PROJECT_ONE_PUBLIC_RESEARCH_RULE = {
  timeMinutes: 0,
  costPoints: 2,
} as const;

export interface ProjectOnePublicProfile {
  facts: string[];
  weakSignals: string[];
  sourceNote: string;
}

/**
 * Publicly obtainable information only. These records intentionally exclude
 * private interests, hidden attitudes, decision weights and win conditions.
 */
export const PROJECT_ONE_PUBLIC_PROFILES: Record<string, ProjectOnePublicProfile> = Object.fromEntries(
  PROJECT_ONE_FIVE_PERSON_IDS.map((npcId) => {
    const npc = PROJECT_ONE_FIVE_PERSON_NPCS[npcId];
    return [npcId, {
      facts: [...npc.facts],
      weakSignals: [...npc.clues],
      sourceNote: '项目一五人人物主档中的公开岗位与公开工作信息',
    } satisfies ProjectOnePublicProfile];
  }),
);

export type ProjectOneClue =
  | 'decision_process'
  | 'performance_goal'
  | 'procurement_priority'
  | 'personal_interest'
  | 'key_contact';

export interface ProjectOneNpc {
  id: string;
  projectId: 1;
  category: '高层' | '中层' | '一线';
  name: string;
  title: string;
  gender: string;
  age: number | null;
  hometown: string;
  personality: string;
  weakness: string;
  initiallyVisible: boolean;
  initialContactChannel: Extract<ContactChannel, 'email' | 'work_phone'>;
  initialSupport: number;
  decisionWeight: number;
  complianceSensitivity: number;
  actionPreferences: Partial<Record<string, number>>;
}

export const PROJECT_ONE_COMPETITORS = [
  {
    company_name: 'ABC竞品',
    features: '既有客情与价格竞争',
    more_info: '具体报价和项目动作需要在对局中继续收集。',
    project_id: 1,
  },
];

/** Private opening knowledge is deliberately asymmetric by company. */
export const PROJECT_ONE_COMPANY_PERSONAL_INFO: Record<string, Record<string, string[]>> = {
  'player-company': {
    'P1-004': ['我方曾在公开交流活动中与赵晓晨有过短暂接触，但不了解其项目态度。'],
  },
  'abc-company': {
    'P1-003': ['ABC曾参与王德福经手的另一项供应商材料核验，熟悉其对流程留痕和验收边界的重视。'],
    'P1-002': ['ABC通过既有客情知道李明辉更关注可量化、可验证的方案落地证据。'],
  },
};

/** 来源：项目内“各项目人物表.docx”的最新导入版本。 */
const FIVE_PERSON_RUNTIME_METADATA: Record<ProjectOneFivePersonId, Pick<
  ProjectOneNpc,
  'initialContactChannel' | 'complianceSensitivity' | 'actionPreferences'
>> = {
  'P1-001': { initialContactChannel: 'work_phone', complianceSensitivity: 85, actionPreferences: { roadshow: 3, visit: 2, video: 1, gift: -3, dinner: -2 } },
  'P1-002': { initialContactChannel: 'email', complianceSensitivity: 70, actionPreferences: { roadshow: 2, visit: 2, tea: 1, gift: -3 } },
  'P1-003': { initialContactChannel: 'email', complianceSensitivity: 90, actionPreferences: { sample: 2, video: 1, gift: -3, dinner: -2 } },
  'P1-004': { initialContactChannel: 'work_phone', complianceSensitivity: 60, actionPreferences: { tea: 2, festival: 1, gift: -1, roadshow: 1 } },
  'P1-005': { initialContactChannel: 'work_phone', complianceSensitivity: 55, actionPreferences: { tea: 2, festival: 1, gift: -1, dinner: 1 } },
};

const TOTAL_FIVE_PERSON_INFLUENCE = PROJECT_ONE_FIVE_PERSON_IDS.reduce(
  (sum, npcId) => sum + PROJECT_ONE_FIVE_PERSON_NPCS[npcId].influenceWeight,
  0,
);

/**
 * Formal project-one source of truth.  The legacy four-person list is
 * intentionally not retained as a compatibility path: old sessions are
 * deleted by the matching migration instead of being mapped to new people.
 */
export const PROJECT_ONE_NPCS: ProjectOneNpc[] = PROJECT_ONE_FIVE_PERSON_IDS.map((npcId) => {
  const person = PROJECT_ONE_FIVE_PERSON_NPCS[npcId];
  const metadata = FIVE_PERSON_RUNTIME_METADATA[npcId];
  return {
    id: person.id,
    projectId: 1,
    category: person.level,
    name: person.name,
    title: person.title,
    gender: '未提供',
    age: null,
    hometown: '未提供',
    personality: person.personality,
    weakness: person.coreNeeds.join('、'),
    initiallyVisible: true,
    initialContactChannel: metadata.initialContactChannel,
    initialSupport: person.initialSupport,
    decisionWeight: person.influenceWeight / TOTAL_FIVE_PERSON_INFLUENCE,
    complianceSensitivity: metadata.complianceSensitivity,
    actionPreferences: metadata.actionPreferences,
  };
});

/** Runtime supplier profiles; values are scenario data, not scoring branches. */
export const PROJECT_ONE_SUPPLIERS: SupplierProfile[] = [
  {
    id: 'player-company',
    name: '我方公司',
    advantageType: 'technical_accuracy',
    coreAdvantage: '技术精度领先',
    advantageValue: 88,
    preferredBidRule: 'technical_accuracy',
    baseCompetitivenessScore: 50,
    initialSupportByNpc: {},
  },
  {
    id: 'abc-company',
    name: 'ABC竞品',
    advantageType: 'price',
    coreAdvantage: '报价最低',
    advantageValue: 86,
    preferredBidRule: 'lowest_price',
    baseCompetitivenessScore: 54,
    initialSupportByNpc: Object.fromEntries(PROJECT_ONE_NPCS.map((npc) => [npc.id, 52])),
  },
  {
    id: 'xyz-company',
    name: 'XYZ竞品',
    advantageType: 'feature_completeness',
    coreAdvantage: '功能覆盖最全面',
    advantageValue: 84,
    preferredBidRule: 'feature_completeness',
    baseCompetitivenessScore: 53,
    initialSupportByNpc: Object.fromEntries(PROJECT_ONE_NPCS.map((npc) => [npc.id, 46])),
  },
];

export function getProjectOneSupplier(supplierId: string): SupplierProfile | null {
  return PROJECT_ONE_SUPPLIERS.find((supplier) => supplier.id === supplierId) ?? null;
}

export function getProjectOneNpc(npcId: string): ProjectOneNpc | null {
  return PROJECT_ONE_NPCS.find((npc) => npc.id === npcId) ?? null;
}
