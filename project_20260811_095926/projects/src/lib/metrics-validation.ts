export interface MetricFormulaIssue {
  type: 'unknown-reference' | 'unbalanced-parentheses';
  detail: string;
}

export function validateMetricFormula(formula: string, knownATags: Set<string>): MetricFormulaIssue[] {
  const issues: MetricFormulaIssue[] = [];
  let balance = 0;
  for (const character of formula) {
    if (character === '(') balance += 1;
    if (character === ')') balance -= 1;
    if (balance < 0) break;
  }
  if (balance !== 0) {
    issues.push({ type: 'unbalanced-parentheses', detail: `括号净差：${balance}` });
  }

  const references = formula.match(/A\d+/g) ?? [];
  for (const reference of new Set(references)) {
    if (!knownATags.has(reference)) {
      issues.push({ type: 'unknown-reference', detail: reference });
    }
  }
  return issues;
}
