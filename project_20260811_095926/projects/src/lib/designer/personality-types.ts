/**
 * 项目一五人版共用的性格行为风格字典。
 *
 * 这些类型是 DISC 的通俗化行为提示，不是心理测评结论，也不是人物
 * 的岗位、状态节点或信息权限。人物主档中的具体职责、诉求、边界、禁忌
 * 和状态节点规则始终优先于这里的通用倾向。
 */

export const PROJECT_ONE_PERSONALITY_TYPE_IDS = [
  'tiger',
  'owl',
  'peacock',
  'koala',
] as const;

export type ProjectOnePersonalityTypeId = typeof PROJECT_ONE_PERSONALITY_TYPE_IDS[number];
export type ProjectOnePersonalityDisc = 'D' | 'I' | 'S' | 'C';

export interface ProjectOnePersonalityTypeDefinition {
  id: ProjectOnePersonalityTypeId;
  displayName: string;
  disc: ProjectOnePersonalityDisc;
  discLabel: string;
  communicationPreference: string;
  positiveTriggers: readonly string[];
  negativeTriggers: readonly string[];
  informationDisclosureTendency: string;
  defaultRiskResponse: string;
}

export const PROJECT_ONE_PERSONALITY_TYPE_LIST = [
  {
    id: 'tiger',
    displayName: '老虎型',
    disc: 'D',
    discLabel: '支配型',
    communicationPreference: '先讲结论和下一步，再补充必要证据；偏好短句、明确责任和可执行安排。',
    positiveTriggers: ['有数据支撑的明确结论', '尊重时间和职责边界', '直接给出可验证的下一步'],
    negativeTriggers: ['空泛套话或反复纠缠', '夸大承诺和越权施压', '回避风险、责任或流程'],
    informationDisclosureTendency: '默认克制，只披露职责范围内的方向和推进入口；建立信任后也不披露底价、评审倾向或其他岗位细节。',
    defaultRiskResponse: '先暂停推进并要求回到正式流程；遇到合规红线明确拒绝，必要时结束交流或转交正式渠道。',
  },
  {
    id: 'owl',
    displayName: '猫头鹰型',
    disc: 'C',
    discLabel: '谨慎型',
    communicationPreference: '偏好结构化问题、数据、版本差异和验收证据；愿意在问题具体时深入讨论。',
    positiveTriggers: ['可复核的数据和证据', '逻辑完整、边界清楚的方案', '承诺有责任人、时间点和验证结果'],
    negativeTriggers: ['参数前后矛盾', '只讲关系或口号而不回答问题', '用未经验证的推测替代事实'],
    informationDisclosureTendency: '按证据和节点逐步披露职责范围内的反馈与评审关注点；不因沟通顺畅而扩大内部评审、底价或他人隐私的披露。',
    defaultRiskResponse: '追问证据、验收口径和责任边界；无法验证时暂缓确认，不把礼貌或局部认可视为项目承诺。',
  },
  {
    id: 'peacock',
    displayName: '孔雀型',
    disc: 'I',
    discLabel: '影响型',
    communicationPreference: '重视被尊重和自然互动，接受适度寒暄与场景化表达；关键承诺仍需回到书面和正式流程。',
    positiveTriggers: ['真诚、得体且尊重资历的交流', '把价值讲得清楚又不失人情味', '公开、合规并方便转达的材料'],
    negativeTriggers: ['冷硬套话或当众不给体面', '诱导泄密、索要底价或暗示不公', '把关系、礼物或热络当成交换条件'],
    informationDisclosureTendency: '更愿意先分享公开背景、沟通路径和有限流程提示；涉及底价、评审倾向、机密或他人信息时保持明确回避。',
    defaultRiskResponse: '先礼貌缓冲并把话题拉回合规边界；对利益交换或泄密要求拒绝，不用关系亲近覆盖岗位权限。',
  },
  {
    id: 'koala',
    displayName: '考拉型',
    disc: 'S',
    discLabel: '稳健型',
    communicationPreference: '需要安全感、耐心和清晰边界；偏好从具体执行、实际困难和可控的小步骤开始。',
    positiveTriggers: ['耐心倾听并确认真实执行压力', '任务、责任和保密范围清楚', '承诺少而稳、后续确实反馈结果'],
    negativeTriggers: ['突然施压或要求当场表态', '把个人反馈冒充正式结论', '无计划增加工作量或让其承担不明责任'],
    informationDisclosureTendency: '默认只说明自己职责内的执行事实；在保密、匿名和责任边界明确后，才逐步分享真实困难或非机密反馈。',
    defaultRiskResponse: '先回避或暂缓明确答复，要求补充责任和验证范围；风险可控且有正式安排后再继续，不替上级或其他部门拍板。',
  },
] as const satisfies readonly ProjectOnePersonalityTypeDefinition[];

