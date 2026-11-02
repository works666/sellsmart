export const BID_RULES = {
  balanced: { label: '综合评价', description: '综合比较价格、技术方案、功能和交付能力。' },
  lowest_price: { label: '最低价优先', description: '在满足基本要求后优先比较报价。' },
  technical_accuracy: { label: '技术精度优先', description: '将技术能力与测量精度作为核心评价项。' },
  feature_completeness: { label: '功能完整度优先', description: '将功能覆盖和方案完整度作为重要评价项。' },
} as const;

export type BidRule = keyof typeof BID_RULES;
export type SupplierAdvantageType = 'price' | 'technical_accuracy' | 'feature_completeness';
export type OverallSupportState = 'HIGH' | 'MID_HIGH' | 'MID' | 'LOW';
export const BID_RULE_PROPOSAL_COST = 2;

export interface RuleProposalInterpretation {
  bidRule: Exclude<BidRule, 'balanced'>;
  /** The player wording is retained as an audit trail, never substituted by a UI enum. */
  proposalText: string;
}

export interface ProcurementRuleAccess {
  /** May put a compliant evaluation direction into the formal procurement record. */
  canModify: boolean;
  /** May disclose the published direction in a natural conversation once the relationship permits it. */
  canDisclose: boolean;
  disclosureMinSupport: number;
  allowedRules: readonly Exclude<BidRule, 'balanced'>[];
}

/**
 * Procurement authority comes from the existing five-person responsibilities.
 * It is deliberately server-side: the browser only ever names a contact and
 * supplies its own natural-language wording.
 */
export const PROCUREMENT_RULE_ACCESS: Record<string, ProcurementRuleAccess> = {
  // The sponsor can approve an evaluation direction, but does not expose
  // procurement detail until a strong working relationship exists.
  'P1-001': { canModify: true, canDisclose: true, disclosureMinSupport: 65, allowedRules: ['lowest_price', 'technical_accuracy', 'feature_completeness'] },
  // The technical gatekeeper may explain a technical focus, while formal
  // procurement changes remain with the procurement owner or sponsor.
  'P1-002': { canModify: false, canDisclose: true, disclosureMinSupport: 60, allowedRules: ['technical_accuracy'] },
  // The procurement-office owner is the normal formal-rule authority.
  'P1-003': { canModify: true, canDisclose: true, disclosureMinSupport: 50, allowedRules: ['lowest_price', 'technical_accuracy', 'feature_completeness'] },
  'P1-004': { canModify: false, canDisclose: false, disclosureMinSupport: 101, allowedRules: [] },
  'P1-005': { canModify: false, canDisclose: false, disclosureMinSupport: 101, allowedRules: [] },
};

export function getProcurementRuleAccess(npcId: string): ProcurementRuleAccess {
  return PROCUREMENT_RULE_ACCESS[npcId] ?? { canModify: false, canDisclose: false, disclosureMinSupport: 101, allowedRules: [] };
}

function removeNegatedDirectionMentions(text: string, direction: Exclude<BidRule, 'balanced'>): string {
  const terms: Record<Exclude<BidRule, 'balanced'>, string> = {
    lowest_price: '(?:最低价|低价|报价|价格)',
    technical_accuracy: '(?:技术精度|精度|准确度|测量精度|技术指标)',
    feature_completeness: '(?:功能完整度|功能完整|功能覆盖|功能模块|模块完整)',
  };
  return text.replace(new RegExp(`(?:不要|不建议|别|避免|不能|不以).{0,8}${terms[direction]}`, 'g'), '');
}

/**
 * Interpret only an explicit, single procurement direction from player prose.
 * A vague wish such as “价格和精度都重要” is intentionally not coerced into a
 * rule: the player must make the business recommendation in their own words.
 */
