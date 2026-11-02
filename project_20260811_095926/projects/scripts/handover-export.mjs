#!/usr/bin/env node

import dotenv from 'dotenv';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(projectRoot, '.env.local'), quiet: true });
dotenv.config({ path: path.join(projectRoot, '.env'), quiet: true });

const PAGE_SIZE = 1000;
const env = process.env;
const url = env.SUPABASE_URL?.replace(/\/$/, '');
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
const secretValues = Object.entries(env)
  .filter(([name, value]) => /(?:KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL)/i.test(name) && value && value.length >= 10)
  .map(([, value]) => value)
  .sort((a, b) => b.length - a.length);
const redactionCounts = new Map();
const excludedFieldCounts = new Map();
let fetchRequest = globalThis.fetch;
const sensitiveFieldNames = new Set([
  'password', 'passwd', 'password_hash', 'passwordhash', 'encrypted_password', 'encryptedpassword', 'hashed_password', 'hashedpassword',
  'api_key', 'apikey', 'service_role_key', 'servicerolekey', 'anon_key', 'anonkey', 'client_secret', 'clientsecret', 'api_secret', 'apisecret', 'private_key', 'privatekey',
  'access_token', 'accesstoken', 'refresh_token', 'refreshtoken', 'session_token', 'sessiontoken', 'login_token', 'logintoken', 'id_token', 'idtoken',
  'confirmation_token', 'confirmationtoken', 'recovery_token', 'recoverytoken', 'email_change_token_new', 'emailchangetokennew',
  'email_change_token_current', 'emailchangetokencurrent', 'reauthentication_token', 'reauthenticationtoken', 'phone_change_token', 'phonechangetoken',
  'cookie', 'set_cookie', 'setcookie',
]);

function isSensitiveField(key) {
  const normalized = key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return sensitiveFieldNames.has(normalized)
    || /(?:^|_)api_key(?:_|$)/.test(normalized)
    || /(?:^|_)service_role_key(?:_|$)/.test(normalized)
    || /(?:^|_)(?:access|refresh|session|login|id|confirmation|recovery|email_change|reauthentication|phone_change)_token$/.test(normalized)
    || /(?:^|_)(?:password_hash|hashed_password|encrypted_password|service_role_key|anon_key|client_secret|api_secret|private_key)$/.test(normalized);
}

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out' && argv[i + 1]) result.out = argv[++i];
    else if (argv[i] === '--proxy' && argv[i + 1]) result.proxy = argv[++i];
    else if (argv[i] === '--help' || argv[i] === '-h') result.help = true;
    else throw new Error(`Unknown or incomplete argument: ${argv[i]}`);
  }
  return result;
}

function scrub(text) {
  let result = String(text);
  for (const secret of secretValues) result = result.split(secret).join('[REDACTED]');
  return result;
}

function redactData(value, location, table, fieldPath = '$') {
  if (typeof value === 'string') {
    let result = value;
    let hits = 0;
    for (const secret of secretValues) {
      if (!result.includes(secret)) continue;
      result = result.split(secret).join('[REDACTED]');
      hits += 1;
    }
    if (hits > 0) {
      const key = `${table}.${fieldPath}`;
      redactionCounts.set(key, (redactionCounts.get(key) ?? 0) + hits);
    }
    return result;
  }
  if (Array.isArray(value)) return value.map((item, index) => redactData(item, location, table, `${fieldPath}[${index}]`));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
      const childPath = fieldPath === '$' ? key : `${fieldPath}.${key}`;
      if (isSensitiveField(key)) {
        const countKey = `${table}.${childPath}`;
        excludedFieldCounts.set(countKey, (excludedFieldCounts.get(countKey) ?? 0) + 1);
        return [];
      }
      return [[key, redactData(item, location, table, childPath)]];
    }));
  }
  return value;
}

function encodePath(value) {
  return value.split('/').map(encodeURIComponent).join('/');
}

function safePath(root, relative) {
  const target = path.resolve(root, relative);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error('Backup path escaped output directory');
  return target;
}

