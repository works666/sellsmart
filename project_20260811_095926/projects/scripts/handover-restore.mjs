#!/usr/bin/env node

import dotenv from 'dotenv';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(projectRoot, '.env.local'), quiet: true });
dotenv.config({ path: path.join(projectRoot, '.env'), quiet: true });

const { Client } = pg;
const seedTables = new Set(['health_check', 'project_scenarios', 'scenario_templates']);
const secretValues = Object.entries(process.env)
  .filter(([name, value]) => /(?:KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|DATABASE_URL)/i.test(name) && value && value.length >= 10)
  .map(([, value]) => value);

function scrub(text) {
  let result = String(text);
  for (const secret of secretValues) result = result.split(secret).join('[REDACTED]');
  return result;
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--data' && argv[index + 1]) args.data = path.resolve(argv[++index]);
    else if (argv[index] === '--database-url-env' && argv[index + 1]) args.databaseUrlEnv = argv[++index];
    else if (argv[index] === '--verify-only') args.verifyOnly = true;
    else if (argv[index] === '--apply') args.apply = true;
    else if (argv[index] === '--help' || argv[index] === '-h') args.help = true;
    else throw new Error(`Unknown or incomplete argument: ${argv[index]}`);
  }
  return args;
}

function quoteIdentifier(identifier) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier)) throw new Error(`Unsafe SQL identifier: ${identifier}`);
  return `"${identifier}"`;
}

function safeBackupPath(dataDir, relative) {
  const root = path.resolve(dataDir);
  const target = path.resolve(root, relative);
  if (!target.startsWith(`${root}${path.sep}`)) throw new Error(`Unsafe backup file path: ${relative}`);
  return target;
}

async function readBackup(dataDir) {
  const manifest = JSON.parse(await fs.readFile(path.join(dataDir, 'manifest.json'), 'utf8'));
  if (manifest.format !== 'weixun-handover-data-v1') throw new Error('Unrecognized backup format');
  if (!Array.isArray(manifest.tables) || !Array.isArray(manifest.errors) || manifest.errors.length) {
    throw new Error('The manifest is incomplete or contains export errors; repair/re-export before restore');
  }
  if (manifest.table_discovery?.source !== 'postgrest-openapi') {
    throw new Error('Table discovery used an ORM fallback, so deployed-table coverage is unverified; re-export before restore');
  }
  if (manifest.summary?.tables_exported !== manifest.summary?.tables_discovered) {
    throw new Error('Not all discovered tables were exported');
  }
  const rowsByTable = new Map();
  for (const tableRecord of manifest.tables) {
    if (tableRecord.count_verified !== true || tableRecord.rows !== tableRecord.reported_total) {
      throw new Error(`Table ${tableRecord.table} has no verified complete row count`);
    }
    const rows = JSON.parse(await fs.readFile(safeBackupPath(dataDir, tableRecord.file), 'utf8'));
    if (!Array.isArray(rows) || rows.length !== tableRecord.rows) throw new Error(`Row count mismatch in ${tableRecord.file}`);
    rowsByTable.set(tableRecord.table, rows);
  }
  for (const object of manifest.storage?.objects ?? []) {
    const file = safeBackupPath(dataDir, object.file);
    const bytes = await fs.readFile(file);
    const { createHash } = await import('node:crypto');
    const actualHash = createHash('sha256').update(bytes).digest('hex');
    if (actualHash !== object.sha256 || bytes.length !== object.bytes) throw new Error(`Storage checksum mismatch: ${object.file}`);
  }
  if (manifest.storage?.errors?.length) throw new Error('Storage export has missing objects; repair/re-export before restore');
  return { manifest, rowsByTable };
}

