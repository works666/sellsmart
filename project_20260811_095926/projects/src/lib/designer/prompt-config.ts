import { z } from 'zod';
import {
  DEFAULT_PROMPT_TEST_NPC_PROMPT_CONFIG,
  promptTestNpcPromptConfigSchema,
} from '@/lib/contracts/prompt-test';
import { CUSTOMER_PROMPT } from '@/lib/ai/prompts/customer';
import { NPC_NATURAL_DIALOGUE_RULES } from '@/lib/ai/prompts/npc-dialogue-rules';
import {
  PROJECT_ONE_NPC_ROLE_PROMPT_PROFILES,
} from '@/lib/designer/npc-role-prompts';
import {
  PROJECT_ONE_CHANNEL_MODIFIERS,
  PROJECT_ONE_NPC_CHANNEL_EXCEPTIONS,
  PROJECT_ONE_PROMPT_LAYERS,
} from '@/lib/designer/project-one-five-person';

const promptText = z.string().max(12_000, '单项提示词不能超过 12000 字');

export const NPC_SUPPORT_PROMPT_TIERS = ['low', 'medium', 'high'] as const;
export type NpcSupportPromptTier = (typeof NPC_SUPPORT_PROMPT_TIERS)[number];

export const DEFAULT_NPC_SUPPORT_TIER_THRESHOLDS = {
  mediumMin: 35,
  highMin: 70,
} as const;

export const npcSupportTierThresholdsSchema = z.object({
  mediumMin: z.number().int('中支持度门槛必须是整数。').min(1).max(99),
  highMin: z.number().int('高支持度门槛必须是整数。').min(2).max(100),
}).strict().refine((value) => value.highMin > value.mediumMin, {
  message: '高支持度门槛必须大于中支持度门槛。',
  path: ['highMin'],
});
export type NpcSupportTierThresholds = z.infer<typeof npcSupportTierThresholdsSchema>;

/**
 * A role prompt is stored as a base manuscript plus three support-specific
 * additions.  The string form is deliberately retained in the schema so
 * existing designer_prompt_configs records remain readable.
 */
export const npcRolePromptProfileSchema = z.object({
  base: promptText,
  low: promptText,
  medium: promptText,
  high: promptText,
}).strict();

export const npcRolePromptSchema = z.union([promptText, npcRolePromptProfileSchema]);
export type NpcRolePromptProfile = z.infer<typeof npcRolePromptProfileSchema>;
export type NpcRolePrompt = z.infer<typeof npcRolePromptSchema>;

const DEFAULT_SUPPORT_TIER_PROMPTS: Record<NpcSupportPromptTier, string> = {
  low: '保持谨慎和有限投入。只回应当前职责内最必要的内容；可要求补充可核验材料、转向正式渠道或简短收束。不得把礼貌当作推进承诺。',
  medium: '在职责范围内进行有限、务实的交流。可以接收材料、提出一项关键问题或说明正式下一步；不形成项目承诺，也不替其他岗位处理事项。',
  high: '在职责范围内表现出更明确的推进意愿。可以讨论下一项正式动作、需要补齐的依据或合适的协同对象；仍不越过信息边界，不承诺评审结果或中标。',
};

// Exact dual-FNV fingerprints of the five long manuscripts shipped before the
// concise-profile update, and their three automatically extracted tier lines.
// They let an old, untouched saved default upgrade on read without treating a
// designer's edited manuscript as a default. This read-time upgrade keeps old
// rows safe even when a remote database has not yet been rewritten.
const LEGACY_DEFAULT_PROMPT_FINGERPRINTS: Record<string, Record<NpcSupportPromptTier | 'base', readonly [hash: string, length: number]>> = {
  'P1-001': { base: ['93b04ce408fc37f4', 4110], low: ['e561e99e95660036', 40], medium: ['5fc76638dd0716ae', 64], high: ['1cb3bb2b40452d51', 67] },
  'P1-002': { base: ['26531f5dfa4358e9', 4258], low: ['4ea3511563a3f341', 43], medium: ['146d9d8aa4d59718', 37], high: ['0b991a4c3217da96', 68] },
  'P1-003': { base: ['6a7598332f2c0455', 4178], low: ['7a2e063cb5832372', 29], medium: ['c11df42ce70a5b00', 36], high: ['d2c908e556b6373b', 70] },
  'P1-004': { base: ['a9692aa09df9e9a2', 5030], low: ['d59e943a7a4b1756', 53], medium: ['3907b27580900d19', 57], high: ['9cc2d62298251c4c', 79] },
  'P1-005': { base: ['26cc2669262ded65', 4121], low: ['6e3caf4221ab7636', 33], medium: ['52b34c90b5dccea4', 34], high: ['1f09596f95c503c7', 66] },
};