export function interpretBidRuleProposal(proposalText: string): RuleProposalInterpretation | null {
  const text = proposalText.trim();
  if (!text) return null;
  const patterns: Record<Exclude<BidRule, 'balanced'>, RegExp> = {
    lowest_price: /最低价|低价|报价|价格/,
    technical_accuracy: /技术精度|精度|准确度|测量精度|技术指标/,
    feature_completeness: /功能完整度|功能完整|功能覆盖|功能模块|模块完整/,
  };
  const directions = (Object.keys(patterns) as Array<Exclude<BidRule, 'balanced'>>)
    .filter((direction) => patterns[direction].test(removeNegatedDirectionMentions(text, direction)));
  if (directions.length === 1) return { bidRule: directions[0], proposalText: text };

  // When several topics occur, accept one only if the wording explicitly
  // makes it the main criterion. This preserves the player's stated intent.
  const priorityPattern: Record<Exclude<BidRule, 'balanced'>, RegExp> = {
    lowest_price: /(?:以|将|建议将|建议以).{0,8}(?:最低价|低价|报价|价格).{0,8}(?:优先|核心|主要|关键|主评)|(?:最低价|低价|报价|价格).{0,8}(?:优先|核心|主要|关键|主评)/,
    technical_accuracy: /(?:以|将|建议将|建议以).{0,8}(?:技术精度|精度|准确度|测量精度|技术指标).{0,8}(?:优先|核心|主要|关键|主评)|(?:技术精度|精度|准确度|测量精度|技术指标).{0,8}(?:优先|核心|主要|关键|主评)/,
    feature_completeness: /(?:以|将|建议将|建议以).{0,8}(?:功能完整度|功能完整|功能覆盖|功能模块|模块完整).{0,8}(?:优先|核心|主要|关键|主评)|(?:功能完整度|功能完整|功能覆盖|功能模块|模块完整).{0,8}(?:优先|核心|主要|关键|主评)/,
  };
  const explicitDirections = directions.filter((direction) => priorityPattern[direction].test(text));
  return explicitDirections.length === 1 ? { bidRule: explicitDirections[0], proposalText: text } : null;
}

export interface SupplierProfile {
  id: string;
  name: string;
  advantageType: SupplierAdvantageType;
  coreAdvantage: string;
  advantageValue: number;
  preferredBidRule: BidRule;
  baseCompetitivenessScore: number;
  /** Default customer support for this supplier, keyed by NPC id. */
  initialSupportByNpc: Record<string, number>;
}

export interface WeightedSupportValue {
  support: number;
  weight: number;
}

export function calculateWeightedSupport(values: WeightedSupportValue[]): number {
  const valid = values.filter((value) => Number.isFinite(value.support) && Number.isFinite(value.weight) && value.weight > 0);
  const totalWeight = valid.reduce((sum, value) => sum + value.weight, 0);
  if (!totalWeight) return 0;
  return valid.reduce((sum, value) => sum + Math.max(0, Math.min(100, value.support)) * value.weight, 0) / totalWeight;
}

/**
 * Support bands use the existing 0–100 NPC scale and decision weights.
 * HIGH also requires at least 60% of decision weight to be at 60 or above,
 * so one unusually supportive person cannot represent the whole customer.
 */
export function calculateOverallSupportState(values: WeightedSupportValue[]): OverallSupportState {
  const average = calculateWeightedSupport(values);
  const totalWeight = values.reduce((sum, value) => sum + (value.weight > 0 ? value.weight : 0), 0);
  const highSupportWeight = values.reduce((sum, value) =>
    sum + (value.weight > 0 && value.support >= 60 ? value.weight : 0), 0);
  const broadSupportRatio = totalWeight ? highSupportWeight / totalWeight : 0;
  if (average >= 65 && broadSupportRatio >= 0.6) return 'HIGH';
  if (average >= 50) return 'MID_HIGH';
  if (average >= 35) return 'MID';
  return 'LOW';
}

export function getRuleFit(profile: SupplierProfile, rule: BidRule): 'strong' | 'neutral' | 'weak' {
  if (rule === 'balanced') return 'neutral';
  return profile.preferredBidRule === rule ? 'strong' : 'weak';
}

/** A transparent, deterministic fit component on a 0–20 scale. */
export function getRuleMatchScore(profile: SupplierProfile, rule: BidRule): number {
  const fit = getRuleFit(profile, rule);
  if (fit === 'neutral') return 8;
  if (fit === 'strong') return 12 + Math.round(profile.advantageValue / 25);
  return 2;
}