function safeName(value) {
  return value.replace(/[^a-zA-Z0-9_.-]/g, '_');
}

function redactBuffer(input, contentType = '') {
  let output = input;
  let replacements = 0;
  for (const secret of secretValues) {
    const needle = Buffer.from(secret, 'utf8');
    if (!needle.length || !output.includes(needle)) continue;
    const isText = /^(?:text\/|application\/(?:json|xml|javascript|x-www-form-urlencoded))/i.test(contentType);
    if (!isText) throw new Error('A configured secret value occurs in a binary or untyped Storage object; it was skipped to avoid corrupting the file.');
    let secretReplacements = 0;
    const chunks = [];
    let offset = 0;
    while (true) {
      const index = output.indexOf(needle, offset);
      if (index < 0) break;
      chunks.push(output.subarray(offset, index), Buffer.from('[REDACTED]'));
      offset = index + needle.length;
      replacements += 1;
      secretReplacements += 1;
    }
    if (secretReplacements) {
      chunks.push(output.subarray(offset));
      output = Buffer.concat(chunks);
    }
  }
  if (replacements) redactionCounts.set('storage.binary_content', (redactionCounts.get('storage.binary_content') ?? 0) + replacements);
  return output;
}

function removeAuthCredentials(user) {
  const excluded = [];
  const credentialKey = (key) => {
    return isSensitiveField(key);
  };
  const visit = (value, current = '$') => {
    if (Array.isArray(value)) return value.map((item, index) => visit(item, `${current}[${index}]`));
    if (!value || typeof value !== 'object') return redactData(value, null, 'auth.users', current);
    return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
      if (credentialKey(key)) {
        excluded.push(`${current}.${key}`);
        return [];
      }
      return [[key, visit(item, `${current}.${key}`)]];
    }));
  };
  return { user: visit(user), excluded };
}

async function exportAuthUsers(authBase, headers, output) {
  const users = [];
  const excludedFields = new Set();
  let page = 1;
  let total = null;
  while (true) {
    const response = await requestJson(`${authBase}/admin/users?page=${page}&per_page=${PAGE_SIZE}`, headers);
    const payload = await response.json();
    const pageUsers = Array.isArray(payload) ? payload : payload.users;
    if (!Array.isArray(pageUsers)) throw new Error('Auth admin users endpoint did not return a user array');
    for (const user of pageUsers) {
      const cleaned = removeAuthCredentials(user);
      users.push(cleaned.user);
      cleaned.excluded.forEach((field) => excludedFields.add(field.replace(/\[\d+\]/g, '[]')));
    }
    if (Number.isFinite(payload.total)) total = payload.total;
    if (pageUsers.length < PAGE_SIZE || (total != null && users.length >= total)) break;
    page += 1;
  }
  const filename = 'auth/users.json';
  await fs.mkdir(path.dirname(safePath(output, filename)), { recursive: true });
  await fs.writeFile(safePath(output, filename), `${JSON.stringify(users, null, 2)}\n`, 'utf8');
  return { file: filename, users: users.length, reported_total: total, count_verified: total == null ? null : users.length === total, excluded_credential_fields: [...excludedFields].sort() };
}

async function configureProxy(proxyUrl) {
  if (!proxyUrl) return;
  // Next ships undici as a pinned pnpm transitive dependency in this project.
  // Loading it dynamically keeps direct connections dependency-free.
  const pnpmRoot = path.join(projectRoot, 'node_modules', '.pnpm');
  let packageDir;
  try {
    packageDir = (await fs.readdir(pnpmRoot)).find((name) => name.startsWith('undici@'));
  } catch {
    throw new Error("--proxy was provided, but the project's pnpm undici package was not found");
  }
  if (!packageDir) throw new Error("--proxy was provided, but the project's pnpm undici package was not found");
  const require = createRequire(import.meta.url);
  const undici = require(path.join(pnpmRoot, packageDir, 'node_modules', 'undici'));
  undici.setGlobalDispatcher(new undici.ProxyAgent(proxyUrl));
  fetchRequest = undici.fetch;
}