// Exact fingerprints for the full five-person profiles that were built in on
// 2026-09-30, before the current wording refresh. The snapshot lives in the
// scripts fixture for regression coverage; runtime stores only these hashes.
const SEPTEMBER_30_DEFAULT_PROFILE_FINGERPRINTS: Record<string, Record<NpcSupportPromptTier | 'base', readonly [hash: string, length: number]>> = {
  'P1-001': { base: ['cea5f490b1313682', 426], low: ['4521cee515b778d9', 968], medium: ['0d0184bb820b6caf', 980], high: ['7950c92adc02594e', 992] },
  'P1-002': { base: ['ac15a68587813af7', 427], low: ['d279f2142024d34e', 927], medium: ['a6662163a80d4419', 929], high: ['410a6185abe4f181', 943] },
  'P1-003': { base: ['e50be374e54d498e', 406], low: ['c411ca09f4eea53b', 889], medium: ['837a8148e29c9cd6', 918], high: ['349626f2129df40a', 938] },
  'P1-004': { base: ['536c04e9d69354d9', 412], low: ['c59876940abfe502', 923], medium: ['9af88c038b1fd3d3', 933], high: ['99b99aefe84c5507', 958] },
  'P1-005': { base: ['0cedbb925f54668e', 406], low: ['4fd0381d3bd2d1bd', 912], medium: ['252378dae0b30eae', 930], high: ['a1adcc77f7a873c7', 944] },
};

// Snapshot of the complete 2026-10-08 profiles before their personality
// examples and catchphrases were revised. Keep all four field fingerprints so
// any designer edit prevents the automatic upgrade.
const OCTOBER_08_PRE_REFRESH_PROFILE_FINGERPRINTS: Record<string, Record<NpcSupportPromptTier | 'base', readonly [hash: string, length: number]>> = {
  'P1-001': { base: ['4c8c315ab4dfdb16', 508], low: ['2afd4308d5435f40', 1218], medium: ['ce7c39e7f7840773', 1248], high: ['4d33c7e0ff3108fc', 1246] },
  'P1-002': { base: ['dfa82c8e223344e4', 497], low: ['17cea78992f182e9', 1218], medium: ['a2ec1a85ea397ca1', 1205], high: ['38b1fb4abcb269b6', 1203] },
  'P1-003': { base: ['7f49f27462ffd82e', 471], low: ['8ed551389638e5b2', 1162], medium: ['8a9e6c0fca172e43', 1187], high: ['45f3d0da17b8e6ce', 1194] },
  'P1-004': { base: ['9ca3a1549ae71f02', 472], low: ['d8c3d125b36acc99', 1198], medium: ['d91f71426a353d48', 1208], high: ['4dc070c95c0d963f', 1214] },
  'P1-005': { base: ['a38a5f202d95fb4c', 471], low: ['c064eb843c314752', 1170], medium: ['aa1fdc7125e9bf49', 1181], high: ['3008fd66ced731a2', 1200] },
};

// Full default profiles captured before the common sales scenarios were made
// support-tier specific on 2026-10-08. Only an exact four-field match may
// upgrade, so any designer-edited field remains untouched.
const OCTOBER_08_BEFORE_TIER_SCENARIOS_PROFILE_FINGERPRINTS: Record<string, Record<NpcSupportPromptTier | 'base', readonly [hash: string, length: number]>> = {
  'P1-001': { base: ['4c8c315ab4dfdb16', 508], low: ['2d3c95d5441c473d', 1430], medium: ['fa1b06600601317e', 1474], high: ['ff05e10b5d64cc09', 1468] },
  'P1-002': { base: ['65d82cb4795ecfc6', 553], low: ['b1df578f98ccfcff', 1444], medium: ['99c92c18ffa7b2c0', 1433], high: ['4caf2738b4cdfee2', 1426] },
  'P1-003': { base: ['852216ef8028143d', 536], low: ['b8632c9602895952', 1395], medium: ['df8d149996d28b05', 1413], high: ['01fdfd42b7274228', 1421] },
  'P1-004': { base: ['583f53f1d4362d1f', 515], low: ['327c6de6957160d2', 1410], medium: ['7c7e06c94439174f', 1433], high: ['82f0f6ce791a5270', 1445] },
  'P1-005': { base: ['4102c17818903638', 524], low: ['56da11058d558835', 1401], medium: ['078ac30a068e0662', 1419], high: ['30fe1efe78d4a12a', 1433] },
};

