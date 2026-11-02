import assert from 'node:assert/strict';
import {
  getAiProviderAvailability,
  parseAiProviderSelection,
  selectedAiProvider,
} from '../src/lib/ai/provider-selection';

const originalEnvironment = {
  AI_BASE_URL: process.env.AI_BASE_URL,
  AI_API_KEY: process.env.AI_API_KEY,
  AI_MODEL: process.env.AI_MODEL,
  DEEPSEEK_AI_BASE_URL: process.env.DEEPSEEK_AI_BASE_URL,
  DEEPSEEK_AI_API_KEY: process.env.DEEPSEEK_AI_API_KEY,
  DEEPSEEK_AI_MODEL: process.env.DEEPSEEK_AI_MODEL,
  DOUBAO_AI_BASE_URL: process.env.DOUBAO_AI_BASE_URL,
  DOUBAO_AI_API_KEY: process.env.DOUBAO_AI_API_KEY,
  DOUBAO_AI_MODEL: process.env.DOUBAO_AI_MODEL,
  QWEN_AI_BASE_URL: process.env.QWEN_AI_BASE_URL,
  QWEN_AI_API_KEY: process.env.QWEN_AI_API_KEY,
  QWEN_AI_MODEL: process.env.QWEN_AI_MODEL,
};

try {
  assert.deepEqual(parseAiProviderSelection({ provider: 'default' }), { provider: 'default' });
  assert.deepEqual(parseAiProviderSelection({ provider: 'qwen' }), { provider: 'qwen' });
  assert.equal(selectedAiProvider({ provider: 'doubao' }), 'doubao');
  assert.equal(parseAiProviderSelection({ provider: 'unknown' }), null);
  assert.equal(parseAiProviderSelection({ provider: 'deepseek', extra: true }), null);
  assert.equal(parseAiProviderSelection({}), null);

  Object.assign(process.env, {
    AI_BASE_URL: 'https://default.example.test/v1',
    AI_API_KEY: 'default-secret',
    AI_MODEL: 'default-model',
    DEEPSEEK_AI_BASE_URL: 'https://deepseek.example.test/v1',
    DEEPSEEK_AI_API_KEY: 'deepseek-secret',
    DEEPSEEK_AI_MODEL: 'deepseek-model',
    DOUBAO_AI_BASE_URL: 'https://doubao.example.test/v1',
    DOUBAO_AI_API_KEY: 'doubao-secret',
    DOUBAO_AI_MODEL: 'doubao-model',
    QWEN_AI_BASE_URL: 'https://qwen.example.test/v1',
    QWEN_AI_API_KEY: 'qwen-secret',
    QWEN_AI_MODEL: 'qwen-model',
  });
  assert.deepEqual(getAiProviderAvailability(), {
    default: { configured: true, model: 'default-model' },
    deepseek: { configured: true, model: 'deepseek-model' },
    doubao: { configured: true, model: 'doubao-model' },
    qwen: { configured: true, model: 'qwen-model' },
  });

  delete process.env.QWEN_AI_API_KEY;
  const unavailable = getAiProviderAvailability();
  assert.deepEqual(unavailable.qwen, { configured: false, model: 'qwen-model' });
  assert.equal(JSON.stringify(unavailable).includes('qwen-secret'), false, 'availability must never expose API keys');
  process.env.QWEN_AI_API_KEY = 'qwen-secret';
  process.env.QWEN_AI_BASE_URL = 'https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1';
  assert.equal(getAiProviderAvailability().qwen.configured, false, 'Example placeholder URL is not configured');
  console.log('AI provider selection validation tests passed');
} finally {
  for (const [name, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}
