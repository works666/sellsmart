import assert from 'node:assert/strict';
import {
  isSystemEvaluationSnapshotId,
  parseSystemEvaluationThreshold,
  parseSystemEvaluationTurns,
  systemEvaluationFilename,
  validateSystemEvaluationTurns,
} from '../src/lib/designer/system-evaluation-ui';

assert.deepEqual(parseSystemEvaluationTurns('  第 1 轮  \r\n\r\n第 2 轮\n'), ['第 1 轮', '第 2 轮']);
assert.equal(validateSystemEvaluationTurns(['一轮']), null);
assert.equal(validateSystemEvaluationTurns([]), '请填写 1 到 3 轮销售话术。');
assert.equal(validateSystemEvaluationTurns(['一轮', '二轮', '三轮', '四轮']), '请填写 1 到 3 轮销售话术。');
assert.equal(validateSystemEvaluationTurns(['x'.repeat(2_001)]), '每轮销售话术最多 2000 个字符。');
assert.equal(parseSystemEvaluationThreshold('0.7'), 0.7);
assert.equal(parseSystemEvaluationThreshold('1.01'), null);
assert.equal(parseSystemEvaluationThreshold('not-a-number'), null);
assert.equal(isSystemEvaluationSnapshotId('b4f3c2d1-9a87-4b65-8c43-1234567890ab'), true);
assert.equal(isSystemEvaluationSnapshotId('not-a-session-id'), false);
assert.equal(systemEvaluationFilename('run/2026 test'), 'sellsmart-system-evaluation-run2026test.json');

console.log('System evaluation UI helper checks passed.');