// Exact fingerprints for the complete defaults before the 2026-10-12 short-
// reply update. A designer's edit to any one field must keep the whole profile
// custom; only the untouched four-field snapshot is upgraded.
const OCTOBER_12_BEFORE_SHORT_REPLIES_PROFILE_FINGERPRINTS: Record<string, Record<NpcSupportPromptTier | 'base', readonly [hash: string, length: number]>> = {
  'P1-001': { base: ['4c8c315ab4dfdb16', 508], low: ['2dc9cd0090ea90de', 1348], medium: ['26f92c9200ad0e48', 1440], high: ['3fda048605451dc2', 1527] },
  'P1-002': { base: ['65d82cb4795ecfc6', 553], low: ['7996001702521c39', 1320], medium: ['e72d669381a0970f', 1387], high: ['2429549c6b67fe60', 1469] },
  'P1-003': { base: ['852216ef8028143d', 536], low: ['edd21aa7ed64b7ef', 1276], medium: ['f13b1809c9b33f05', 1389], high: ['09433bb02bb7e7be', 1460] },
  'P1-004': { base: ['583f53f1d4362d1f', 515], low: ['fed49cbd923b204d', 1294], medium: ['756d8ebb40c02dfd', 1375], high: ['6238a04d7073a585', 1483] },
  'P1-005': { base: ['4102c17818903638', 524], low: ['700c0910c5d25f96', 1303], medium: ['e11edd48ed508a4c', 1404], high: ['1744c5be83f81016', 1500] },
};

// Exact complete profiles saved before the shared natural-dialogue rules were
// introduced on 2026-10-14. Only an untouched four-field match upgrades.
const OCTOBER_14_BEFORE_NATURAL_DIALOGUE_PROFILE_FINGERPRINTS: Record<string, Record<NpcSupportPromptTier | 'base', readonly [hash: string, length: number]>> = {
  'P1-001': { base: ['4c8c315ab4dfdb16', 508], low: ['c8add3cb18403c77', 1578], medium: ['e20e8d96fb89f584', 1760], high: ['b272a86f755ecacb', 1847] },
  'P1-002': { base: ['65d82cb4795ecfc6', 553], low: ['29b61722004cdd0e', 1427], medium: ['304c78c6e17c4be6', 1701], high: ['1efca7b45b382a42', 1774] },
  'P1-003': { base: ['852216ef8028143d', 536], low: ['a12bc827e6f781d5', 1414], medium: ['07258672e153d2ec', 1701], high: ['feba0758f105ab7a', 1769] },
  'P1-004': { base: ['583f53f1d4362d1f', 515], low: ['b9c5102633cb2602', 1420], medium: ['8f5448d2489602b4', 1691], high: ['1daf2ba0f764e4a2', 1786] },
  'P1-005': { base: ['4102c17818903638', 524], low: ['a3cb4456d176a260', 1408], medium: ['3d55a3099bee2979', 1718], high: ['21a3446b3838621d', 1811] },
};

// Exact four-field fingerprints for the 2026-10-14 v5 quality-fix baseline.
// Only a complete match upgrades to today's defaults; even a one-character
// designer edit keeps the profile custom.
const OCTOBER_14_BEFORE_QUALITY_FIX_PROFILE_FINGERPRINTS: Record<string, Record<NpcSupportPromptTier | 'base', readonly [hash: string, length: number]>> = {
  'P1-001': { base: ['1446fb6b90170857', 517], low: ['efefb2db62c7ad2d', 238], medium: ['462582aac46c82f8', 242], high: ['1282c83b2a773561', 255] },
  'P1-002': { base: ['1591a46ee35642f0', 558], low: ['2e8000684f161a4e', 229], medium: ['2a59bc67ec0b6995', 245], high: ['a3fde572c5a2dd38', 257] },
  'P1-003': { base: ['27a56a1ddb7897a9', 542], low: ['33a983553af6db01', 240], medium: ['42953270efdb2f00', 247], high: ['4ace069deaa8ad71', 264] },
  'P1-004': { base: ['1ce43e1665cdf304', 531], low: ['a576be856d91f183', 236], medium: ['ff94d4cba3a0553d', 244], high: ['89c7b5f39f43c6cf', 252] },
  'P1-005': { base: ['9a17d14d1260d0a1', 535], low: ['973ce2d23937e054', 231], medium: ['1d708a3cfdfc2a6c', 250], high: ['a360a748ec6e08a0', 263] },
};

