import assert from 'node:assert/strict';
import {
  HOSPITALITY_ACTIVITY_DEFAULT_THRESHOLD,
  ORGANIZATION_CUSTOMER_ACTIVITY_TYPES,
  RECOMMENDED_ORGANIZATION_ACTIVITY_THRESHOLDS,
  type OrganizationActivityThreshold,
} from '../src/lib/game/customer-activities';
import {
  buildOrganizationActivityThreshold,
  buildSingleCustomerActivityThreshold,
  parseCustomerActivityDecisionConfigWrite,
  parseCustomerActivityThreshold,
  type OrganizationActivityThresholdForm,
} from '../src/lib/designer/customer-activity-decision-form';

for (const [input, expected] of [['0', 0], ['99', 99], ['100', 100]] as const) {
  assert.equal(parseCustomerActivityThreshold(input), expected);
}
for (const input of ['101', '-1', '1.5', '', '  ', ' 5', '5 ']) {
  assert.equal(parseCustomerActivityThreshold(input), null, `${input} is rejected as a threshold`);
}

function validForm(): OrganizationActivityThresholdForm {
  return {
    minimumPleasantness: '20',
    paths: [{
      id: 'path-a',
      label: '项目牵头人与技术负责人支持',
      conditions: [
        { id: 'condition-a', npcIds: ['P1-001'], minCount: '1', supportMin: '0', pleasantnessMin: '100' },
        { id: 'condition-b', npcIds: ['P1-002', 'P1-003'], minCount: '2', supportMin: '99', pleasantnessMin: '55' },
      ],
    }],
  };
}

assert.deepEqual(buildOrganizationActivityThreshold(validForm()), {
  minimumPleasantness: 20,
  paths: [{
    id: 'path-a',
    label: '项目牵头人与技术负责人支持',
    conditions: [
      { npcIds: ['P1-001'], minCount: 1, supportMin: 0, pleasantnessMin: 100 },
      { npcIds: ['P1-002', 'P1-003'], minCount: 2, supportMin: 99, pleasantnessMin: 55 },
    ],
  }],
});

const onePersonPath = validForm();
onePersonPath.paths[0].conditions = [
  { id: 'only-one', npcIds: ['P1-001'], minCount: '1', supportMin: '0', pleasantnessMin: '0' },
];
assert.equal(buildOrganizationActivityThreshold(onePersonPath), null, 'each path must involve at least two distinct people');

const repeatedPersonPath = validForm();
repeatedPersonPath.paths[0].conditions = [
  { id: 'first', npcIds: ['P1-001'], minCount: '1', supportMin: '0', pleasantnessMin: '0' },
  { id: 'second', npcIds: ['P1-001', 'P1-002'], minCount: '1', supportMin: '0', pleasantnessMin: '0' },
];
assert.ok(buildOrganizationActivityThreshold(repeatedPersonPath), 'a person may qualify under multiple conditions in the same path');

const duplicateWithinCondition = validForm();
duplicateWithinCondition.paths[0].conditions[0].npcIds = ['P1-001', 'P1-001'];
assert.equal(buildOrganizationActivityThreshold(duplicateWithinCondition), null, 'a person cannot be selected twice in one condition');

const excessiveMinCount = validForm();
excessiveMinCount.paths[0].conditions[0].minCount = '2';
assert.equal(buildOrganizationActivityThreshold(excessiveMinCount), null, 'condition count cannot exceed its selected people');

const invalidBoundaries = validForm();
invalidBoundaries.paths[0].conditions[0].pleasantnessMin = '101';
assert.equal(buildOrganizationActivityThreshold(invalidBoundaries), null);
invalidBoundaries.paths[0].conditions[0].pleasantnessMin = '-1';
assert.equal(buildOrganizationActivityThreshold(invalidBoundaries), null);
invalidBoundaries.paths[0].conditions[0].pleasantnessMin = '1.5';
assert.equal(buildOrganizationActivityThreshold(invalidBoundaries), null);

const invalidGlobal = validForm();
invalidGlobal.minimumPleasantness = '100.1';
assert.equal(buildOrganizationActivityThreshold(invalidGlobal), null);

