import { createHmac } from 'node:crypto';

function getGameRandomSecret(): string {
  const secret = process.env.GAME_RANDOM_SECRET
    || process.env.SESSION_SECRET
    || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error('GAME_RANDOM_SECRET_NOT_SET');
  return secret;
}

export function deriveServerProbabilitySeed(secret: string, parts: Array<string | number | boolean>): string {
  return createHmac('sha256', secret)
    .update(parts.map((part) => String(part)).join('\u001f'))
    .digest('hex');
}

/** Server-only deterministic seed. Never return the secret or raw seed to clients. */
export function createServerProbabilitySeed(parts: Array<string | number | boolean>): string {
  return deriveServerProbabilitySeed(getGameRandomSecret(), parts);
}
