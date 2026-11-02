export const SYSTEM_EVALUATION_DEFAULT_TURNS = [
  '您好，我想了解一下这个项目当前最需要解决的问题。',
  '如果方案能回应这些问题，您觉得还需要哪些依据？',
  '涉及预算和决策流程，有哪些您方便介绍的内容？',
].join('\n');

export const SYSTEM_EVALUATION_DEFAULT_EXPECTATION =
  '依据本轮真实角色、支持度、愉悦度、历史和记忆合理回应，不编造内部事实或承诺；熟悉度只依据真实历史，不自行假设。';

export function parseSystemEvaluationTurns(value: string): string[] {
  return value.split(/\r?\n/).map((turn) => turn.trim()).filter(Boolean);
}

export function validateSystemEvaluationTurns(turns: string[]): string | null {
  if (turns.length < 1 || turns.length > 3) return '请填写 1 到 3 轮销售话术。';
  if (turns.some((turn) => turn.length > 2_000)) return '每轮销售话术最多 2000 个字符。';
  return null;
}

export function parseSystemEvaluationThreshold(value: string): number | null {
  if (!value.trim()) return null;
  const threshold = Number(value);
  return Number.isFinite(threshold) && threshold >= 0 && threshold <= 1 ? threshold : null;
}

export function isSystemEvaluationSnapshotId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());
}

export function systemEvaluationFilename(runId: string): string {
  const safeRunId = runId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) || 'report';
  return `sellsmart-system-evaluation-${safeRunId}.json`;
}
