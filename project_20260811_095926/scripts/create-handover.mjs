#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import { tmpdir } from 'node:os';

const repoRoot = realpathSync(path.resolve(import.meta.dirname, '..'));
const defaultOut = 'D:/WeiXun/outputs/WeiXun-handover-20261030';
const defaultData = 'D:/WeiXun/outputs/WeiXun-supabase-export-20261030';
const externalSources = [
  { source: 'D:/WeiXun/竞标游戏项目相关/整理', destination: 'business-materials/竞标游戏项目相关/整理' },
  { source: 'D:/WeiXun/Weixun Web', destination: 'business-materials/Weixun Web' },
];
const textExtensions = new Set([
  '.bat', '.cjs', '.css', '.csv', '.html', '.ini', '.java', '.js', '.json', '.json5', '.jsonl',
  '.jsx', '.md', '.mjs', '.mts', '.patch', '.ps1', '.py', '.rst', '.sh', '.sql', '.svg', '.toml',
  '.ts', '.tsx', '.txt', '.xml', '.yaml', '.yml', '.zsh',
]);
const omittedDirectory = /^(?:\.git|\.next|\.turbo|\.cache|\.claude|\.codex(?:[-_.].*)?|node_modules|outputs?|coverage|dist|build|out|target|tmp|temp|\.tmp|\.temp)$/i;
const omittedFile = /^(?:\.env(?:\..*)?|[^/\\]*(?:private[-_]?key|credentials?|secrets?)(?:\..*)?|id_rsa(?:\..*)?|.*\.(?:log|tmp|temp|tsbuildinfo))$/i;
const redactionToken = '[REDACTED]';
function parseArgs(argv) {
  const args = { out: defaultOut, data: defaultData };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out' || argv[i] === '--data') {
      const key = argv[i].slice(2);
      const value = argv[++i];
      if (!value) throw new Error(`Missing value after --${key}`);
      args[key] = path.resolve(value);
    } else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log('Usage: node scripts/create-handover.mjs [--out PACKAGE_DIR] [--data SUPABASE_EXPORT_DIR] [--test-secret-redaction]');
      process.exit(0);
    } else if (argv[i] === '--test-secret-redaction') {
      args.selfTest = true;
    } else {
      throw new Error(`Unknown option: ${argv[i]}`);
    }
  }
  return args;
}

