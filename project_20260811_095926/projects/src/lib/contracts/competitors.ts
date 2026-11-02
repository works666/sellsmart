/** Public competitor profile shared by the game client and designer tools. */
export interface CompetitorProfile {
  id: string;
  project_id: number;
  company_name: string;
  /** Existing `features` field: the competitor's core advantages. */
  features: string;
  /** Existing `more_info` field: the basic company introduction. */
  more_info: string;
  industry: string;
  solution_summary: string;
  representative_experience: string;
  service_support: string;
}

/** The original ABC entry was a placeholder, not a company profile. */
export function isLegacyCompetitorPlaceholder(profile: Pick<CompetitorProfile, 'id' | 'company_name'>): boolean {
  return profile.id === '10000000-0000-4000-8000-000000000101'
    && /^ABC(?:竞品|公司)?$/i.test(profile.company_name.trim());
}