// Exact fingerprints of the saved, complete 2026-10-14 customer and channel
// defaults. Per-field matching means a designer edit is never overwritten.
const CUSTOMER_DEFAULT_PROMPT_FINGERPRINTS: readonly (readonly [hash: string, length: number])[] = [
  ['51d964858d8b8f11', 1822],
  // Frozen v5 customer default from before the 2026-10-14 quality fix.
  ['9375ce4205a880ce', 1643],
  // The exact CUSTOMER_PROMPT shipped by commit 81a975fb6, retained in the
  // fixture because older revision-5 projects can still persist this value.
  ['333814893eebc7ad', 1183],
];
const OCTOBER_14_BEFORE_NATURAL_DIALOGUE_CHANNEL_MODIFIER_FINGERPRINTS: Record<string, readonly [hash: string, length: number]> = {
  email: ['8ac01782f5e7ff76', 28],
  wechat: ['22f1c097f90ba6ef', 25],
  work_phone: ['45bbb2b27bb5c600', 36],
  visit: ['d961c847fc13620d', 28],
  wechat_request: ['8b647c0daff31829', 33],
  direct_visit: ['1aeb55a3043ccc25', 35],
  scheduled_visit: ['48759e5d1a24f2af', 39],
  referral: ['02bf4559030c4f2f', 42],
};
const OCTOBER_14_BEFORE_NATURAL_DIALOGUE_NPC_CHANNEL_EXCEPTION_FINGERPRINTS: Record<string, Record<string, readonly [hash: string, length: number]>> = {
  'P1-001': {
    email: ['b5bba55544aafce1', 61],
    wechat: ['c31f97073fa2a305', 55],
    work_phone: ['6b73f34d864ac7ab', 56],
    visit: ['994bc113c4f217e3', 65],
    wechat_request: ['5fe5b3a956c347a9', 55],
    direct_visit: ['36d21ca546b63d73', 48],
    scheduled_visit: ['339e10693b09046b', 60],
  },
  'P1-002': {
    email: ['f1bb696c7043a9de', 32],
    visit: ['8c832982ff24c480', 27],
  },
  'P1-003': {
    email: ['689e80d94ec8cb3f', 40],
    visit: ['9b00e790e12a939a', 26],
  },
  'P1-004': {
    wechat: ['efde07758b0bb7df', 62],
    visit: ['232b3a25e7a6e6bb', 57],
  },
  'P1-005': {
    email: ['cd756442f04deefa', 33],
    wechat: ['81066b3f74e04bd3', 30],
  },
};

function promptFingerprint(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    first = Math.imul(first ^ value.charCodeAt(index), 0x01000193) >>> 0;
    second = Math.imul(second ^ value.charCodeAt(index), 0x27d4eb2d) >>> 0;
  }
  return first.toString(16).padStart(8, '0') + second.toString(16).padStart(8, '0');
}

function matchesLegacyFingerprint(value: string, expected: readonly [hash: string, length: number]): boolean {
  return value.length === expected[1] && promptFingerprint(value) === expected[0];
}