assert.deepEqual(buildSingleCustomerActivityThreshold({ supportMin: '0', pleasantnessMin: '100' }), { supportMin: 0, pleasantnessMin: 100 });
assert.equal(buildSingleCustomerActivityThreshold({ supportMin: '15', pleasantnessMin: '101' }), null);

const completeThresholds = {
  ...Object.fromEntries(ORGANIZATION_CUSTOMER_ACTIVITY_TYPES.map((type) => [
  type,
  { organization: buildOrganizationActivityThreshold(validForm()) },
  ])),
  hospitality: { ...HOSPITALITY_ACTIVITY_DEFAULT_THRESHOLD },
} as const;
const completeNumeric = { mode: 'numeric', thresholds: completeThresholds } as const;
assert.deepEqual(parseCustomerActivityDecisionConfigWrite(completeNumeric), completeNumeric);
assert.equal(parseCustomerActivityDecisionConfigWrite({
  mode: 'numeric',
  thresholds: { ...completeThresholds, company_visit: undefined },
}), null, 'new numeric writes require team rules for all three activities');

function thresholdToForm(threshold: OrganizationActivityThreshold): OrganizationActivityThresholdForm {
  return {
    minimumPleasantness: String(threshold.minimumPleasantness),
    paths: threshold.paths.map((path) => ({
      id: path.id,
      label: path.label,
      conditions: path.conditions.map((condition, index) => ({
        id: `${path.id}-condition-${index}`,
        npcIds: [...condition.npcIds],
        minCount: String(condition.minCount),
        supportMin: String(condition.supportMin),
        pleasantnessMin: String(condition.pleasantnessMin),
      })),
    })),
  };
}

const recommendedThresholds = Object.fromEntries(ORGANIZATION_CUSTOMER_ACTIVITY_TYPES.map((type) => {
  const form = thresholdToForm(RECOMMENDED_ORGANIZATION_ACTIVITY_THRESHOLDS[type]);
  const built = buildOrganizationActivityThreshold(form);
  assert.ok(built, `${type} recommendation is valid in the editor`);
  assert.deepEqual(built, RECOMMENDED_ORGANIZATION_ACTIVITY_THRESHOLDS[type], `${type} recommendation survives form editing`);
  return [type, { organization: built }];
})) as Record<(typeof ORGANIZATION_CUSTOMER_ACTIVITY_TYPES)[number], { organization: OrganizationActivityThreshold }>;
const recommendedConfig = { ...recommendedThresholds, hospitality: { ...HOSPITALITY_ACTIVITY_DEFAULT_THRESHOLD } };
assert.ok(parseCustomerActivityDecisionConfigWrite({ mode: 'numeric', thresholds: recommendedConfig }), 'all three team configurations and hospitality threshold can be written');

const legacyThresholds = {
  technical_meeting: { supportMin: 55, pleasantnessMin: 50 },
  case_site_visit: { supportMin: 60, pleasantnessMin: 55 },
  company_visit: { supportMin: 65, pleasantnessMin: 60 },
  hospitality: { ...HOSPITALITY_ACTIVITY_DEFAULT_THRESHOLD },
};
assert.equal(parseCustomerActivityDecisionConfigWrite({ mode: 'numeric', thresholds: legacyThresholds }), null, 'new numeric writes reject legacy single-person thresholds');
assert.deepEqual(parseCustomerActivityDecisionConfigWrite({ mode: 'ai', thresholds: legacyThresholds }), { mode: 'ai', thresholds: legacyThresholds }, 'AI mode can retain legacy values');
const legacyAiWithoutHospitality = { ...legacyThresholds } as Record<string, unknown>;
delete legacyAiWithoutHospitality.hospitality;
assert.deepEqual(
  parseCustomerActivityDecisionConfigWrite({ mode: 'ai', thresholds: legacyAiWithoutHospitality }),
  { mode: 'ai', thresholds: { ...legacyAiWithoutHospitality, hospitality: HOSPITALITY_ACTIVITY_DEFAULT_THRESHOLD } },
  'older AI config writes receive the default single-customer hospitality thresholds',
);

console.log('客户活动团队及单客户门槛表单与写入校验回归通过');
