import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NextRequest } from 'next/server';
import {
  DEFAULT_PROJECT_ONE_COMPETITORS,
  applyCompetitorUpdate,
  competitorCreateSchema,
  competitorRecordSchema,
  competitorUpdateSchema,
  parseCompetitorList,
  type CompetitorRecord,
} from '../src/lib/designer/competitors';
import { toCompetitorProfiles } from '../src/lib/designer/competitor-api';
import { createSession, signLoginProof, signSession } from '../src/lib/auth/identity';
import { GET, POST } from '../src/app/api/game-data/competitors/route';
import { GET as GET_PROFILES } from '../src/app/api/game-data/competitor-profiles/route';

process.env.SESSION_SECRET = 'designer-competitor-regression-secret';

async function main() {

const valid = {
  id: '10000000-0000-4000-8000-000000000101',
  project_id: 1 as const,
  company_name: '示例公司',
  features: '既有客情与价格竞争',
  more_info: '具体报价和项目动作需要在对局中继续收集。',
  industry: '政企软件',
  solution_summary: '分阶段集成',
  representative_experience: '测试案例',
  service_support: '本地实施',
};

assert.equal(competitorRecordSchema.safeParse(valid).success, true);
assert.equal(competitorRecordSchema.safeParse({ ...valid, unexpected: true }).success, false, 'unknown fields are rejected');
assert.equal(competitorRecordSchema.safeParse({ ...valid, company_name: ' '.repeat(65) }).success, false, 'oversized names are rejected');
const createInput = { project_id: 1 as const, expected_revision: 0, company_name: valid.company_name, features: valid.features, more_info: valid.more_info };
assert.equal(competitorCreateSchema.safeParse(createInput).success, true);
assert.equal(competitorCreateSchema.safeParse({ ...createInput, industry: '示例行业' }).success, true, 'new profile fields are optional on create');
assert.equal(competitorCreateSchema.safeParse({ ...createInput, industry: '行业'.repeat(100) }).success, false, 'industry length is bounded');
assert.equal(competitorCreateSchema.safeParse({ ...valid, project_id: 2, expected_revision: 0 }).success, false, 'project whitelist is enforced');
assert.equal(competitorUpdateSchema.safeParse({ ...valid, expected_revision: 0 }).success, true);
assert.equal(competitorUpdateSchema.safeParse({ ...createInput, id: valid.id }).success, true, 'new profile fields are optional on update');
const legacyRecord = competitorRecordSchema.parse({
  id: valid.id,
  project_id: 1,
  company_name: '旧配置企业',
  features: '旧优势',
  more_info: '旧简介',
});
assert.deepEqual(
  [legacyRecord.industry, legacyRecord.solution_summary, legacyRecord.representative_experience, legacyRecord.service_support],
  ['', '', '', ''],
  'legacy stored rows normalize missing profile fields to empty strings',
);
const updateWithoutNewFields = applyCompetitorUpdate(competitorRecordSchema.parse(valid), {
  id: valid.id,
  project_id: 1,
  expected_revision: 0,
  company_name: 'ABC竞品更新',
  features: '仍有既有客情',
  more_info: '仍保留已有介绍',
});
assert.deepEqual(
  [updateWithoutNewFields.industry, updateWithoutNewFields.solution_summary, updateWithoutNewFields.representative_experience, updateWithoutNewFields.service_support],
  [valid.industry, valid.solution_summary, valid.representative_experience, valid.service_support],
  'legacy edits retain previously saved new profile fields when omitted',
);
assert.deepEqual(parseCompetitorList(DEFAULT_PROJECT_ONE_COMPETITORS), DEFAULT_PROJECT_ONE_COMPETITORS);
assert.equal(DEFAULT_PROJECT_ONE_COMPETITORS.length, 2, 'fallback config excludes ABC and keeps two simulated companies');
assert.equal(new Set(DEFAULT_PROJECT_ONE_COMPETITORS.map((competitor) => competitor.id)).size, 2, 'fallback IDs remain stable and unique');
assert.ok(DEFAULT_PROJECT_ONE_COMPETITORS.every((competitor) => competitor.more_info.includes('模拟企业资料')));
assert.deepEqual(DEFAULT_PROJECT_ONE_COMPETITORS.map((competitor) => competitor.id.slice(-3)), ['102', '103']);
assert.throws(() => parseCompetitorList([valid, { ...valid, id: '10000000-0000-4000-8000-000000000102' }]), /COMPETITOR_DUPLICATE_NAME/);

const profiles = toCompetitorProfiles({
  competitors: [Object.assign(competitorRecordSchema.parse(valid), { hidden_competitive_status: 'private', updated_by: 'private' }) as CompetitorRecord],
  revision: 7,
  updatedAt: '2026-01-01T00:00:00.000Z',
  updatedBy: 'private',
  persisted: true,
}, 1);
assert.deepEqual(profiles[0], {
  id: valid.id,
  project_id: 1,
  company_name: valid.company_name,
  features: valid.features,
  more_info: valid.more_info,
  industry: valid.industry,
  solution_summary: valid.solution_summary,
  representative_experience: valid.representative_experience,
  service_support: valid.service_support,
}, 'public read projection excludes audit and hidden competition state');
assert.deepEqual(toCompetitorProfiles({
  competitors: [competitorRecordSchema.parse({ ...valid, company_name: 'ABC竞品' }), competitorRecordSchema.parse({ ...valid, id: '10000000-0000-4000-8000-000000000102' })],
  revision: 0,
  updatedAt: null,
  updatedBy: null,
  persisted: true,
}, 1).map((profile) => profile.company_name), ['示例公司'], 'legacy ABC placeholder is omitted while actual company profiles remain');
assert.deepEqual(toCompetitorProfiles({
  competitors: [competitorRecordSchema.parse(valid)],
  revision: 0,
  updatedAt: null,
  updatedBy: null,
  persisted: false,
}, 2), [], 'profile projection is scoped to the requested project');

const request = (method: string, token?: string, body?: unknown) => new NextRequest('http://localhost/api/game-data/competitors?project_id=1', {
  method,
  headers: {
    ...(token ? { 'x-session': token } : {}),
    ...(body === undefined ? {} : { 'content-type': 'application/json' }),
  },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const profileRequest = (projectId: string, token?: string) => new NextRequest(`http://localhost/api/game-data/competitor-profiles?project_id=${projectId}`, {
  method: 'GET',
  headers: token ? { 'x-session': token } : {},
});

const playerToken = signSession(createSession('competitor-player', 'player'));
const designerToken = signSession(createSession('competitor-designer', 'platform_designer'));
const adminToken = signSession(createSession('competitor-admin', 'enterprise_admin'));
const trainerToken = signSession(createSession('competitor-trainer', 'trainer'));
const proof = signLoginProof('competitor-designer');

assert.equal((await GET(request('GET'))).status, 401);
assert.equal((await GET(request('GET', proof))).status, 401, 'login proof cannot authorize designer data');
assert.equal((await GET(request('GET', playerToken))).status, 403);
assert.equal((await POST(request('POST', designerToken, { project_id: 1 }))).status, 400, 'designer reaches strict request validation');
const unauthorizedProfileRead = await GET_PROFILES(profileRequest('1'));
assert.equal(unauthorizedProfileRead.status, 401);
assert.equal(unauthorizedProfileRead.headers.get('cache-control'), 'no-store, max-age=0');
for (const token of [playerToken, adminToken, trainerToken, designerToken]) {
  const invalidProjectRead = await GET_PROFILES(profileRequest('2', token));
  assert.equal(invalidProjectRead.status, 400, 'all signed-in roles can read past authentication and project validation remains enforced');
  assert.equal(invalidProjectRead.headers.get('cache-control'), 'no-store, max-age=0');
  const errorBody = await invalidProjectRead.json();
  assert.equal(errorBody.success, undefined, 'read failures are not disguised as empty successful results');
}

const migration = readFileSync(new URL('../supabase/migrations/20260921000300_scenario_competitor_config.sql', import.meta.url), 'utf8');
assert.match(migration, /ALTER TABLE public\.scenario_templates/);
assert.match(migration, /competitors/);
assert.match(migration, /revision/);
assert.doesNotMatch(migration, /CREATE TABLE/i, 'competitor config must reuse scenario_templates');

const routeSource = readFileSync(new URL('../src/app/api/game-data/competitors/route.ts', import.meta.url), 'utf8');
const designerPage = readFileSync(new URL('../src/app/designer/page.tsx', import.meta.url), 'utf8');
assert.doesNotMatch(routeSource, /status:\s*501/);
assert.match(designerPage, /handleSaveCompetitor/);
assert.match(designerPage, /handleDeleteCompetitor/);
assert.match(designerPage, /api\/game-data\/competitors/);
assert.match(designerPage, /representative_experience/);
assert.match(designerPage, /service_support/);
const publicRouteSource = readFileSync(new URL('../src/app/api/game-data/competitor-profiles/route.ts', import.meta.url), 'utf8');
assert.match(publicRouteSource, /handleCompetitorProfilesGet/);

  console.log('designer competitor CRUD contracts, authorization and persistence checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