function hasLegacyDefaultProfile(npcId: string, value: NpcRolePrompt | undefined): boolean {
  const legacyFingerprints = LEGACY_DEFAULT_PROMPT_FINGERPRINTS[npcId];
  const septemberFingerprints = SEPTEMBER_30_DEFAULT_PROFILE_FINGERPRINTS[npcId];
  const octoberFingerprints = OCTOBER_08_PRE_REFRESH_PROFILE_FINGERPRINTS[npcId];
  const octoberBeforeTierScenariosFingerprints = OCTOBER_08_BEFORE_TIER_SCENARIOS_PROFILE_FINGERPRINTS[npcId];
  const octoberBeforeShortRepliesFingerprints = OCTOBER_12_BEFORE_SHORT_REPLIES_PROFILE_FINGERPRINTS[npcId];
  const octoberBeforeNaturalDialogueFingerprints = OCTOBER_14_BEFORE_NATURAL_DIALOGUE_PROFILE_FINGERPRINTS[npcId];
  const octoberBeforeQualityFixFingerprints = OCTOBER_14_BEFORE_QUALITY_FIX_PROFILE_FINGERPRINTS[npcId];
  if (!legacyFingerprints && !septemberFingerprints && !octoberFingerprints && !octoberBeforeTierScenariosFingerprints && !octoberBeforeShortRepliesFingerprints && !octoberBeforeNaturalDialogueFingerprints && !octoberBeforeQualityFixFingerprints) return false;
  if (typeof value === 'string') return Boolean(legacyFingerprints && matchesLegacyFingerprint(value, legacyFingerprints.base));
  if (!value) return false;
  const matchesProfile = (fingerprints: Record<NpcSupportPromptTier | 'base', readonly [hash: string, length: number]> | undefined) => fingerprints
    && matchesLegacyFingerprint(value.base, fingerprints.base)
    && matchesLegacyFingerprint(value.low, fingerprints.low)
    && matchesLegacyFingerprint(value.medium, fingerprints.medium)
    && matchesLegacyFingerprint(value.high, fingerprints.high);
  return Boolean(
    matchesProfile(legacyFingerprints)
    || matchesProfile(septemberFingerprints)
    || matchesProfile(octoberFingerprints)
    || matchesProfile(octoberBeforeTierScenariosFingerprints)
    || matchesProfile(octoberBeforeShortRepliesFingerprints)
    || matchesProfile(octoberBeforeNaturalDialogueFingerprints)
    || matchesProfile(octoberBeforeQualityFixFingerprints),
  );
}

function legacyTierPrompt(base: string, tier: NpcSupportPromptTier): string | undefined {
  const section = base.match(/(?:^|\n)六、支持度只改变哪些内容([\s\S]*?)(?=\n七、参考话术锚点|\s*$)/)?.[1];
  if (!section) return undefined;
  const heading = tier === 'low' ? '低支持度' : tier === 'medium' ? '中等支持度' : '高支持度';
  // The source manuscripts keep every support tier on one bullet line. Read
  // exactly that line so the following instant-pleasantness rule never leaks
  // into the high tier.
  const content = section.match(new RegExp(`[-•]\\s*${heading}：([^\\n]*)`))?.[1]?.trim();
  return content || undefined;
}

export function createNpcRolePromptProfile(base: string): NpcRolePromptProfile {
  return {
    base,
    low: legacyTierPrompt(base, 'low') ?? DEFAULT_SUPPORT_TIER_PROMPTS.low,
    medium: legacyTierPrompt(base, 'medium') ?? DEFAULT_SUPPORT_TIER_PROMPTS.medium,
    high: legacyTierPrompt(base, 'high') ?? DEFAULT_SUPPORT_TIER_PROMPTS.high,
  };
}

/** Supports old string records without replacing the stored original manuscript. */
export function normalizeNpcRolePrompt(value: NpcRolePrompt | undefined): NpcRolePromptProfile {
  if (typeof value === 'string') return createNpcRolePromptProfile(value);
  if (value) return value;
  return createNpcRolePromptProfile('');
}

/** Upgrades only an exact old shipped default; all edited manuscripts survive unchanged. */
export function normalizeNpcRolePromptForNpc(npcId: string, value: NpcRolePrompt | undefined): NpcRolePromptProfile {
  if (hasLegacyDefaultProfile(npcId, value)) {
    const defaultProfile = PROJECT_ONE_NPC_ROLE_PROMPT_PROFILES[npcId as keyof typeof PROJECT_ONE_NPC_ROLE_PROMPT_PROFILES];
    if (defaultProfile) return { ...defaultProfile };
  }
  return normalizeNpcRolePrompt(value);
}