function runGit(...args) {
  const result = spawnSync('git', ['-c', `safe.directory=${repoRoot}`, '-C', repoRoot, ...args], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true,
  });
  if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr.trim()}`);
  return result.stdout;
}

function envSecrets() {
  const envPath = path.join(repoRoot, 'projects', '.env.local');
  if (!existsSync(envPath)) throw new Error('projects/.env.local is required for a secret scan; file contents are never copied.');
  const found = [];
  const text = readFileSync(envPath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    const [, name] = match;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, '');
    if (value.length >= 8 && /(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(name)) {
      found.push({ name, bytes: Buffer.from(value, 'utf8') });
    }
  }
  return found.sort((a, b) => b.bytes.length - a.bytes.length);
}

function normalizeEntry(value) {
  return value.replaceAll('\\', '/').replace(/^\.\//, '');
}

function omittedPath(relative) {
  const parts = normalizeEntry(relative).split('/');
  if (parts.some((part) => omittedDirectory.test(part))) return 'runtime/cache/generated directory';
  const base = parts.at(-1) ?? '';
  if (base.startsWith('~$')) return 'temporary Office lock file';
  if (base.toLowerCase() === '.env.example') return null;
  if (omittedFile.test(base)) return 'environment, credential, or transient file';
  return null;
}

function gitFiles(skipped) {
  const output = spawnSync('git', ['-c', `safe.directory=${repoRoot}`, '-C', repoRoot, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    encoding: 'buffer', maxBuffer: 128 * 1024 * 1024, windowsHide: true,
  });
  if (output.status !== 0) throw new Error(`git ls-files failed: ${output.stderr.toString('utf8').trim()}`);
  const files = [];
  for (const entry of output.stdout.toString('utf8').split('\0')) {
    if (!entry) continue;
    const relative = normalizeEntry(entry);
    const reason = omittedPath(relative);
    if (reason) { skipped.push({ path: relative, reason }); continue; }
    const source = path.resolve(repoRoot, entry);
    if (!source.startsWith(`${repoRoot}${path.sep}`) || !existsSync(source) || !statSync(source).isFile()) continue;
    files.push({ source, destination: relative, sourceLabel: 'repository working tree' });
  }
  return files;
}

function externalFiles(skipped) {
  const files = [];
  for (const mapping of externalSources) {
    if (!existsSync(mapping.source)) {
      skipped.push({ path: mapping.source, reason: 'external source directory not present' });
      continue;
    }
    const walk = (folder, relative = '') => {
      for (const entry of readdirSync(folder, { withFileTypes: true })) {
        const rel = relative ? `${relative}/${entry.name}` : entry.name;
        const dest = normalizeEntry(path.posix.join(mapping.destination, rel));
        const reason = omittedPath(dest);
        if (reason) { skipped.push({ path: dest, reason }); continue; }
        const absolute = path.join(folder, entry.name);
        if (entry.isSymbolicLink()) { skipped.push({ path: dest, reason: 'symbolic link not followed' }); continue; }
        if (entry.isDirectory()) walk(absolute, rel);
        else if (entry.isFile()) files.push({ source: absolute, destination: dest, sourceLabel: mapping.source });
      }
    };
    walk(mapping.source);
  }
  return files;
}

function metadata() {
  const branch = runGit('branch', '--show-current').trim();
  const commit = runGit('rev-parse', 'HEAD').trim();
  const remotes = runGit('remote', '-v').trim().split(/\r?\n/).filter(Boolean).map((line) => {
    const match = line.match(/^\S+\s+(.+?)\s+\((?:fetch|push)\)$/);
    if (!match) return undefined;
    let url = match[1];
    try {
      const parsed = new URL(url);
      url = `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
    } catch {
      url = url.replace(/^[^@]+@/, '');
    }
    return url;
  }).filter(Boolean);
  return {
    generatedAt: new Date().toISOString(),
    repository: { branch, headCommit: commit, remotes: [...new Set(remotes)] },
    gitHistoryIncluded: false,
    note: 'Snapshot of the current working tree; the archive intentionally does not contain .git or earlier commit history.',
  };
}

async function writeChunk(stream, chunk) {
  if (!stream.write(chunk)) await once(stream, 'drain');
}

function findSecret(buffer, secrets, from = 0) {
  let earliest = null;
  for (const secret of secrets) {
    const index = buffer.indexOf(secret.bytes, from);
    if (index < 0) continue;
    if (!earliest || index < earliest.index) earliest = { index, secret };
  }
  return earliest;
}

async function copyTextRedacted(source, destination, secrets, relative, redactions) {
  const input = createReadStream(source);
  const output = createWriteStream(destination, { flags: 'wx' });
  const hash = createHash('sha256');
  const counts = new Map();
  const maxSecretLength = Math.max(1, ...secrets.map((secret) => secret.bytes.length));
  let carry = Buffer.alloc(0);
  let size = 0;
  const emit = async (buffer) => {
    if (!buffer.length) return;
    hash.update(buffer);
    size += buffer.length;
    await writeChunk(output, buffer);
  };
  const processBuffer = async (buffer, final) => {
    let safeLimit = final ? buffer.length : Math.max(0, buffer.length - maxSecretLength + 1);
    let index = 0;
    let untouchedStart = 0;
    while (index < safeLimit) {
      const found = findSecret(buffer, secrets, index);
      if (!found || found.index >= safeLimit) break;
      const { index: matchIndex, secret } = found;
      if (matchIndex + secret.bytes.length > safeLimit) {
        safeLimit = matchIndex;
        break;
      }
      await emit(buffer.subarray(untouchedStart, matchIndex));
      const replacement = Buffer.from(redactionToken, 'utf8');
      await emit(replacement);
      counts.set(secret.name, (counts.get(secret.name) ?? 0) + 1);
      index = matchIndex + secret.bytes.length;
      untouchedStart = index;
    }
    await emit(buffer.subarray(untouchedStart, safeLimit));
    return buffer.subarray(safeLimit);
  };
  try {
    for await (const chunk of input) {
      carry = await processBuffer(Buffer.concat([carry, chunk]), false);
    }
    await processBuffer(carry, true);
    output.end();
    await once(output, 'finish');
  } catch (error) {
    input.destroy();
    output.destroy();
    if (existsSync(destination)) unlinkSync(destination);
    throw error;
  }
  if (counts.size) {
    redactions.push({ path: relative, variables: [...counts].map(([variable, occurrences]) => ({ variable, occurrences })) });
  }
  return { size, sha256: hash.digest('hex') };
}

