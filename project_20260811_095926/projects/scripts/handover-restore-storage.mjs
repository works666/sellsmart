#!/usr/bin/env node

import dotenv from 'dotenv';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(projectRoot, '.env.local'), quiet: true });
dotenv.config({ path: path.join(projectRoot, '.env'), quiet: true });
const secrets = Object.entries(process.env)
  .filter(([name, value]) => /(?:KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL)/i.test(name) && value && value.length >= 10)
  .map(([, value]) => value);

function scrub(text) {
  let result = String(text);
  for (const secret of secrets) result = result.split(secret).join('[REDACTED]');
  return result;
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--data' && argv[index + 1]) args.data = path.resolve(argv[++index]);
    else if (argv[index] === '--proxy' && argv[index + 1]) args.proxy = argv[++index];
    else if (argv[index] === '--apply') args.apply = true;
    else if (argv[index] === '--help' || argv[index] === '-h') args.help = true;
    else throw new Error(`Unknown or incomplete argument: ${argv[index]}`);
  }
  return args;
}

async function configureProxy(proxyUrl) {
  if (!proxyUrl) return;
  const pnpmRoot = path.join(projectRoot, 'node_modules', '.pnpm');
  const packageDir = (await fs.readdir(pnpmRoot)).find((name) => name.startsWith('undici@'));
  if (!packageDir) throw new Error('--proxy was provided, but the project undici package was not found');
  const require = createRequire(import.meta.url);
  const undici = require(path.join(pnpmRoot, packageDir, 'node_modules', 'undici'));
  undici.setGlobalDispatcher(new undici.ProxyAgent(proxyUrl));
}

function safeBackupPath(dataDir, relative) {
  const root = path.resolve(dataDir);
  const target = path.resolve(root, relative);
  if (!target.startsWith(`${root}${path.sep}`)) throw new Error(`Unsafe backup file path: ${relative}`);
  return target;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node scripts/handover-restore-storage.mjs --data <backup-directory> [--proxy <proxy-url>] [--apply]');
    console.log('Without --apply, verifies local files and target bucket access only.');
    return;
  }
  if (!args.data) throw new Error('Specify --data <backup-directory>');
  const targetUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!targetUrl || !serviceKey) throw new Error('Set target SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in projects/.env.local');
  const dataDir = args.data;
  const manifest = JSON.parse(await fs.readFile(path.join(dataDir, 'manifest.json'), 'utf8'));
  if (manifest.format !== 'weixun-handover-data-v1' || manifest.errors?.length) {
    throw new Error('Backup format is unknown or the manifest contains export errors');
  }
  if (manifest.table_discovery?.source !== 'postgrest-openapi'
      || manifest.summary?.tables_exported !== manifest.summary?.tables_discovered) {
    throw new Error('The backup does not confirm complete table discovery and export');
  }
  if (manifest.storage?.errors?.length || manifest.summary?.objects !== manifest.storage?.objects?.length) {
    throw new Error('The backup does not confirm complete Storage export');
  }
  if (args.apply && new URL(targetUrl).origin === new URL(manifest.source_url).origin) {
    throw new Error('Refusing to upload a restore back to the source Supabase project; point .env.local at a different target.');
  }
  const files = [];
  for (const object of manifest.storage.objects) {
    const bytes = await fs.readFile(safeBackupPath(dataDir, object.file));
    if (bytes.length !== object.bytes || sha256(bytes) !== object.sha256) {
      throw new Error(`Backup checksum mismatch: ${object.file}`);
    }
    files.push({ object, bytes });
  }
  await configureProxy(args.proxy);
  const client = createClient(targetUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: buckets, error: listError } = await client.storage.listBuckets();
  if (listError) throw new Error(`Could not inspect target Storage buckets: ${scrub(listError.message)}`);
  const currentBuckets = new Map((buckets ?? []).map((bucket) => [bucket.id, bucket]));
  console.log(`Local verification passed: ${manifest.storage.buckets.length} bucket(s), ${files.length} object(s).`);
  console.log(`Target Supabase: ${scrub(new URL(targetUrl).origin)}`);
  if (!args.apply) {
    for (const bucket of manifest.storage.buckets) {
      const current = currentBuckets.get(bucket.id);
      console.log(`  ${bucket.id}: ${current ? 'exists' : 'will be created'}, ${bucket.public ? 'public' : 'private'}`);
    }
    console.log('Dry run complete. No Storage changes were made; pass --apply to create/update buckets and upload objects.');
    return;
  }
  for (const bucket of manifest.storage.buckets) {
    const options = {
      public: bucket.public,
      fileSizeLimit: bucket.file_size_limit ?? undefined,
      allowedMimeTypes: bucket.allowed_mime_types ?? undefined,
    };
    const result = currentBuckets.has(bucket.id)
      ? await client.storage.updateBucket(bucket.id, options)
      : await client.storage.createBucket(bucket.id, options);
    if (result.error) throw new Error(`Could not prepare bucket ${bucket.id}: ${scrub(result.error.message)}`);
  }
  for (const { object, bytes } of files) {
    const { error: uploadError } = await client.storage.from(object.bucket).upload(object.path, bytes, {
      upsert: true,
      contentType: object.metadata?.mimetype ?? 'application/octet-stream',
    });
    if (uploadError) throw new Error(`Upload failed for ${object.bucket}/${object.path}: ${scrub(uploadError.message)}`);
    const { data, error: downloadError } = await client.storage.from(object.bucket).download(object.path);
    if (downloadError || !data) throw new Error(`Post-upload readback failed for ${object.bucket}/${object.path}: ${scrub(downloadError?.message ?? 'empty response')}`);
    const readback = Buffer.from(await data.arrayBuffer());
    if (readback.length !== object.bytes || sha256(readback) !== object.sha256) {
      throw new Error(`Post-upload checksum mismatch for ${object.bucket}/${object.path}`);
    }
  }
  console.log(`Storage restore verified: ${manifest.storage.buckets.length} bucket(s), ${files.length} object(s).`);
}

main().catch((error) => {
  console.error(scrub(error.message));
  process.exitCode = 1;
});