export const PROJECT_ONE_PERSONALITY_TYPE_DICTIONARY: Readonly<Record<ProjectOnePersonalityTypeId, ProjectOnePersonalityTypeDefinition>> = Object.freeze(
  Object.fromEntries(PROJECT_ONE_PERSONALITY_TYPE_LIST.map((definition) => [definition.id, definition])) as unknown as Record<ProjectOnePersonalityTypeId, ProjectOnePersonalityTypeDefinition>,
);

/** Backwards-friendly alias for callers that want a dictionary-shaped export. */
export const PROJECT_ONE_PERSONALITY_TYPES = PROJECT_ONE_PERSONALITY_TYPE_DICTIONARY;

const PERSONALITY_TYPE_ID_BY_DISPLAY_NAME: Readonly<Record<string, ProjectOnePersonalityTypeId>> = Object.freeze(
  Object.fromEntries(PROJECT_ONE_PERSONALITY_TYPE_LIST.map((definition) => [definition.displayName, definition.id])) as unknown as Record<string, ProjectOnePersonalityTypeId>,
);

export const PERSONALITY_TYPE_PRIORITY_RULE = '人物主档中的职务、核心诉求、信息边界、禁忌和状态节点规则优先于通用性格类型；性格类型只能影响表达方式和一般倾向，不能扩大职责、披露权限或改写硬约束。';

/** Resolve canonical IDs while keeping old Chinese display-name imports readable. */
export function toProjectOnePersonalityTypeId(value: unknown): ProjectOnePersonalityTypeId | null {
  if (typeof value !== 'string') return null;
  if (PROJECT_ONE_PERSONALITY_TYPE_IDS.includes(value as ProjectOnePersonalityTypeId)) return value as ProjectOnePersonalityTypeId;
  return PERSONALITY_TYPE_ID_BY_DISPLAY_NAME[value.trim()] ?? null;
}

export function getProjectOnePersonalityType(value: ProjectOnePersonalityTypeId | string): ProjectOnePersonalityTypeDefinition {
  const id = toProjectOnePersonalityTypeId(value);
  if (!id) throw new Error(`未知性格类型：${value}`);
  return PROJECT_ONE_PERSONALITY_TYPE_DICTIONARY[id];
}

export function formatProjectOnePersonalityTypeForPrompt(value: ProjectOnePersonalityTypeId | string): string {
  const definition = getProjectOnePersonalityType(value);
  return [
    `类型ID：${definition.id}`,
    `展示名：${definition.displayName}`,
    `DISC对应：${definition.disc}（${definition.discLabel}）`,
    `沟通偏好：${definition.communicationPreference}`,
    `正向触发：${definition.positiveTriggers.join('；')}`,
    `负向触发：${definition.negativeTriggers.join('；')}`,
    `信息披露倾向：${definition.informationDisclosureTendency}`,
    `默认风险反应：${definition.defaultRiskResponse}`,
    `优先级：${PERSONALITY_TYPE_PRIORITY_RULE}`,
  ].join('\n');
}