async function scanBinary(source, secrets, relative) {
  const maxSecretLength = Math.max(1, ...secrets.map((secret) => secret.bytes.length));
  let carry = Buffer.alloc(0);
  for await (const chunk of createReadStream(source)) {
    const buffer = Buffer.concat([carry, chunk]);
    const match = findSecret(buffer, secrets);
    if (match) throw new Error(`A configured credential (${match.secret.name}) appears in binary file ${relative}; the archive was stopped to avoid leaking it.`);
    carry = buffer.subarray(Math.max(0, buffer.length - maxSecretLength + 1));
  }
}

async function copyFileRecord(file, outRoot, secrets, redactions) {
  const relative = normalizeEntry(file.destination);
  const destination = path.join(outRoot, ...relative.split('/'));
  mkdirSync(path.dirname(destination), { recursive: true });
  const isText = textExtensions.has(path.extname(file.source).toLowerCase()) || path.basename(file.source).toLowerCase() === '.gitignore';
  let integrity;
  if (isText) {
    integrity = await copyTextRedacted(file.source, destination, secrets, relative, redactions);
  } else {
    await scanBinary(file.source, secrets, relative);
    const hash = createHash('sha256');
    let size = 0;
    for await (const chunk of createReadStream(file.source)) { hash.update(chunk); size += chunk.length; }
    await import('node:fs/promises').then(({ copyFile }) => copyFile(file.source, destination));
    integrity = { size, sha256: hash.digest('hex') };
  }
  return { path: relative, source: file.sourceLabel, size: integrity.size, sha256: integrity.sha256 };
}

function packageReadme() {
  return `# WeiXun 工作交接包\n\n生成时间：${new Date().toISOString()}\n\n## 内容\n\n- \`project_20260811_095926/\`：Git 工作区快照，包含应用源码、页面和 API、迁移、seed、验证脚本、治理记录及详细中文操作文档；不含 Git 历史、依赖目录、构建缓存和本机运行日志。\n- \`business-materials/\`：外部整理目录和 Weixun Web 页面/素材源文件。\n- \`data/\`：由独立只读 Supabase 导出脚本生成的业务表 JSON 与 Storage 对象。\n- \`CONFIGURATION.example.env\`：本机当前的非敏感运行配置；KEY、TOKEN、SECRET、PASSWORD 和 CREDENTIAL 字段均为空。\n- \`git-metadata.json\`：生成此交接包时的分支、HEAD 与清理过的远程地址。\n- \`MANIFEST.json\`：每个交付文件大小、SHA-256、来源、排除项及文本密钥清理记录。清单包含自身大小但无法在自包含清单中列出自身 SHA-256；完整包校验见旁边的 ZIP SHA256 文件。\n\n## 解压后接手\n\n1. 安装 Node.js 22 或更新版本、Corepack 和 pnpm 9。\n2. 进入 \`project_20260811_095926/\`，复制根目录 \`CONFIGURATION.example.env\` 到 \`projects/.env.local\`，然后由组织管理员单独发放并填写空白 key/secret。该模板保留了当前非敏感模型服务 endpoint、模型名和端口；\`projects/.env.example\` 是基础变量说明。不要从旧机器复制真实 key。\n3. 在 \`projects/\` 运行 \`corepack pnpm install --frozen-lockfile\`，再根据配套中文手册配置数据库并运行 \`corepack pnpm build\`。\n4. 启动前阅读 \`project_20260811_095926/docs/handover/\`。还原业务数据到新数据库前先创建空数据库、应用全部迁移、备份目标库；遵循 \`docs/handover/DATA_RESTORE.md\`，并单独核对表映射、存储 bucket 与新环境 URL。\n5. 管理员账号、邀请与登录身份需由目标环境的管理员重新设置。交付包不携带 API key、登录 token、旧机器环境变量或 Git 历史。\n\n## 完整性与数据时间\n\n- 解压前请用 Windows PowerShell 执行 \`Get-FileHash .\\<交接包文件名>.zip -Algorithm SHA256\`，结果应匹配相邻的 \`.sha256\` 文件。ZIP 使用系统 tar 的 Deflate 压缩及 UTF-8 文件名支持；超大 ZIP 使用 ZIP64。\n- 数据导出是按表和对象逐项读取的逻辑快照，不是数据库事务时间点的原子快照。导出窗口内发生写入时，各表可能对应略有差异的时间。每项结果、计数、失败和导出时间见 \`data/manifest.json\`。\n- 除被安全检查拒绝打包的二进制凭据（如有）以外，清单列出所有实际交付文件；配置文件等文本里命中本机已配置长凭据时替换为 \`[REDACTED]\`，清理详情只记变量名和次数，不记原值。\n`;
}