/** The tier is intentionally a deterministic server rule shared by live and preview flows. */
export function supportPromptTier(
  support: number,
  thresholds: NpcSupportTierThresholds = DEFAULT_NPC_SUPPORT_TIER_THRESHOLDS,
): NpcSupportPromptTier {
  const normalized = Number.isFinite(support) ? Math.max(0, Math.min(100, support)) : 0;
  if (normalized >= thresholds.highMin) return 'high';
  if (normalized >= thresholds.mediumMin) return 'medium';
  return 'low';
}

function stripLegacySupportRules(base: string): string {
  // Older five-person manuscripts include both a default "medium support"
  // sentence and a complete low/medium/high section. Keep the manuscript in
  // storage, but omit those conflicting instructions when building a turn.
  return base
    .replace(/(?:^|\n)当前支持度：以系统提供的运行状态为准。[^\n]*(?=\n|$)/g, '')
    .replace(/(?:^|\n)六、支持度只改变哪些内容[\s\S]*?(?=\n七、参考话术锚点|\s*$)/g, '\n')
    .replace(/\n【有一定基础支持度[^】]*】[\s\S]*?(?=\n【|\n八、安全和信息边界|\s*$)/g, '\n')
    .replace(/\n【领导在接受度高时会提问的问题】[\s\S]*?(?=\n【|\n八、安全和信息边界|\s*$)/g, '\n')
    .trim();
}

function pleasantnessWordingRule(pleasantness: number): string {
  const normalized = Number.isFinite(pleasantness) ? Math.max(0, Math.min(100, pleasantness)) : 50;
  const wording = normalized < 35
    ? '措辞略显克制'
    : normalized >= 70
      ? '措辞略显自然、友善'
      : '措辞保持正常、职业';
  return `本回合措辞：${wording}。无论愉悦度高低，始终礼貌客气；克制只减少展开，不用生硬命令、讽刺或责备。`;
}

/**
 * Builds the only role-prompt variant an NPC may see for a turn.  A saved
 * legacy manuscript is preserved verbatim in storage while its old conditional
 * tier sections are excluded from runtime. The model receives only the chosen
 * tier body, never the thresholds or tier-selection rules.
 */
export function composeNpcRolePrompt(
  prompt: NpcRolePrompt | undefined,
  support: number,
  pleasantness: number,
  thresholds: NpcSupportTierThresholds = DEFAULT_NPC_SUPPORT_TIER_THRESHOLDS,
): string {
  const profile = normalizeNpcRolePrompt(prompt);
  const tier = supportPromptTier(support, thresholds);
  return [
    NPC_NATURAL_DIALOGUE_RULES,
    stripLegacySupportRules(profile.base),
    profile[tier],
    pleasantnessWordingRule(pleasantness),
  ].filter(Boolean).join('\n\n');
}

export const projectOnePromptConfigSchema = z.object({
  liveCustomerPrompt: promptText,
  promptLayers: z.record(z.string(), promptText),
  supportTierThresholds: npcSupportTierThresholdsSchema.optional(),
  npcRolePrompts: z.record(z.string(), npcRolePromptSchema),
  channelModifiers: z.record(z.string(), promptText),
  npcChannelExceptions: z.record(z.string(), z.record(z.string(), promptText)),
  liveEvaluatorPrompt: promptText,
  previewEvaluatorPrompt: promptText,
  promptTestNpcPrompt: promptTestNpcPromptConfigSchema,
  promptTestEvaluatorPrompt: promptText,
}).strict();

export type ProjectOnePromptConfig = z.infer<typeof projectOnePromptConfigSchema>;

export const DEFAULT_PREVIEW_EVALUATOR_PROMPT = [
  '只有礼貌问候、宣传口号或宽泛询问时，支持度通常不变，有效接触可以为否。',
  '只有与人物核心诉求直接相关、合规、本轮新增并能推进下一步的具体里程碑、量化验收口径、书面风险闭环或可复核证据，才提高支持度并计为有效接触。',
  '现金、回扣、利益交换、规避采购或保证中标时，愉悦度和支持度必须下降，且不得计为有效接触。',
].join('\n');

export const DEFAULT_LIVE_EVALUATOR_PROMPT = [
  '只评价玩家本轮输入，不因 NPC 回复质量替玩家加分。',
  '重复施压、反复送礼和重复表达的收益递减；不能把 NPC 的客气等同于项目支持。',
  '人物职位、性格、当前阶段、即时愉悦度和长期支持度必须共同参与判断。',
].join('\n');

