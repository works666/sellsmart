import {
  activityDecisionConfigSchema,
  CUSTOMER_ACTIVITY_ORGANIZATION_NPC_IDS,
  HOSPITALITY_ACTIVITY_DEFAULT_THRESHOLD,
  ORGANIZATION_CUSTOMER_ACTIVITY_TYPES,
  organizationActivityThresholdSchema,
  type ActivityDecisionConfig,
  type CustomerActivityOrganizationNpcId,
  type OrganizationActivityThreshold,
} from '@/lib/game/customer-activities';

export type OrganizationConditionForm = {
  id: string;
  npcIds: CustomerActivityOrganizationNpcId[];
  minCount: string;
  supportMin: string;
  pleasantnessMin: string;
};

export type OrganizationPathForm = {
  id: string;
  label: string;
  conditions: OrganizationConditionForm[];
};

export type OrganizationActivityThresholdForm = {
  minimumPleasantness: string;
  paths: OrganizationPathForm[];
};

export type SingleCustomerActivityThresholdForm = {
  supportMin: string;
  pleasantnessMin: string;
};

export type CustomerActivityDecisionConfigWrite = Pick<ActivityDecisionConfig, 'mode' | 'thresholds'>;

export function parseCustomerActivityThreshold(value: string): number | null {
  if (!/^\d{1,3}$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 100 ? parsed : null;
}

export function isEmptyOrganizationActivityThresholdForm(form: OrganizationActivityThresholdForm): boolean {
  return form.minimumPleasantness.trim() === '' && form.paths.length === 0;
}

function parseRequiredThreshold(value: string): number | null {
  return parseCustomerActivityThreshold(value.trim());
}

/** Converts a designer-friendly string form to the same validated shape the domain gate consumes. */
export function buildOrganizationActivityThreshold(
  form: OrganizationActivityThresholdForm,
): OrganizationActivityThreshold | null {
  const minimumPleasantness = parseRequiredThreshold(form.minimumPleasantness);
  if (minimumPleasantness === null || form.paths.length === 0) return null;

  const paths: OrganizationActivityThreshold['paths'] = [];
  for (const path of form.paths) {
    const conditions: OrganizationActivityThreshold['paths'][number]['conditions'] = [];
    const seenNpcIds = new Set<CustomerActivityOrganizationNpcId>();
    for (const condition of path.conditions) {
      const minCount = parseRequiredThreshold(condition.minCount);
      const supportMin = parseRequiredThreshold(condition.supportMin);
      const pleasantnessMin = parseRequiredThreshold(condition.pleasantnessMin);
      if (minCount === null || supportMin === null || pleasantnessMin === null) return null;
      condition.npcIds.forEach((npcId) => seenNpcIds.add(npcId));
      conditions.push({
        npcIds: condition.npcIds,
        minCount,
        supportMin,
        pleasantnessMin,
      });
    }
    // Every alternative must be actionable by multiple people in the organization.
    // The domain gate also checks that at least two distinct people qualify at runtime.
    if (seenNpcIds.size < 2) return null;
    paths.push({ id: path.id, label: path.label.trim(), conditions });
  }

  const parsed = organizationActivityThresholdSchema.safeParse({ minimumPleasantness, paths });
  if (!parsed.success) return null;
  if (parsed.data.paths.some((path) => path.conditions.some((condition) => (
    condition.minCount > condition.npcIds.length
    || condition.npcIds.some((npcId) => !CUSTOMER_ACTIVITY_ORGANIZATION_NPC_IDS.includes(npcId))
  )))) return null;
  return parsed.data;
}

export function buildSingleCustomerActivityThreshold(
  form: SingleCustomerActivityThresholdForm,
): { supportMin: number; pleasantnessMin: number } | null {
  const supportMin = parseRequiredThreshold(form.supportMin);
  const pleasantnessMin = parseRequiredThreshold(form.pleasantnessMin);
  if (supportMin === null || pleasantnessMin === null) return null;
  return { supportMin, pleasantnessMin };
}

/** Uses the core config schema and keeps hospitality's single-customer rule independent from organization mode. */
export function parseCustomerActivityDecisionConfigWrite(value: unknown): CustomerActivityDecisionConfigWrite | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => key !== 'mode' && key !== 'thresholds')
    || !Object.hasOwn(input, 'mode')
    || !Object.hasOwn(input, 'thresholds')) return null;
  const parsed = activityDecisionConfigSchema.safeParse({ revision: 0, ...input });
  if (!parsed.success) return null;
  for (const type of ORGANIZATION_CUSTOMER_ACTIVITY_TYPES) {
    const organization = parsed.data.thresholds[type]?.organization;
    if (organization?.paths.some((path) => (
      new Set(path.conditions.flatMap((condition) => condition.npcIds)).size < 2
    ))) return null;
  }
  if (parsed.data.mode === 'numeric' && ORGANIZATION_CUSTOMER_ACTIVITY_TYPES.some((type) => !parsed.data.thresholds[type]?.organization)) return null;
  if (parsed.data.thresholds.hospitality?.organization) return null;
  return {
    mode: parsed.data.mode,
    thresholds: {
      ...parsed.data.thresholds,
      hospitality: parsed.data.thresholds.hospitality ?? HOSPITALITY_ACTIVITY_DEFAULT_THRESHOLD,
    },
  };
}
