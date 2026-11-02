import {
  PROJECT_ONE_FIVE_PERSON_IDS,
  PROJECT_ONE_FIVE_PERSON_NPCS,
  type ProjectOneFivePersonId,
} from '@/lib/designer/project-one-five-person';

/**
 * The compact, code-owned personality context supplied to Jev for a specific
 * NPC decision. This deliberately omits the complete prose role prompt: that
 * prompt contains generation-only formatting instructions that would compete
 * with Jev's typed-question contract.
 */
export type JevNpcProfile = Readonly<{
  id: ProjectOneFivePersonId;
  name: string;
  title: string;
  category: string;
  organization: string;
  personalityType: string;
  personality: string;
  coreNeeds: readonly string[];
  informationBoundary: readonly string[];
  taboos: readonly string[];
  hiddenBehavior: string;
  contactPath: string;
}>;

/** Candidate comparison needs a useful distinction, not every profile field. */
export type JevCandidateNpcProfile = Readonly<Pick<
  JevNpcProfile,
  'id' | 'name' | 'title' | 'category' | 'personalityType' | 'coreNeeds' | 'contactPath'
>>;

function isProjectOneFivePersonId(value: string): value is ProjectOneFivePersonId {
  return (PROJECT_ONE_FIVE_PERSON_IDS as readonly string[]).includes(value);
}

/** Returns undefined for unknown IDs so callers can never accidentally reuse another NPC's profile. */
export function buildJevNpcProfile(npcId: string): JevNpcProfile | undefined {
  if (!isProjectOneFivePersonId(npcId)) return undefined;
  const npc = PROJECT_ONE_FIVE_PERSON_NPCS[npcId];
  return {
    id: npc.id,
    name: npc.name,
    title: npc.title,
    category: npc.category,
    organization: npc.organization,
    personalityType: npc.personalityType,
    personality: npc.personality,
    coreNeeds: [...npc.coreNeeds],
    informationBoundary: [...npc.informationBoundary],
    taboos: [...npc.taboos],
    hiddenBehavior: npc.hiddenBehavior,
    contactPath: npc.contactPath,
  };
}

/** A stable full profile list for the read-only designer API. */
export function buildJevCandidateNpcProfiles(npcIds: readonly string[] = PROJECT_ONE_FIVE_PERSON_IDS): JevNpcProfile[] {
  return npcIds.flatMap((npcId) => {
    const profile = buildJevNpcProfile(npcId);
    return profile ? [profile] : [];
  });
}

/** Compact candidate data for plan matching; the designer API exposes the full profiles separately. */
export function buildJevCandidateNpcSummaries(npcIds: readonly string[] = PROJECT_ONE_FIVE_PERSON_IDS): JevCandidateNpcProfile[] {
  return buildJevCandidateNpcProfiles(npcIds).map(({ id, name, title, category, personalityType, coreNeeds, contactPath }) => ({
    id,
    name,
    title,
    category,
    personalityType,
    coreNeeds,
    contactPath,
  }));
}
