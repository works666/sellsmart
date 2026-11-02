export const FAST_ACCEPTANCE_ACCOUNT = {
  username: 'fast_acceptance',
  password: 'fastpass',
  multiplier: 3,
} as const;

export function isFastAcceptanceUser(userId: string): boolean {
  return userId === `u_${FAST_ACCEPTANCE_ACCOUNT.username}` || userId.startsWith('u_fast_acceptance_e2e_');
}

export function getProgressionMultiplier(userId: string): number {
  return isFastAcceptanceUser(userId) ? FAST_ACCEPTANCE_ACCOUNT.multiplier : 1;
}
