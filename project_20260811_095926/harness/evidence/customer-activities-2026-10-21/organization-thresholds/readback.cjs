const { createRequire } = require('node:module');
const { resolve } = require('node:path');
const { writeFileSync } = require('node:fs');
const app = resolve(__dirname, '../../../../projects');
const fromApp = createRequire(resolve(app, 'package.json'));
fromApp('dotenv').config({ path: resolve(app, '.env.local'), quiet: true });
fromApp('tsx/cjs');
const { createServerClient } = fromApp(resolve(app, 'src/storage/database/supabase-client.ts'));
const { activityDecisionConfigSchema } = fromApp(resolve(app, 'src/lib/game/customer-activities.ts'));

(async () => {
  const { data, error } = await createServerClient().from('designer_prompt_configs')
    .select('config,revision,updated_at').eq('id', 'customer-activities').maybeSingle();
  if (error) {
    console.error(JSON.stringify({ readFailed: true, code: error.code || null, message: String(error.message || '').slice(0, 220) }));
    process.exitCode = 1;
    return;
  }
  if (!data) throw new Error('CONFIG_ROW_NOT_FOUND');
  const config = activityDecisionConfigSchema.parse({ ...data.config, revision: data.revision });
  const record = { checkedAt: new Date().toISOString(), persisted: true, updatedAt: data.updated_at, config };
  writeFileSync(resolve(__dirname, process.argv.includes('--before') ? 'config-before.json' : 'config-readback.json'), JSON.stringify(record, null, 2));
  console.log(JSON.stringify({ persisted: true, mode: config.mode, revision: config.revision, types: Object.keys(config.thresholds) }));
})().catch((error) => { console.error(JSON.stringify({ readFailed: true, error: error.message })); process.exitCode = 1; });