export const DEFAULT_PROMPT_TEST_EVALUATOR_PROMPT = [
  '只评价玩家本轮行为，不因 NPC 回答得好而给玩家加分。',
  '支持度表示长期推进意愿，愉悦度表示即时沟通体验，两者必须分开。',
  '单纯道歉可以有限改善愉悦度；没有新增兑现或证据时，不得明显恢复长期支持。',
].join('\n');

export const DEFAULT_PROJECT_ONE_PROMPT_CONFIG: ProjectOnePromptConfig = {
  liveCustomerPrompt: CUSTOMER_PROMPT(),
  promptLayers: Object.fromEntries(
    Object.entries(PROJECT_ONE_PROMPT_LAYERS).map(([id, layer]) => [id, layer.template]),
  ),
  supportTierThresholds: { ...DEFAULT_NPC_SUPPORT_TIER_THRESHOLDS },
  npcRolePrompts: Object.fromEntries(
    Object.entries(PROJECT_ONE_NPC_ROLE_PROMPT_PROFILES).map(([npcId, profile]) => [npcId, { ...profile }]),
  ),
  channelModifiers: Object.fromEntries(
    Object.entries(PROJECT_ONE_CHANNEL_MODIFIERS).map(([id, channel]) => [id, channel.modifier]),
  ),
  npcChannelExceptions: Object.fromEntries(
    Object.entries(PROJECT_ONE_NPC_CHANNEL_EXCEPTIONS).map(([npcId, channels]) => [npcId, { ...channels }]),
  ),
  liveEvaluatorPrompt: DEFAULT_LIVE_EVALUATOR_PROMPT,
  previewEvaluatorPrompt: DEFAULT_PREVIEW_EVALUATOR_PROMPT,
  promptTestNpcPrompt: { ...DEFAULT_PROMPT_TEST_NPC_PROMPT_CONFIG },
  promptTestEvaluatorPrompt: DEFAULT_PROMPT_TEST_EVALUATOR_PROMPT,
};

export function normalizeProjectOnePromptConfig(value: unknown): ProjectOnePromptConfig {
  const parsed = projectOnePromptConfigSchema.safeParse(value);
  if (!parsed.success) return structuredClone(DEFAULT_PROJECT_ONE_PROMPT_CONFIG);
  return {
    ...parsed.data,
    liveCustomerPrompt: CUSTOMER_DEFAULT_PROMPT_FINGERPRINTS.some((fingerprint) => matchesLegacyFingerprint(parsed.data.liveCustomerPrompt, fingerprint))
      ? DEFAULT_PROJECT_ONE_PROMPT_CONFIG.liveCustomerPrompt
      : parsed.data.liveCustomerPrompt,
    supportTierThresholds: parsed.data.supportTierThresholds ?? { ...DEFAULT_NPC_SUPPORT_TIER_THRESHOLDS },
    npcRolePrompts: Object.fromEntries(
      Object.entries(parsed.data.npcRolePrompts).map(([npcId, prompt]) => [npcId, normalizeNpcRolePromptForNpc(npcId, prompt)]),
    ),
    channelModifiers: Object.fromEntries(
      Object.entries(parsed.data.channelModifiers).map(([channelId, modifier]) => {
        const expected = OCTOBER_14_BEFORE_NATURAL_DIALOGUE_CHANNEL_MODIFIER_FINGERPRINTS[channelId];
        const currentDefault = DEFAULT_PROJECT_ONE_PROMPT_CONFIG.channelModifiers[channelId];
        return [channelId, expected && currentDefault && matchesLegacyFingerprint(modifier, expected) ? currentDefault : modifier];
      }),
    ),
    npcChannelExceptions: Object.fromEntries(
      Object.entries(parsed.data.npcChannelExceptions).map(([npcId, channels]) => [
        npcId,
        Object.fromEntries(Object.entries(channels).map(([channelId, exception]) => {
          const expected = OCTOBER_14_BEFORE_NATURAL_DIALOGUE_NPC_CHANNEL_EXCEPTION_FINGERPRINTS[npcId]?.[channelId];
          const currentDefault = DEFAULT_PROJECT_ONE_PROMPT_CONFIG.npcChannelExceptions[npcId]?.[channelId];
          return [channelId, expected && currentDefault && matchesLegacyFingerprint(exception, expected) ? currentDefault : exception];
        })),
      ]),
    ),
  };
}
