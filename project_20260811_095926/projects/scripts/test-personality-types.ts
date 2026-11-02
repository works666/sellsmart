import assert from 'node:assert/strict';
import {
  PERSONALITY_TYPE_PRIORITY_RULE,
  PROJECT_ONE_PERSONALITY_TYPE_DICTIONARY,
  PROJECT_ONE_PERSONALITY_TYPE_IDS,
  PROJECT_ONE_PERSONALITY_TYPE_LIST,
  formatProjectOnePersonalityTypeForPrompt,
  getProjectOnePersonalityType,
  toProjectOnePersonalityTypeId,
} from '../src/lib/designer/personality-types';
import {
  PROJECT_ONE_FIVE_PERSON_IDS,
  PROJECT_ONE_FIVE_PERSON_NPCS,
} from '../src/lib/designer/project-one-five-person';
import { buildPreviewNpcPersonalityPrompt, PREVIEW_NPCS } from '../src/lib/game/project-one-preview-ai';

const requiredFields = [
  'id',
  'displayName',
  'disc',
  'communicationPreference',
  'positiveTriggers',
  'negativeTriggers',
  'informationDisclosureTendency',
  'defaultRiskResponse',
] as const;

for (const type of PROJECT_ONE_PERSONALITY_TYPE_LIST) {
  for (const field of requiredFields) {
    const value = type[field];
    assert.ok(value !== undefined && value !== null, `${type.id} must define ${field}`);
    if (Array.isArray(value)) assert.ok(value.length > 0, `${type.id}.${field} must not be empty`);
    else assert.notEqual(String(value).trim(), '', `${type.id}.${field} must not be blank`);
  }
  assert.equal(PROJECT_ONE_PERSONALITY_TYPE_DICTIONARY[type.id], type, `${type.id} must resolve from the shared dictionary`);
  assert.match(formatProjectOnePersonalityTypeForPrompt(type.id), new RegExp(`类型ID：${type.id}`));
}

assert.equal(PROJECT_ONE_PERSONALITY_TYPE_LIST.length, 4);
assert.deepEqual(new Set(PROJECT_ONE_PERSONALITY_TYPE_IDS).size, PROJECT_ONE_PERSONALITY_TYPE_IDS.length);
assert.equal(toProjectOnePersonalityTypeId('老虎型'), 'tiger');
assert.equal(toProjectOnePersonalityTypeId('owl'), 'owl');
assert.equal(getProjectOnePersonalityType('孔雀型').id, 'peacock');
assert.match(PERSONALITY_TYPE_PRIORITY_RULE, /人物主档/);
assert.match(PERSONALITY_TYPE_PRIORITY_RULE, /状态节点/);

for (const npcId of PROJECT_ONE_FIVE_PERSON_IDS) {
  const npc = PROJECT_ONE_FIVE_PERSON_NPCS[npcId];
  assert.ok(PROJECT_ONE_PERSONALITY_TYPE_IDS.includes(npc.personalityType), `${npc.name} uses the shared type IDs`);
  assert.equal(PREVIEW_NPCS[npcId].personalityType, npc.personalityType);
  const prompt = buildPreviewNpcPersonalityPrompt(npcId);
  const type = getProjectOnePersonalityType(npc.personalityType);
  assert.match(prompt, new RegExp(`类型ID：${type.id}`));
  assert.match(prompt, new RegExp(`展示名：${type.displayName}`));
  assert.match(prompt, /DISC对应：/);
  assert.match(prompt, /沟通偏好：/);
  assert.match(prompt, /正向触发：/);
  assert.match(prompt, /负向触发：/);
  assert.match(prompt, /信息披露倾向：/);
  assert.match(prompt, /默认风险反应：/);
  assert.match(prompt, /人物主档/);
}

console.log('personality type dictionary and prompt assembly tests passed');