function createConfigurationTemplate(redactions) {
  const source = path.join(repoRoot, 'projects', '.env.local');
  const lines = readFileSync(source, 'utf8').split(/\r?\n/);
  const sensitive = /(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i;
  const blanked = new Set();
  const result = lines.map((line) => {
    const match = line.match(/^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)(\s*=)(.*)$/);
    if (!match || !sensitive.test(match[2])) return line;
    blanked.add(match[2]);
    return `${match[1]}${match[2]}${match[3]} # fill in securely for the receiving environment`;
  });
  result.unshift('# Non-sensitive local runtime settings copied from the source environment. All credentials are intentionally blank.');
  redactions.push({
    path: 'CONFIGURATION.example.env',
    source: 'projects/.env.local with sensitive values blanked',
    variables: [...blanked].sort().map((variable) => ({ variable, occurrences: 1 })),
  });
  return `${result.join('\n').trimEnd()}\n`;
}

async function hashFile(filename) {
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of createReadStream(filename)) { hash.update(chunk); size += chunk.length; }
  return { size, sha256: hash.digest('hex') };
}

async function listPackageFiles(folder) {
  const result = [];
  const walk = async (current, prefix = '') => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Refusing a symlink inside package: ${relative}`);
      if (entry.isDirectory()) await walk(absolute, relative);
      else if (entry.isFile()) result.push({ path: normalizeEntry(relative), absolute });
    }
  };
  await walk(folder);
  return result.sort((a, b) => a.path.localeCompare(b.path, 'en'));
}

function createZip(packageDir, zipPath) {
  return new Promise((resolve, reject) => {
    // Windows' built-in bsdtar streams file data, sets UTF-8 ZIP name flags, and
    // writes ZIP64 records when required. Paths are supplied as argv values.
    const child = spawn('tar.exe', ['--options', 'zip:hdrcharset=UTF-8', '-a', '-c', '-f', zipPath, '-C', packageDir, '.'], {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', (error) => {
      if (existsSync(zipPath)) unlinkSync(zipPath);
      reject(new Error(`Could not start Windows tar.exe: ${error.message}`));
    });
    child.once('close', (code, signal) => {
      if (code === 0) { resolve(); return; }
      if (existsSync(zipPath)) unlinkSync(zipPath);
      reject(new Error(`tar.exe failed (${signal ?? code}): ${stderr.trim()}`));
    });
  });
}

function selfEntrySize(manifest, initial = 0) {
  let size = initial;
  for (let i = 0; i < 12; i++) {
    manifest.files.find((file) => file.path === 'MANIFEST.json').size = size;
    const encoded = `${JSON.stringify(manifest, null, 2)}\n`;
    const byteLength = Buffer.byteLength(encoded, 'utf8');
    if (byteLength === size) return { size, encoded };
    size = byteLength;
  }
  throw new Error('Could not stabilize MANIFEST.json byte size.');
}

async function testSecretRedactionBoundary() {
  const secret = Buffer.from('handover-cross-chunk-fixture-secret');
  const source = path.join(tmpdir(), `codex-handover-redaction-${process.pid}-${Date.now()}.txt`);
  const destination = `${source}.out`;
  const redactions = [];
  const padding = 'x'.repeat(64 * 1024 - 5);
  try {
    writeFileSync(source, Buffer.concat([Buffer.from(padding), secret, Buffer.from('\n')]), { flag: 'wx' });
    await copyTextRedacted(source, destination, [{ name: 'AI_API_KEY', bytes: secret }], 'fixture.txt', redactions);
    const output = readFileSync(destination);
    if (output.includes(secret) || !output.includes(Buffer.from(redactionToken))) throw new Error('Secret crossing the stream boundary was not completely redacted.');
    if (redactions.length !== 1 || redactions[0].variables[0].occurrences !== 1) throw new Error('Cross-boundary redaction count was incorrect.');
    const manifest = { files: [{ path: '客户活动.json', size: 7 }, { path: 'MANIFEST.json', size: 0 }] };
    const serializedManifest = selfEntrySize(manifest);
    if (Buffer.byteLength(serializedManifest.encoded, 'utf8') !== serializedManifest.size) throw new Error('Manifest UTF-8 byte length did not stabilize.');
    console.log('Cross-chunk credential redaction and Unicode manifest sizing fixtures passed.');
  } finally {
    if (existsSync(source)) unlinkSync(source);
    if (existsSync(destination)) unlinkSync(destination);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) { await testSecretRedactionBoundary(); return; }
  const { out, data } = args;
  const packagePath = path.resolve(out);
  const zipPath = `${packagePath}.zip`;
  const dataPath = path.resolve(data);
  const resolvedRoot = realpathSync(repoRoot);
  if (packagePath === resolvedRoot || packagePath.startsWith(`${resolvedRoot}${path.sep}`) || resolvedRoot.startsWith(`${packagePath}${path.sep}`)) {
    throw new Error('Package destination must be outside the source Git worktree.');
  }
  if (!existsSync(dataPath) || !statSync(dataPath).isDirectory()) throw new Error(`Supabase data export directory not found: ${dataPath}`);
  const resolvedData = realpathSync(dataPath);
  if (resolvedData === resolvedRoot || resolvedData.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error('Supabase export must live outside the Git worktree.');
  if (existsSync(packagePath) && readdirSync(packagePath).length > 0) throw new Error(`Package destination already contains files: ${packagePath}. Choose a new --out directory; existing data will not be deleted.`);
  if (existsSync(zipPath)) throw new Error(`ZIP already exists: ${zipPath}. Choose a new --out path; existing data will not be deleted.`);
  mkdirSync(packagePath, { recursive: true });

  const secrets = envSecrets();
  const redactions = [];
  const skipped = [];
  skipped.push({ path: 'projects/.env.local', reason: 'read only to discover configured credentials for redaction; never copied' });
  skipped.push({ path: '**/.env and **/.env.*', reason: 'environment files omitted except the committed .env.example templates' });
  skipped.push({ path: '**/.git, **/node_modules, **/.next, **/outputs, **/dist, logs and caches', reason: 'version-control history, dependencies, generated output, runtime logs, and caches omitted by package policy' });
  const sourceFiles = gitFiles(skipped);
  sourceFiles.push(...externalFiles(skipped));

  const packagePrefix = 'project_20260811_095926';
  const files = sourceFiles.map((file) => ({ ...file, destination: `${packagePrefix}/${file.destination}` }));
  files.push({ source: resolvedData, destination: 'data', sourceLabel: 'read-only Supabase table and Storage export', directory: true });
  const expanded = [];
  for (const file of files) {
    if (!file.directory) { expanded.push(file); continue; }
    const walk = (folder, relative = '') => {
      for (const entry of readdirSync(folder, { withFileTypes: true })) {
        const rel = relative ? `${relative}/${entry.name}` : entry.name;
        const source = path.join(folder, entry.name);
        if (entry.isSymbolicLink()) { skipped.push({ path: `data/${rel}`, reason: 'symbolic link not followed' }); continue; }
        if (entry.isDirectory()) walk(source, rel);
        else if (entry.isFile()) expanded.push({ source, destination: `data/${normalizeEntry(rel)}`, sourceLabel: 'read-only Supabase table and Storage export' });
      }
    };
    walk(file.source);
  }

  const records = [];
  for (const file of expanded) records.push(await copyFileRecord(file, packagePath, secrets, redactions));
  const configurationPath = path.join(packagePath, 'CONFIGURATION.example.env');
  writeFileSync(configurationPath, createConfigurationTemplate(redactions), { flag: 'wx', encoding: 'utf8' });
  records.push({ path: 'CONFIGURATION.example.env', source: 'current non-sensitive environment settings; credential values blanked', ...(await hashFile(configurationPath)) });
  const readmePath = path.join(packagePath, 'README.md');
  writeFileSync(readmePath, packageReadme(), { flag: 'wx', encoding: 'utf8' });
  const readmeHash = await hashFile(readmePath);
  records.push({ path: 'README.md', source: 'generated handover instructions', ...readmeHash });
  const gitMetadata = metadata();
  const metadataPath = path.join(packagePath, 'git-metadata.json');
  writeFileSync(metadataPath, `${JSON.stringify(gitMetadata, null, 2)}\n`, { flag: 'wx', encoding: 'utf8' });
  records.push({ path: 'git-metadata.json', source: 'generated sanitized Git metadata', ...(await hashFile(metadataPath)) });

  const manifest = {
    format: 1,
    generatedAt: new Date().toISOString(),
    roots: { gitRepository: repoRoot, databaseExport: resolvedData },
    security: {
      configuredCredentialValuesScanned: secrets.length,
      redactions,
      binaryCredentialFindings: 0,
      note: 'Configured long key/token/secret/password/credential values were not printed or exported. Text matches are replaced with [REDACTED]. Any match inside binary files aborts package creation.',
    },
    excluded: skipped,
    files: [...records, { path: 'MANIFEST.json', source: 'generated inventory', size: 0, sha256: null }].sort((a, b) => a.path.localeCompare(b.path, 'en')),
    manifestIntegrity: 'This manifest includes its final byte length, but omits its own SHA-256 because a self hash is recursive; the adjacent ZIP SHA256 file covers the complete archive.',
  };
  const self = selfEntrySize(manifest);
  writeFileSync(path.join(packagePath, 'MANIFEST.json'), self.encoded, { flag: 'wx', encoding: 'utf8' });

  const packageFiles = await listPackageFiles(packagePath);
  if (packageFiles.length !== manifest.files.length) throw new Error('Package manifest and staged file list do not match.');
  await createZip(packagePath, zipPath);
  const zipHash = await hashFile(zipPath);
  const checksumPath = `${zipPath}.sha256`;
  writeFileSync(checksumPath, `${zipHash.sha256}  ${path.basename(zipPath)}\n`, { flag: 'wx', encoding: 'utf8' });

  console.log(`Package folder: ${packagePath}`);
  console.log(`ZIP archive: ${zipPath}`);
  console.log(`SHA-256: ${checksumPath}`);
  console.log(`Files: ${packageFiles.length}; configured credential values scrubbed: ${redactions.reduce((sum, entry) => sum + entry.variables.reduce((n, value) => n + value.occurrences, 0), 0)}; skipped paths: ${skipped.length}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Handover packaging failed.');
  process.exitCode = 1;
});
