import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'node:path';

let envLoaded = false;

interface SupabaseCredentials {
  url: string;
  anonKey: string;
}

function loadEnv(): void {
  if (envLoaded) return;
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: false, quiet: true });
  dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: false, quiet: true });
  // The custom Node entrypoint can be launched from the workspace root during
  // desktop validation. Fall back to the application subdirectory so the
  // server still uses the same configured Supabase project as direct scripts.
  if (!process.env.SUPABASE_URL) {
    dotenv.config({ path: path.resolve(process.cwd(), 'projects', '.env.local'), override: false, quiet: true });
    dotenv.config({ path: path.resolve(process.cwd(), 'projects', '.env'), override: false, quiet: true });
  }
  envLoaded = true;
}

function getSupabaseCredentials(): SupabaseCredentials {
  loadEnv();
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url) throw new Error('SUPABASE_URL_NOT_SET');
  if (!anonKey) throw new Error('SUPABASE_ANON_KEY_NOT_SET');
  return { url, anonKey };
}

function getSupabaseServiceRoleKey(): string | undefined {
  loadEnv();
  return process.env.SUPABASE_SERVICE_ROLE_KEY;
}

function getSupabaseClient(token?: string): SupabaseClient {
  const { url, anonKey } = getSupabaseCredentials();
  const serviceRoleKey = getSupabaseServiceRoleKey();
  const key = token ? anonKey : (serviceRoleKey || anonKey);
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
  return createClient(url, key, {
    global: { headers },
    db: { timeout: 60_000 },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function createBrowserClient(): SupabaseClient {
  return getSupabaseClient();
}

export function createServerClient(token?: string): SupabaseClient {
  return getSupabaseClient(token);
}

export function createAdminClient(): SupabaseClient {
  if (!getSupabaseServiceRoleKey()) throw new Error('SUPABASE_SERVICE_ROLE_KEY_NOT_SET');
  return getSupabaseClient();
}

export { loadEnv, getSupabaseCredentials, getSupabaseServiceRoleKey, getSupabaseClient };