async function requestJson(endpoint, headers, options = {}) {
  let response;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      response = await fetchRequest(endpoint, {
        ...options,
        signal: options.signal ?? AbortSignal.timeout(60_000),
        headers: { ...headers, ...options.headers },
      });
      if ((response.status === 429 || response.status >= 500) && attempt < 3) {
        await response.arrayBuffer();
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
        continue;
      }
      break;
    } catch (error) {
      if (attempt >= 3) throw new Error(`Network request failed at ${scrub(new URL(endpoint).pathname)}: ${scrub(error.message)}`);
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  if (!response.ok) {
    const detail = scrub((await response.text()).slice(0, 600));
    throw new Error(`HTTP ${response.status} at ${scrub(new URL(endpoint).pathname)}: ${detail}`);
  }
  return response;
}

async function listTables(apiBase, headers, schemaFile) {
  try {
    const response = await requestJson(`${apiBase}/`, { ...headers, accept: 'application/openapi+json, application/json' });
    const openApi = await response.json();
    const tables = new Set();
    for (const [route, details] of Object.entries(openApi.paths ?? {})) {
      const match = route.match(/^\/([a-zA-Z_][a-zA-Z0-9_]*)$/);
      if (!match || match[1].toLowerCase() === 'rpc') continue;
      const supportsRead = Object.values(details ?? {}).some((method) => method && typeof method === 'object' && method.responses);
      if (supportsRead) tables.add(match[1]);
    }
    if (!tables.size) throw new Error('OpenAPI response did not list readable public tables');
    return { tables: [...tables].sort(), source: 'postgrest-openapi' };
  } catch (error) {
    // The ORM schema is a useful fallback list, but cannot establish that every deployed table is represented.
    const schema = await fs.readFile(schemaFile, 'utf8');
    const tables = [...new Set([...schema.matchAll(/pgTable\(\s*["']([a-zA-Z_][a-zA-Z0-9_]*)["']/g)].map((match) => match[1]))].sort();
    if (!tables.length) throw new Error(`Could not discover tables: ${scrub(error.message)}`);
    return { tables, source: 'drizzle-schema-fallback', warning: scrub(error.message) };
  }
}

async function exportTable(apiBase, headers, table, output) {
  const rows = [];
  const seenIds = new Set();
  let offset = 0;
  let pages = 0;
  let reportedTotal = null;
  const endpointBase = `${apiBase}/${encodeURIComponent(table)}?select=*`;
  while (true) {
    const response = await requestJson(`${endpointBase}&limit=${PAGE_SIZE}&offset=${offset}`, {
      ...headers,
      prefer: 'count=exact',
      accept: 'application/json',
    }, { headers: { range: `${offset}-${offset + PAGE_SIZE - 1}` } });
    const page = await response.json();
    if (!Array.isArray(page)) throw new Error(`Expected array response for table ${table}`);
    for (const row of page) {
      if (row && Object.prototype.hasOwnProperty.call(row, 'id') && row.id != null) {
        if (seenIds.has(String(row.id))) throw new Error(`Duplicate id encountered while paging table ${table}; row count cannot be trusted`);
        seenIds.add(String(row.id));
      }
      rows.push(redactData(row, null, table));
    }
    pages += 1;
    offset += page.length;
    const contentRange = response.headers.get('content-range');
    const totalText = contentRange?.split('/')[1];
    const total = totalText && totalText !== '*' ? Number(totalText) : null;
    if (reportedTotal == null && Number.isFinite(total)) reportedTotal = total;
    if (page.length === 0 && Number.isFinite(total) && offset < total) {
      throw new Error(`Table ${table} returned no rows before the reported total ${total}`);
    }
    if (page.length < PAGE_SIZE || (Number.isFinite(total) && offset >= total)) break;
  }
  const filename = `tables/${safeName(table)}.json`;
  await fs.mkdir(path.dirname(safePath(output, filename)), { recursive: true });
  await fs.writeFile(safePath(output, filename), `${JSON.stringify(rows, null, 2)}\n`, 'utf8');
  return { table, file: filename, rows: rows.length, pages, reported_total: reportedTotal, count_verified: reportedTotal == null ? null : reportedTotal === rows.length };
}

async function storageRequest(storageBase, headers, pathname, options) {
  return requestJson(`${storageBase}${pathname}`, headers, options);
}

async function exportStorage(storageBase, headers, output) {
  const bucketResponse = await storageRequest(storageBase, headers, '/bucket', {});
  const buckets = await bucketResponse.json();
  if (!Array.isArray(buckets)) throw new Error('Storage bucket endpoint did not return an array');
  const objectRecords = [];
  const errors = [];
  const walk = async (bucket, prefix = '') => {
    if (scrub(bucket.id) !== bucket.id) throw new Error('A configured secret value occurs in a Storage bucket name; bucket was skipped.');
    let offset = 0;
    while (true) {
      const response = await storageRequest(storageBase, headers, `/object/list/${encodeURIComponent(bucket.id)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prefix, limit: PAGE_SIZE, offset, sortBy: { column: 'name', order: 'asc' } }),
      });
      const entries = await response.json();
      if (!Array.isArray(entries)) throw new Error(`Invalid object listing for bucket ${bucket.id}/${prefix}`);
      for (const entry of entries) {
        const objectPath = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.id == null && entry.metadata == null) {
          if (scrub(objectPath) !== objectPath) throw new Error('A configured secret value occurs in a Storage object path; folder was skipped.');
          await walk(bucket, objectPath);
          continue;
        }
        const objectPathHash = createHash('sha256').update(objectPath, 'utf8').digest('hex');
        const extension = path.extname(objectPath).replace(/[^a-zA-Z0-9.]/g, '').slice(0, 16);
        const relative = `storage/${safeName(bucket.id)}/${objectPathHash}${extension}`;
        try {
          if (scrub(objectPath) !== objectPath) throw new Error('A configured secret value occurs in an object path; object was skipped.');
          const fileResponse = await storageRequest(storageBase, headers, `/object/${encodeURIComponent(bucket.id)}/${encodePath(objectPath)}`, {});
          const bytes = redactBuffer(Buffer.from(await fileResponse.arrayBuffer()), fileResponse.headers.get('content-type') ?? '');
          const target = safePath(output, relative);
          await fs.mkdir(path.dirname(target), { recursive: true });
          await fs.writeFile(target, bytes);
          objectRecords.push({
            bucket: bucket.id,
            path: objectPath,
            file: relative,
            bytes: bytes.length,
            sha256: createHash('sha256').update(bytes).digest('hex'),
            metadata: redactData(entry.metadata ?? null, null, 'storage.metadata', '$'),
            created_at: entry.created_at ?? null,
            updated_at: entry.updated_at ?? null,
          });
        } catch (error) {
          errors.push({ bucket: scrub(bucket.id), path: scrub(objectPath), error: scrub(error.message) });
        }
      }
      offset += entries.length;
      if (entries.length < PAGE_SIZE) break;
    }
  };
  for (const bucket of buckets) {
    try {
      await walk(bucket);
    } catch (error) {
      errors.push({ bucket: scrub(bucket.id), path: '', error: scrub(error.message) });
    }
  }
  return {
    buckets: buckets.filter((bucket) => scrub(bucket.id) === bucket.id).map(({ id, name, public: isPublic, file_size_limit, allowed_mime_types }) => redactData({ id, name, public: isPublic, file_size_limit, allowed_mime_types }, null, 'storage.buckets')),
    objects: objectRecords,
    errors,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node scripts/handover-export.mjs [--out <directory>] [--proxy <proxy-url>]');
    return;
  }
  if (!url || !serviceKey) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in projects/.env.local');
  await configureProxy(args.proxy);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const output = path.resolve(args.out ?? path.join(projectRoot, '..', '..', 'outputs', `handover-data-${timestamp}`));
  await fs.mkdir(output, { recursive: true });
  const apiBase = `${url}/rest/v1`;
  const storageBase = `${url}/storage/v1`;
  const authBase = `${url}/auth/v1`;
  const headers = { apikey: serviceKey, authorization: `Bearer ${serviceKey}` };
  const manifest = {
    format: 'weixun-handover-data-v1',
    started_at: new Date().toISOString(),
    source_url: scrub(new URL(url).origin),
    snapshot_consistency: 'REST requests are paginated over time; this is not a transactionally consistent point-in-time snapshot.',
    credentials_exported: false,
    auth_users_exported: false,
    auth_users: null,
    schema_ddl_exported: false,
    table_discovery: null,
    tables: [],
    storage: null,
    redactions: [],
    warnings: [],
    errors: [],
  };
  const tableDiscovery = await listTables(apiBase, headers, path.join(projectRoot, 'src', 'storage', 'database', 'shared', 'schema.ts'));
  manifest.table_discovery = { source: tableDiscovery.source, tables_found: tableDiscovery.tables.length };
  if (tableDiscovery.warning) manifest.table_discovery.warning = tableDiscovery.warning;
  await fs.mkdir(path.join(output, 'tables'), { recursive: true });
  for (const table of tableDiscovery.tables) {
    try {
      const record = await exportTable(apiBase, headers, table, output);
      manifest.tables.push(record);
      if (record.count_verified === false) {
        manifest.errors.push({ scope: 'table_count', table, error: `Exported ${record.rows} row(s), API reported ${record.reported_total}` });
      } else if (record.count_verified == null) {
        manifest.errors.push({ scope: 'table_count', table, error: 'PostgREST did not provide a total row count; completeness is unverified' });
      }
      console.log(`Table ${table}: ${record.rows} row(s)`);
    } catch (error) {
      manifest.errors.push({ scope: 'table', table, error: scrub(error.message) });
      console.error(`Table ${table}: export failed`);
    }
  }
  try {
    manifest.auth_users = await exportAuthUsers(authBase, headers, output);
    manifest.auth_users_exported = true;
  } catch (error) {
    manifest.auth_users = { users: null, error: scrub(error.message) };
    manifest.warnings.push({ scope: 'auth.users', error: scrub(error.message) });
  }
  try {
    manifest.storage = await exportStorage(storageBase, headers, output);
    console.log(`Storage: ${manifest.storage.buckets.length} bucket(s), ${manifest.storage.objects.length} object(s)`);
    manifest.errors.push(...manifest.storage.errors.map((entry) => ({ scope: 'storage', ...entry })));
  } catch (error) {
    manifest.storage = { buckets: [], objects: [], errors: [{ error: scrub(error.message) }] };
    manifest.errors.push({ scope: 'storage', error: scrub(error.message) });
  }
  manifest.redactions = [...redactionCounts.entries()].map(([field, replacements]) => ({ field, replacements }));
  manifest.excluded_credential_fields = [...excludedFieldCounts.entries()].map(([field, values]) => ({ field, values }));
  manifest.finished_at = new Date().toISOString();
  manifest.duration_seconds = (Date.parse(manifest.finished_at) - Date.parse(manifest.started_at)) / 1000;
  manifest.summary = {
    tables_discovered: tableDiscovery.tables.length,
    tables_exported: manifest.tables.length,
    rows_exported: manifest.tables.reduce((sum, table) => sum + table.rows, 0),
    buckets: manifest.storage.buckets.length,
    objects: manifest.storage.objects.length,
    auth_users: manifest.auth_users?.users ?? null,
    storage_bytes: manifest.storage.objects.reduce((sum, object) => sum + object.bytes, 0),
    errors: manifest.errors.length,
    redacted_fields: manifest.redactions.length,
    warnings: manifest.warnings.length,
  };
  await fs.writeFile(safePath(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`Backup directory: ${output}`);
  console.log(`Manifest: ${path.join(output, 'manifest.json')}`);
  if (manifest.errors.length) process.exitCode = 2;
}

main().catch((error) => {
  console.error(scrub(error.message));
  process.exitCode = 1;
});
