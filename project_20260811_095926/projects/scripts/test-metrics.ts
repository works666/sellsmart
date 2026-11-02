import assert from 'node:assert/strict';
import { Script } from 'node:vm';
import { aMetrics, cMetrics } from '../src/lib/metrics-data';
import { validateMetricFormula } from '../src/lib/metrics-validation';

const knownATags = new Set(aMetrics.map((metric) => metric.tag));
const c0 = cMetrics.find((metric) => metric.tag === 'C0');
assert.ok(c0, 'C0 metric must exist');

const c0Issues = validateMetricFormula(c0.formula, knownATags);
const repairedC0Formula =
  'MAX(0,MIN(100,A13))*0.4+MAX(0,MIN(100,A5))*0.4+MAX(0,MIN(100,A31/4*100))*0.1+MAX(0,MIN(100,A46/6*100))*0.1';
assert.equal(
  c0.formula,
  repairedC0Formula,
  'C0 must use the repaired acceptance formula',
);
assert.deepEqual(c0Issues, [], 'C0 must have only known A references and balanced parentheses');

const evaluateC0 = (values: { A13: number; A5: number; A31: number; A46: number }) =>
  new Script(repairedC0Formula).runInNewContext({
    ...values,
    MAX: Math.max,
    MIN: Math.min,
  }) as number;

assert.equal(evaluateC0({ A13: 0, A5: 0, A31: 0, A46: 0 }), 0, 'zero inputs must produce zero');
assert.equal(evaluateC0({ A13: 100, A5: 100, A31: 4, A46: 6 }), 100, 'full normalized inputs must produce 100');
assert.equal(evaluateC0({ A13: -10, A5: -1, A31: -4, A46: -6 }), 0, 'negative inputs must clamp to zero');
assert.equal(evaluateC0({ A13: Number.MAX_VALUE, A5: Number.MAX_VALUE, A31: Number.MAX_VALUE, A46: Number.MAX_VALUE }), 100, 'extreme positive inputs must clamp to 100');

assert.ok(
  evaluateC0({ A13: 75, A5: 0, A31: 0, A46: 0 }) > evaluateC0({ A13: 25, A5: 0, A31: 0, A46: 0 }),
  'higher direct acceptance must not lower C0',
);
assert.ok(
  evaluateC0({ A13: 0, A5: 75, A31: 0, A46: 0 }) > evaluateC0({ A13: 0, A5: 25, A31: 0, A46: 0 }),
  'higher AI acceptance must not lower C0',
);
assert.equal(evaluateC0({ A13: 0, A5: 0, A31: 4, A46: 0 }), 10, 'praise count contributes at most 10 points');
assert.equal(evaluateC0({ A13: 0, A5: 0, A31: 8, A46: 0 }), 10, 'praise count is capped at four normalized events');
assert.equal(evaluateC0({ A13: 0, A5: 0, A31: 0, A46: 6 }), 10, 'question count contributes at most 10 points');
assert.equal(evaluateC0({ A13: 0, A5: 0, A31: 0, A46: 12 }), 10, 'question count is capped at six normalized events');

const validFormulaIssues = validateMetricFormula('MAX(50,MIN(100,A13+A34))', knownATags);
assert.deepEqual(validFormulaIssues, []);

console.log('metrics validation tests passed; C0 formula is valid');