async function getTargetSchema(client, tableNames) {
  const { rows: relations } = await client.query(`
    SELECT c.relname AS table_name, c.relkind
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])
  `, [tableNames]);
  const relationMap = new Map(relations.map((row) => [row.table_name, row.relkind]));
  const schema = new Map();
  for (const table of tableNames) {
    if (!relationMap.has(table)) throw new Error(`Target database is missing public.${table}; apply project migrations first`);
    if (!['r', 'p'].includes(relationMap.get(table))) throw new Error(`public.${table} is not a physical table and cannot be restored by this script`);
    const { rows: columns } = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default, is_generated, is_identity
      FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position
    `, [table]);
    const { rows: primary } = await client.query(`
      SELECT array_agg(a.attname ORDER BY key_column.ordinality) AS columns
      FROM pg_constraint c
      CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS key_column(attnum, ordinality)
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = key_column.attnum
      JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public' AND t.relname = $1 AND c.contype = 'p'
      GROUP BY c.oid
    `, [table]);
    schema.set(table, { columns, primaryKey: primary[0]?.columns ?? [] });
  }
  return schema;
}

async function getForeignKeyEdges(client, tableNames) {
  const { rows } = await client.query(`
    SELECT child.relname AS child_table, parent.relname AS parent_table
    FROM pg_constraint fk
    JOIN pg_class child ON child.oid = fk.conrelid
    JOIN pg_class parent ON parent.oid = fk.confrelid
    JOIN pg_namespace ns ON ns.oid = child.relnamespace
    WHERE fk.contype = 'f' AND ns.nspname = 'public'
      AND child.relname = ANY($1::text[]) AND parent.relname = ANY($1::text[])
  `, [tableNames]);
  return rows;
}

function topologicalOrder(tableNames, edges) {
  const dependencies = new Map(tableNames.map((table) => [table, new Set()]));
  const children = new Map(tableNames.map((table) => [table, new Set()]));
  for (const { child_table: child, parent_table: parent } of edges) {
    if (child === parent) throw new Error(`Self-referencing foreign key in public.${child} needs a manual data ordering plan`);
    dependencies.get(child).add(parent);
    children.get(parent).add(child);
  }
  const ready = tableNames.filter((table) => dependencies.get(table).size === 0).sort();
  const ordered = [];
  while (ready.length) {
    const table = ready.shift();
    ordered.push(table);
    for (const child of children.get(table)) {
      dependencies.get(child).delete(table);
      if (dependencies.get(child).size === 0) {
        ready.push(child);
        ready.sort();
      }
    }
  }
  if (ordered.length !== tableNames.length) {
    const remaining = tableNames.filter((table) => !ordered.includes(table));
    throw new Error(`Foreign-key cycle prevents safe restore ordering: ${remaining.join(', ')}`);
  }
  return ordered;
}

async function checkTarget(client, rowsByTable, schema) {
  const seedCollisions = new Map();
  for (const [table, sourceRows] of rowsByTable) {
    const { rows: counts } = await client.query(`SELECT count(*)::bigint AS count FROM "public".${quoteIdentifier(table)}`);
    const existingCount = Number(counts[0].count);
    if (!existingCount) continue;
    if (!seedTables.has(table)) throw new Error(`Target public.${table} has ${existingCount} row(s); restore requires an empty business table`);
    const primaryKey = schema.get(table).primaryKey;
    if (!primaryKey.length) throw new Error(`Seed table public.${table} has no primary key; cannot safely distinguish seed from business data`);
    const { rows: existingKeys } = await client.query(`SELECT ${primaryKey.map(quoteIdentifier).join(', ')} FROM "public".${quoteIdentifier(table)}`);
    const sourceKeys = new Set(sourceRows.map((row) => JSON.stringify(primaryKey.map((key) => row[key] ?? null))));
    const unmatched = existingKeys.filter((row) => !sourceKeys.has(JSON.stringify(primaryKey.map((key) => row[key] ?? null))));
    if (unmatched.length) throw new Error(`Target public.${table} contains ${unmatched.length} row(s) absent from the source snapshot; refuse to overwrite unrelated seed/business data`);
    seedCollisions.set(table, existingCount);
  }
  return seedCollisions;
}

function validateColumns(rowsByTable, schema) {
  for (const [table, rows] of rowsByTable) {
    if (!rows.length) continue;
    const info = schema.get(table);
    if (!info.primaryKey.length && rows.length) throw new Error(`public.${table} has no primary key for safe conflict handling`);
    const available = new Set(info.columns.map((column) => column.column_name));
    const supplied = new Set(rows.flatMap((row) => Object.keys(row)));
    const unknown = [...supplied].filter((column) => !available.has(column));
    if (unknown.length) throw new Error(`Target public.${table} has no column(s): ${unknown.join(', ')}`);
    const omittedRequired = info.columns.filter((column) => column.is_nullable === 'NO'
      && column.column_default == null
      && column.is_generated === 'NEVER'
      && !supplied.has(column.column_name));
    if (omittedRequired.length) {
      throw new Error(`Backup omits required target column(s) for public.${table}: ${omittedRequired.map((column) => column.column_name).join(', ')}`);
    }
  }
}

async function importTable(client, table, rows, schema) {
  if (!rows.length) return 0;
  const info = schema.get(table);
  const columns = info.columns
    .filter((column) => column.is_generated !== 'ALWAYS')
    .map((column) => column.column_name)
    .filter((column) => rows.some((row) => Object.hasOwn(row, column)));
  if (!columns.length) return 0;
  const jsonColumns = new Set(info.columns.filter((column) => column.data_type === 'json' || column.data_type === 'jsonb').map((column) => column.column_name));
  const writableColumns = columns.map(quoteIdentifier).join(', ');
  const identityOverride = info.columns.some((column) => column.is_identity === 'ALWAYS' && columns.includes(column.column_name)) ? ' OVERRIDING SYSTEM VALUE' : '';
  const conflictColumns = info.primaryKey.map(quoteIdentifier).join(', ');
  const updates = columns.filter((column) => !info.primaryKey.includes(column));
  const conflictAction = updates.length
    ? `DO UPDATE SET ${updates.map((column) => `${quoteIdentifier(column)} = EXCLUDED.${quoteIdentifier(column)}`).join(', ')}`
    : 'DO NOTHING';
  let total = 0;
  for (let start = 0; start < rows.length; start += 100) {
    const batch = rows.slice(start, start + 100);
    const values = [];
    const tuples = batch.map((row, rowIndex) => {
      const markers = columns.map((column, columnIndex) => {
        let value = Object.hasOwn(row, column) ? row[column] : null;
        if (value != null && jsonColumns.has(column)) value = JSON.stringify(value);
        values.push(value);
        return `$${rowIndex * columns.length + columnIndex + 1}`;
      });
      return `(${markers.join(', ')})`;
    });
    await client.query(`INSERT INTO "public".${quoteIdentifier(table)} (${writableColumns})${identityOverride} VALUES ${tuples.join(', ')} ON CONFLICT (${conflictColumns}) ${conflictAction}`, values);
    total += batch.length;
  }
  return total;
}

async function fixSequences(client, table, schema) {
  const primaryKey = schema.get(table).primaryKey;
  if (primaryKey.length !== 1) return;
  const column = schema.get(table).columns.find((entry) => entry.column_name === primaryKey[0]);
  if (!column || !['smallint', 'integer', 'bigint'].includes(column.data_type)) return;
  const relation = `public.${table}`;
  const { rows } = await client.query('SELECT pg_get_serial_sequence($1, $2) AS sequence', [relation, column.column_name]);
  if (!rows[0]?.sequence) return;
  const { rows: maximum } = await client.query(`SELECT max(${quoteIdentifier(column.column_name)}) AS value FROM "public".${quoteIdentifier(table)}`);
  if (maximum[0].value == null) return;
  await client.query('SELECT setval($1::regclass, $2::bigint, true)', [rows[0].sequence, maximum[0].value]);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node scripts/handover-restore.mjs --data <backup-directory> [--database-url-env DATABASE_URL] [--verify-only] [--apply]');
    console.log('Without --apply, verifies files/schema/target and runs read-only checks only.');
    return;
  }
  if (!args.data) throw new Error('Specify --data <backup-directory>');
  const { manifest, rowsByTable } = await readBackup(args.data);
  if (args.verifyOnly) {
    console.log(`Local backup verification passed: ${rowsByTable.size} table(s), ${manifest.summary.rows_exported} row(s), ${manifest.summary.objects} Storage object(s).`);
    console.log('No database connection or writes were made.');
    return;
  }
  const databaseUrlName = args.databaseUrlEnv ?? 'DATABASE_URL';
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(databaseUrlName)) throw new Error('Invalid environment variable name for database URL');
  const connectionString = process.env[databaseUrlName];
  if (!connectionString) throw new Error(`Set ${databaseUrlName} in projects/.env.local or the process environment`);
  if (args.apply) {
    const sourceHost = new URL(manifest.source_url).hostname.toLowerCase();
    const sourceRef = sourceHost.split('.')[0];
    const target = new URL(connectionString);
    const targetIdentity = `${target.hostname} ${decodeURIComponent(target.username)}`.toLowerCase();
    if (sourceRef && targetIdentity.includes(sourceRef)) {
      throw new Error('Refusing to apply a restore to the source Supabase project; choose a different target database.');
    }
  }
  const client = new Client({ connectionString, connectionTimeoutMillis: 15_000, statement_timeout: 120_000 });
  try {
    await client.connect();
    await client.query(args.apply ? 'BEGIN ISOLATION LEVEL SERIALIZABLE' : 'BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY');
    const tableNames = [...rowsByTable.keys()];
    const schema = await getTargetSchema(client, tableNames);
    validateColumns(rowsByTable, schema);
    const seedCollisions = await checkTarget(client, rowsByTable, schema);
    const edges = await getForeignKeyEdges(client, tableNames);
    const order = topologicalOrder(tableNames, edges);
    if (args.apply) {
      let imported = 0;
      for (const table of order) {
        imported += await importTable(client, table, rowsByTable.get(table), schema);
        await fixSequences(client, table, schema);
      }
      await client.query('COMMIT');
      console.log(`Restore committed: ${imported} row(s) across ${tableNames.length} table(s).`);
    } else {
      await client.query('ROLLBACK');
      console.log(`Dry run passed: ${tableNames.length} table(s), ${manifest.summary.rows_exported} row(s); target tables are empty or contain only matching migration seed rows.`);
      console.log('No database writes were made. Add --apply only after reviewing the destination and backup manifest.');
    }
    if (seedCollisions.size) console.log(`Matching seed rows to upsert: ${[...seedCollisions.entries()].map(([table, count]) => `${table}=${count}`).join(', ')}`);
    console.log(`Foreign-key import order: ${order.join(' -> ')}`);
    console.log(`Storage files were SHA-256 checked; upload them with the Storage procedure in docs/handover/DATA_RESTORE.md.`);
    console.log('Auth credentials are not restored. Recreate accounts and issue fresh sessions in the target environment.');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw new Error(`Restore ${args.apply ? 'rolled back' : 'dry run failed'}: ${scrub(error.message)}`);
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error(scrub(error.message));
  process.exitCode = 1;
});
