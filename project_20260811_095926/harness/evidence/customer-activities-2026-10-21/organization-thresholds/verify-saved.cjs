const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { readFileSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const app = resolve(__dirname, '../../../../projects');
const fromApp = createRequire(resolve(app, 'package.json'));
fromApp('tsx/cjs');
const {
  DEFAULT_ACTIVITY_DECISION_CONFIG, CUSTOMER_ACTIVITY_TYPES, CUSTOMER_ACTIVITY_ORGANIZATION_NPC_IDS: ids,
  decideOrganizationActivityThreshold,
} = fromApp(resolve(app, 'src/lib/game/customer-activities.ts'));
const { config } = JSON.parse(readFileSync(resolve(__dirname, 'config-readback.json'), 'utf8'));
assert.equal(config.mode, 'numeric');
assert.deepEqual(config.thresholds, DEFAULT_ACTIVITY_DECISION_CONFIG.thresholds);
const team = (changes = {}, initial = [0, 0, 0, 0, 0]) => ids.map((npcId, index) => ({
  npcId, support: initial[index], pleasantness: 50, ...changes[npcId],
}));
const patch = (entries) => Object.fromEntries(entries.map(([index, support, pleasantness = 55]) => [ids[index], { support, pleasantness }]));
const scenarios = [
  ['preview_initial', team(), [false, false, false]],
  ['formal_initial', team({}, [20, 35, 40, 30, 35]), [false, false, false]],
  ...ids.map((npcId, index) => [`only_one_improved_${index + 1}`, team({ [npcId]: { support: 100, pleasantness: 100 } }, [20, 35, 40, 30, 35]), [false, false, false]]),
  ['technical_pair_a', team(patch([[1, 12], [3, 8]])), [true, false, false]],
  ['technical_pair_b', team(patch([[0, 15], [1, 8]])), [true, false, false]],
  ['technical_three', team(patch([[1, 8], [2, 8], [4, 8]])), [true, false, false]],
  ['case_pair_a', team(patch([[1, 15], [3, 12]])), [true, true, false]],
  ['company_pair_a', team(patch([[0, 18], [2, 12]])), [false, false, true]],
  ['company_three_b', team(patch([[1, 15], [2, 12], [4, 8]])), [true, false, true]],
  ['global_minimum_19', team(patch([[0, 100], [1, 100], [2, 100], [3, 100], [4, 100, 19]])), [false, false, false]],
  ['technical_one_at_54', team(patch([[1, 12], [3, 8, 54]])), [false, false, false]],
  ['global_minimum_20', team(patch([[1, 12], [3, 8], [4, 0, 20]])), [true, false, false]],
];
const rows = [];
for (const [name, members, expected] of scenarios) {
  for (const [typeIndex, type] of CUSTOMER_ACTIVITY_TYPES.entries()) {
    for (const proposer of ids) {
      const contact = members.find((member) => member.npcId === proposer);
      const result = decideOrganizationActivityThreshold({
        npcId: proposer, role: '合成测试角色', stage: '采购评估',
        support: contact.support, pleasantness: contact.pleasantness,
        dimensions: { decisionAnalysis: 0, relationshipBuilding: 0, valuePresentation: 0, objectionHandling: 0, informationDiscovery: 0 },
        organization: { members },
      }, config.thresholds[type].organization);
      assert.equal(result.decision === 'allow', expected[typeIndex], `${name}/${type}/${proposer}`);
      rows.push({ scenario: name, type, proposer, result: result.decision });
    }
  }
}
const report = { checkedAt: new Date().toISOString(), passed: true, source: 'Actual persisted config readback', configRevision: config.revision, scenarioCount: scenarios.length, assertions: rows.length, noAiCalls: true, noDatabaseWrites: true, rows };
writeFileSync(resolve(__dirname, 'saved-config-scenarios.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ passed: true, configRevision: config.revision, scenarios: scenarios.length, assertions: rows.length }));
