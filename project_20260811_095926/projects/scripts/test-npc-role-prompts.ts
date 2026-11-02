import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  composeNpcRolePrompt,
  DEFAULT_NPC_SUPPORT_TIER_THRESHOLDS,
  DEFAULT_PROJECT_ONE_PROMPT_CONFIG,
  normalizeNpcRolePrompt,
  normalizeProjectOnePromptConfig,
  supportPromptTier,
} from '../src/lib/designer/prompt-config';
import { CUSTOMER_PROMPT } from '../src/lib/ai/prompts/customer';
import { NPC_NATURAL_DIALOGUE_RULES } from '../src/lib/ai/prompts/npc-dialogue-rules';
import {
  PROJECT_ONE_NPC_ROLE_PROMPT_PROFILES,
  PROJECT_ONE_NPC_ROLE_PROMPTS,
} from '../src/lib/designer/npc-role-prompts';
import {
  PROJECT_ONE_CHANNEL_MODIFIERS,
  PROJECT_ONE_FIVE_PERSON_IDS,
  PROJECT_ONE_FIVE_PERSON_NPCS,
  PROJECT_ONE_NPC_CHANNEL_EXCEPTIONS,
} from '../src/lib/designer/project-one-five-person';

const perspectiveMigration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260929000100_npc_speaker_perspective.sql'),
  'utf8',
);
const september30ProfileSnapshot = JSON.parse(readFileSync(
  resolve(process.cwd(), 'scripts/fixtures/npc-role-prompts-2026-09-30.json'),
  'utf8',
)) as typeof PROJECT_ONE_NPC_ROLE_PROMPT_PROFILES;
const october8PreRefreshProfileSnapshot = JSON.parse(readFileSync(
  resolve(process.cwd(), 'scripts/fixtures/npc-role-prompts-2026-10-08-before-tone-refresh.json'),
  'utf8',
)) as typeof PROJECT_ONE_NPC_ROLE_PROMPT_PROFILES;
const october8BeforeTierScenariosProfileSnapshot = JSON.parse(readFileSync(
  resolve(process.cwd(), 'scripts/fixtures/npc-role-prompts-2026-10-08-before-tier-scenarios.json'),
  'utf8',
)) as typeof PROJECT_ONE_NPC_ROLE_PROMPT_PROFILES;
const october12BeforeShortRepliesProfileSnapshot = JSON.parse(readFileSync(
  resolve(process.cwd(), 'scripts/fixtures/npc-role-prompts-2026-10-12-before-short-replies.json'),
  'utf8',
)) as typeof PROJECT_ONE_NPC_ROLE_PROMPT_PROFILES;
const october14BeforeNaturalDialogueProfileSnapshot = JSON.parse(readFileSync(
  resolve(process.cwd(), 'scripts/fixtures/npc-role-prompts-2026-10-14-before-natural-dialogue.json'),
  'utf8',
)) as typeof PROJECT_ONE_NPC_ROLE_PROMPT_PROFILES;
const october14BeforeQualityFixProfileSnapshot = JSON.parse(readFileSync(
  resolve(process.cwd(), 'scripts/fixtures/npc-role-prompts-2026-10-14-before-quality-fix.json'),
  'utf8',
)) as typeof PROJECT_ONE_NPC_ROLE_PROMPT_PROFILES;
const october14BeforeNaturalDialogueCustomerSnapshot = JSON.parse(readFileSync(
  resolve(process.cwd(), 'scripts/fixtures/customer-prompt-2026-10-14-before-natural-dialogue.json'),
  'utf8',
)) as string;
const october14BeforeQualityFixCustomerSnapshot = JSON.parse(readFileSync(
  resolve(process.cwd(), 'scripts/fixtures/customer-prompt-2026-10-14-before-quality-fix.json'),
  'utf8',
)) as string;
const customerPromptFromCommit81a975fb6 = JSON.parse(readFileSync(
  resolve(process.cwd(), 'scripts/fixtures/customer-prompt-legacy-81a975fb6.json'),
  'utf8',
)) as string;
const october14BeforeNaturalDialogueChannelSnapshot = JSON.parse(readFileSync(
  resolve(process.cwd(), 'scripts/fixtures/npc-channels-2026-10-14-before-natural-dialogue.json'),
  'utf8',
)) as {
  channelModifiers: Record<string, { modifier: string }>;
  npcChannelExceptions: Record<string, Record<string, string>>;
};
const historicalProfileSnapshots: readonly [string, typeof PROJECT_ONE_NPC_ROLE_PROMPT_PROFILES][] = [
  ['September 30', september30ProfileSnapshot],
  ['October 8 pre-refresh', october8PreRefreshProfileSnapshot],
  ['October 8 before tier scenarios', october8BeforeTierScenariosProfileSnapshot],
  ['October 12 before short replies', october12BeforeShortRepliesProfileSnapshot],
  ['October 14 before natural dialogue', october14BeforeNaturalDialogueProfileSnapshot],
  ['October 14 before quality fix (v5)', october14BeforeQualityFixProfileSnapshot],
];

const NPC_CATCHPHRASE_PATTERNS: Record<(typeof PROJECT_ONE_FIVE_PERSON_IDS)[number], RegExp> = {
  'P1-001': /确实，确实|这事我琢磨琢磨|要不这样，您看/,
  'P1-002': /嗯，是这么个意思|怎么说呢|您看啊/,
  'P1-003': /您说是不是|这个嘛|话说回来/,
  'P1-004': /嗯嗯，是这样|怎么讲呢|您看哈/,
  'P1-005': /哎，是呢|您看这样好不好|那咱们这样/,
};

const COMMON_SALES_SCENARIO_SECTION_PATTERN = /(?:^|\n)常见销售场景（[^）]+）：\n([\s\S]*?)(?=\n- 本轮节奏：|\s*$)/;

function commonSalesScenarioReplies(prompt: string, npcName: string, tier: string): Map<string, string> {
  const section = prompt.match(COMMON_SALES_SCENARIO_SECTION_PATTERN)?.[1];
  assert.ok(section, `${npcName} ${tier} has a delimited common sales scenarios section`);
  const replies = new Map<string, string>();
  for (const line of section.split(/\r?\n/)) {
    const match = line.match(/^- (.+?)[，；]可说：“([^”]+)”$/);
    if (match) {
      assert.ok(!replies.has(match[1]), `${npcName} ${tier} does not duplicate scenario label ${match[1]}`);
      replies.set(match[1], match[2]);
    }
  }
  return replies;
}

for (const [index, npcId] of PROJECT_ONE_FIVE_PERSON_IDS.entries()) {
  const npc = PROJECT_ONE_FIVE_PERSON_NPCS[npcId];
  const baseline = PROJECT_ONE_NPC_ROLE_PROMPTS[npcId];
  const profile = PROJECT_ONE_NPC_ROLE_PROMPT_PROFILES[npcId];

  assert.equal(baseline, profile.base, `${npc.name} baseline export stays aligned with the profile`);
  assert.ok(baseline.length <= 12_000, `${npc.name} character context stays within the editable prompt limit`);
  assert.match(baseline, new RegExp(`你是客户 NPC ${npc.name}`));
  assert.match(baseline, new RegExp(npc.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(baseline, /人物背景：/);
  assert.match(baseline, /职责：/);
  assert.match(baseline, /固定边界：/);
  assert.match(baseline, /口头语：/);
  assert.match(baseline, NPC_CATCHPHRASE_PATTERNS[npcId], `${npc.name} has individual catchphrases`);
  assert.doesNotMatch(baseline, /支持度|参考话术|当前支持度/);
  assert.doesNotMatch(baseline, /NPC自然对话共用规则/);

  for (const tier of ['low', 'medium', 'high'] as const) {
    assert.ok(profile[tier].length <= 12_000, `${npc.name} ${tier} stays within the editable prompt limit`);
    assert.doesNotMatch(profile[tier], /\[object Object\]|undefined/, `${npc.name} ${tier} has no unresolved scenario interpolation`);
    assert.doesNotMatch(profile[tier], /两次追问后结束|身份不明必须结束/, `${npc.name} ${tier} keeps identity clarification flexible by role`);
    assert.doesNotMatch(profile[tier], /即时愉悦度|支持度以系统|中等支持度表示/);
    assert.doesNotMatch(profile[tier], /NPC自然对话共用规则/);
  }
  assert.doesNotMatch(profile.medium, /比低档更长|多说几句|增加回复长度/);
  assert.doesNotMatch(profile.high, /比中档更长|比低档更长|多说几句|增加回复长度/);
  assert.notEqual(profile.low, profile.medium, `${npc.name} low and medium tiers differ`);
  assert.notEqual(profile.medium, profile.high, `${npc.name} medium and high tiers differ`);

  const commonReplies = {
    low: commonSalesScenarioReplies(profile.low, npc.name, 'low'),
    medium: commonSalesScenarioReplies(profile.medium, npc.name, 'medium'),
    high: commonSalesScenarioReplies(profile.high, npc.name, 'high'),
  };
  for (const tier of ['low', 'medium', 'high'] as const) {
    assert.equal(commonReplies[tier].size, 6, `${npc.name} ${tier} has six concise shared scenario examples`);
    for (const reply of commonReplies[tier].values()) {
      assert.doesNotMatch(reply, /你抓紧|行了|少废话|怎么判断|闭嘴|赶紧|别来|爱咋/, `${npc.name} ${tier} example avoids rude or commanding language: ${reply}`);
      if (tier === 'low') {
        assert.ok(reply.length <= 35, `${npc.name} low-tier example stays within 35 characters: ${reply} (${reply.length})`);
      }
    }
  }
  assert.deepEqual(
    [...commonReplies.low.keys()].sort(),
    [...commonReplies.medium.keys()].sort(),
    `${npc.name} low and medium cover the same scenario labels`,
  );
  assert.deepEqual(
    [...commonReplies.medium.keys()].sort(),
    [...commonReplies.high.keys()].sort(),
    `${npc.name} medium and high cover the same scenario labels`,
  );
  for (const label of commonReplies.low.keys()) {
    assert.notEqual(commonReplies.low.get(label), commonReplies.medium.get(label), `${npc.name} low/medium wording differs for ${label}`);
    assert.notEqual(commonReplies.medium.get(label), commonReplies.high.get(label), `${npc.name} medium/high wording differs for ${label}`);
    assert.notEqual(commonReplies.low.get(label), commonReplies.high.get(label), `${npc.name} low/high wording differs for ${label}`);
  }

  const marker = `$perspective_${index + 1}$`;
  const markerStart = perspectiveMigration.indexOf(marker);
  const markerEnd = perspectiveMigration.indexOf(marker, markerStart + marker.length);
  assert.ok(markerStart >= 0 && markerEnd > markerStart, `${npc.name} legacy default exists in the prior migration`);
  const legacyString = perspectiveMigration.slice(markerStart + marker.length, markerEnd);
  const legacyProfile = normalizeNpcRolePrompt(legacyString);

  const savedLegacyString = structuredClone(DEFAULT_PROJECT_ONE_PROMPT_CONFIG);
  savedLegacyString.npcRolePrompts[npcId] = legacyString;
  assert.deepEqual(normalizeProjectOnePromptConfig(savedLegacyString).npcRolePrompts[npcId], profile, `${npc.name} old untouched string upgrades at runtime`);

  const customLegacyString = `${legacyString} `;
  const savedCustomString = structuredClone(DEFAULT_PROJECT_ONE_PROMPT_CONFIG);
  savedCustomString.npcRolePrompts[npcId] = customLegacyString;
  assert.equal(normalizeNpcRolePrompt(normalizeProjectOnePromptConfig(savedCustomString).npcRolePrompts[npcId]).base, customLegacyString, `${npc.name} one-character-scale string change is preserved`);

  const savedLegacyProfile = structuredClone(DEFAULT_PROJECT_ONE_PROMPT_CONFIG);
  savedLegacyProfile.npcRolePrompts[npcId] = legacyProfile;
  assert.deepEqual(normalizeProjectOnePromptConfig(savedLegacyProfile).npcRolePrompts[npcId], profile, `${npc.name} old untouched profile upgrades at runtime`);

  const customLegacyProfile = { ...legacyProfile, medium: `${legacyProfile.medium}\n设计师自定义中档内容` };
  const savedCustomProfile = structuredClone(DEFAULT_PROJECT_ONE_PROMPT_CONFIG);
  savedCustomProfile.npcRolePrompts[npcId] = customLegacyProfile;
  assert.deepEqual(normalizeProjectOnePromptConfig(savedCustomProfile).npcRolePrompts[npcId], customLegacyProfile, `${npc.name} edited profile is never replaced by a default`);

  for (const [snapshotLabel, snapshot] of historicalProfileSnapshots) {
    const preRefreshProfile = snapshot[npcId];
    const savedPreRefreshProfile = structuredClone(DEFAULT_PROJECT_ONE_PROMPT_CONFIG);
    savedPreRefreshProfile.npcRolePrompts[npcId] = preRefreshProfile;
    assert.deepEqual(
      normalizeProjectOnePromptConfig(savedPreRefreshProfile).npcRolePrompts[npcId],
      profile,
      `${npc.name} exact ${snapshotLabel} profile upgrades at runtime`,
    );

    for (const field of ['base', 'low', 'medium', 'high'] as const) {
      const editedPreRefreshProfile = {
        ...preRefreshProfile,
        [field]: `${preRefreshProfile[field]}x`,
      };
      const savedEditedPreRefreshProfile = structuredClone(DEFAULT_PROJECT_ONE_PROMPT_CONFIG);
      savedEditedPreRefreshProfile.npcRolePrompts[npcId] = editedPreRefreshProfile;
      assert.deepEqual(
        normalizeProjectOnePromptConfig(savedEditedPreRefreshProfile).npcRolePrompts[npcId],
        editedPreRefreshProfile,
        `${npc.name} one-character ${field} edit prevents a ${snapshotLabel} profile upgrade`,
      );

      if (snapshotLabel === 'October 14 before quality fix (v5)') {
        const emptyFieldProfile = { ...preRefreshProfile, [field]: '' };
        const savedEmptyFieldProfile = structuredClone(DEFAULT_PROJECT_ONE_PROMPT_CONFIG);
        savedEmptyFieldProfile.npcRolePrompts[npcId] = emptyFieldProfile;
        assert.deepEqual(
          normalizeProjectOnePromptConfig(savedEmptyFieldProfile).npcRolePrompts[npcId],
          emptyFieldProfile,
          `${npc.name} explicitly empty ${field} stays custom for the v5 profile`,
        );
      }
    }
  }
}

assert.match(PROJECT_ONE_NPC_ROLE_PROMPT_PROFILES['P1-001'].low, /5\s*(?:至|[-–—~～])\s*25字/);
assert.match(PROJECT_ONE_NPC_ROLE_PROMPT_PROFILES['P1-001'].low, /最多35字/);
const zhangBase = PROJECT_ONE_NPC_ROLE_PROMPT_PROFILES['P1-001'].base;
assert.match(zhangBase, /职位权限只界定能做什么，不代表当前愿意转介或推动/);
assert.match(zhangBase, /是否推进以本轮意愿和支持档为准/);
assert.doesNotMatch(zhangBase, /会把执行问题交回专业岗位|一两句判断是否值得转交/);
const zhangLowPrompt = PROJECT_ONE_NPC_ROLE_PROMPT_PROFILES['P1-001'].low;
assert.match(zhangLowPrompt, /对已经讲过来意的长篇推销，只礼貌致谢并收束/);
assert.match(zhangLowPrompt, /称呼销售方始终用“您”/);
assert.match(zhangLowPrompt, /未知时不猜、不虚构具体姓名或职务/);
assert.match(zhangLowPrompt, /示例仅供语气参考，不逐轮照抄/);
assert.doesNotMatch(zhangLowPrompt, /(?:^|[，。；])你(?:们)?/);
const zhangLowReplies = commonSalesScenarioReplies(PROJECT_ONE_NPC_ROLE_PROMPT_PROFILES['P1-001'].low, '张建国', 'low');
assert.doesNotMatch([...zhangLowReplies.values()].join('\n'), /你们?|王工|李工/, 'Zhang low-tier examples address the visitor politely without inventing contacts');
assert.equal(
  zhangLowReplies.get('对方索要未公开信息并要求后续保证'),
  '抱歉，内部信息不便提供，我也不能保证后续联系。',
  'Zhang politely refuses private information and explicitly declines to promise follow-up in the low tier',
);
assert.equal(zhangLowReplies.get('对方送礼或私人请托'), '谢谢心意，礼物不能收。', 'Zhang politely and explicitly refuses a low-tier gift');
assert.doesNotMatch(
  [...zhangLowReplies.values()].join('\n'),
  /(?:^|[，。；])(?:我会|一定会|保证会|我来|我帮您安排|我替您联系|下次一定|承诺跟进)/,
  'Zhang low-tier examples do not promise follow-up or arrangements',
);

const savedV5Customer = structuredClone(DEFAULT_PROJECT_ONE_PROMPT_CONFIG);
savedV5Customer.liveCustomerPrompt = october14BeforeQualityFixCustomerSnapshot;
assert.equal(
  normalizeProjectOnePromptConfig(savedV5Customer).liveCustomerPrompt,
  CUSTOMER_PROMPT(),
  'the exact October 14 v5 customer default upgrades to the current default',
);
const editedV5Customer = structuredClone(DEFAULT_PROJECT_ONE_PROMPT_CONFIG);
editedV5Customer.liveCustomerPrompt = `${october14BeforeQualityFixCustomerSnapshot}x`;
assert.equal(
  normalizeProjectOnePromptConfig(editedV5Customer).liveCustomerPrompt,
  editedV5Customer.liveCustomerPrompt,
  'a one-character edit to the October 14 v5 customer prompt remains custom',
);
const customerPlainTextPrompt = CUSTOMER_PROMPT();
const customerExplicitPlainTextPrompt = CUSTOMER_PROMPT('plain_text');
const customerJsonPrompt = CUSTOMER_PROMPT('json_content');
assert.equal(customerPlainTextPrompt, customerExplicitPlainTextPrompt, 'plain text is the default customer output mode');
assert.equal(DEFAULT_PROJECT_ONE_PROMPT_CONFIG.liveCustomerPrompt, customerPlainTextPrompt, 'the saved default customer prompt uses plain text mode');
assert.match(customerPlainTextPrompt, /只输出NPC对玩家说的正文/);
assert.match(customerPlainTextPrompt, /不输出JSON/);
assert.match(customerJsonPrompt, /严格输出一个合法JSON对象/);
assert.match(customerJsonPrompt, /一个字符串字段 content/);
assert.match(customerJsonPrompt, /content只写NPC对玩家说的正文/);
assert.doesNotMatch(customerJsonPrompt, /不输出JSON|不得输出JSON|禁止输出JSON/);
assert.equal(customerPlainTextPrompt.split(NPC_NATURAL_DIALOGUE_RULES).length - 1, 0, 'the customer base prompt does not duplicate the shared speech rules');
assert.equal(customerJsonPrompt.split(NPC_NATURAL_DIALOGUE_RULES).length - 1, 0, 'the customer JSON prompt does not duplicate the shared speech rules');

const savedOctober14Customer = structuredClone(DEFAULT_PROJECT_ONE_PROMPT_CONFIG);
savedOctober14Customer.liveCustomerPrompt = october14BeforeNaturalDialogueCustomerSnapshot;
assert.equal(
  normalizeProjectOnePromptConfig(savedOctober14Customer).liveCustomerPrompt,
  CUSTOMER_PROMPT(),
  'the exact October 14 customer default upgrades to the current default',
);
const editedOctober14Customer = structuredClone(DEFAULT_PROJECT_ONE_PROMPT_CONFIG);
editedOctober14Customer.liveCustomerPrompt = `${october14BeforeNaturalDialogueCustomerSnapshot}\n设计师自定义内容`;
assert.equal(
  normalizeProjectOnePromptConfig(editedOctober14Customer).liveCustomerPrompt,
  editedOctober14Customer.liveCustomerPrompt,
  'an edited October 14 customer prompt remains byte-for-byte custom',
);
const savedCommit81Customer = structuredClone(DEFAULT_PROJECT_ONE_PROMPT_CONFIG);
savedCommit81Customer.liveCustomerPrompt = customerPromptFromCommit81a975fb6;
assert.equal(
  normalizeProjectOnePromptConfig(savedCommit81Customer).liveCustomerPrompt,
  CUSTOMER_PROMPT(),
  'the exact customer default from commit 81a975fb6 upgrades to the current default',
);
const editedCommit81Customer = structuredClone(DEFAULT_PROJECT_ONE_PROMPT_CONFIG);
editedCommit81Customer.liveCustomerPrompt = `${customerPromptFromCommit81a975fb6}x`;
assert.equal(
  normalizeProjectOnePromptConfig(editedCommit81Customer).liveCustomerPrompt,
  editedCommit81Customer.liveCustomerPrompt,
  'a one-character edit to the commit 81a975fb6 customer prompt remains custom',
);
const emptyCustomerPrompt = structuredClone(DEFAULT_PROJECT_ONE_PROMPT_CONFIG);
emptyCustomerPrompt.liveCustomerPrompt = '';
assert.equal(
  normalizeProjectOnePromptConfig(emptyCustomerPrompt).liveCustomerPrompt,
  '',
  'an explicitly empty customer prompt remains custom',
);

const savedOctober14Channels = structuredClone(DEFAULT_PROJECT_ONE_PROMPT_CONFIG);
for (const [channelId, snapshot] of Object.entries(october14BeforeNaturalDialogueChannelSnapshot.channelModifiers)) {
  savedOctober14Channels.channelModifiers[channelId] = snapshot.modifier;
}
for (const [npcId, channels] of Object.entries(october14BeforeNaturalDialogueChannelSnapshot.npcChannelExceptions)) {
  savedOctober14Channels.npcChannelExceptions[npcId] = { ...channels };
}
const upgradedOctober14Channels = normalizeProjectOnePromptConfig(savedOctober14Channels);
for (const [channelId, current] of Object.entries(PROJECT_ONE_CHANNEL_MODIFIERS)) {
  assert.equal(
    upgradedOctober14Channels.channelModifiers[channelId],
    current.modifier,
    `the exact October 14 ${channelId} modifier upgrades`,
  );
}
for (const [npcId, channels] of Object.entries(PROJECT_ONE_NPC_CHANNEL_EXCEPTIONS)) {
  for (const [channelId, current] of Object.entries(channels)) {
    assert.equal(
      upgradedOctober14Channels.npcChannelExceptions[npcId]?.[channelId],
      current,
      `the exact October 14 ${npcId} ${channelId} exception upgrades`,
    );
  }
}
for (const [channelId, snapshot] of Object.entries(october14BeforeNaturalDialogueChannelSnapshot.channelModifiers)) {
  const customValue = `${snapshot.modifier}\n设计师自定义渠道内容`;
  const edited = structuredClone(savedOctober14Channels);
  edited.channelModifiers[channelId] = customValue;
  assert.equal(
    normalizeProjectOnePromptConfig(edited).channelModifiers[channelId],
    customValue,
    `an edited ${channelId} modifier remains custom`,
  );
}
for (const [npcId, channels] of Object.entries(october14BeforeNaturalDialogueChannelSnapshot.npcChannelExceptions)) {
  for (const [channelId, snapshot] of Object.entries(channels)) {
    const customValue = `${snapshot}\n设计师自定义渠道例外`;
    const edited = structuredClone(savedOctober14Channels);
    edited.npcChannelExceptions[npcId][channelId] = customValue;
    assert.equal(
      normalizeProjectOnePromptConfig(edited).npcChannelExceptions[npcId]?.[channelId],
      customValue,
      `an edited ${npcId} ${channelId} exception remains custom`,
    );
  }
}
const explicitEmptyChannelValues = structuredClone(DEFAULT_PROJECT_ONE_PROMPT_CONFIG);
explicitEmptyChannelValues.channelModifiers.visit = '';
explicitEmptyChannelValues.npcChannelExceptions['P1-001'].visit = '';
const normalizedEmptyChannelValues = normalizeProjectOnePromptConfig(explicitEmptyChannelValues);
assert.equal(normalizedEmptyChannelValues.channelModifiers.visit, '', 'an explicitly empty channel modifier remains custom');
assert.equal(normalizedEmptyChannelValues.npcChannelExceptions['P1-001'].visit, '', 'an explicitly empty NPC channel exception remains custom');

const wangBase = PROJECT_ONE_NPC_ROLE_PROMPT_PROFILES['P1-003'].base;
assert.match(wangBase, /临近职业生涯的阶段性收口/);
assert.match(wangBase, /伴侣正在整理旧物/);
assert.match(wangBase, /退休后的生活安排/);
assert.doesNotMatch(wangBase, /家里正安排搬迁|更重要的采购职责/);
const zhaoBase = PROJECT_ONE_NPC_ROLE_PROMPT_PROFILES['P1-004'].base;
assert.match(zhaoBase, /长辈正处在恢复期/);
assert.doesNotMatch(zhaoBase, /准备考试/);
const liuBase = PROJECT_ONE_NPC_ROLE_PROMPT_PROFILES['P1-005'].base;
assert.match(liuBase, /职业考试/);
assert.match(liuBase, /亲属搬家/);
assert.doesNotMatch(liuBase, /幼儿接送/);
assert.match(PROJECT_ONE_NPC_ROLE_PROMPT_PROFILES['P1-003'].base, /热情健谈|愿意聊两句/);
assert.doesNotMatch(PROJECT_ONE_NPC_ROLE_PROMPT_PROFILES['P1-003'].base, /不爱寒暄/);
assert.doesNotMatch(PROJECT_ONE_NPC_ROLE_PROMPT_PROFILES['P1-003'].base, /按规矩办更稳妥|材料齐了才好流转/);
assert.doesNotMatch(PROJECT_ONE_NPC_ROLE_PROMPT_PROFILES['P1-004'].base, /我先核对一下|麻烦您把范围说具体些/);
assert.doesNotMatch(PROJECT_ONE_NPC_ROLE_PROMPT_PROFILES['P1-005'].base, /我帮您看看合适窗口|麻烦您把要点发我/);

assert.deepEqual(DEFAULT_NPC_SUPPORT_TIER_THRESHOLDS, { mediumMin: 35, highMin: 70 });
assert.equal(supportPromptTier(0), 'low');
assert.equal(supportPromptTier(34), 'low');
assert.equal(supportPromptTier(35), 'medium');
assert.equal(supportPromptTier(69), 'medium');
assert.equal(supportPromptTier(70), 'high');
assert.equal(supportPromptTier(100), 'high');
const customThresholds = { mediumMin: 40, highMin: 80 };
assert.equal(supportPromptTier(39, customThresholds), 'low');
assert.equal(supportPromptTier(40, customThresholds), 'medium');
assert.equal(supportPromptTier(79, customThresholds), 'medium');
assert.equal(supportPromptTier(80, customThresholds), 'high');
assert.match(NPC_NATURAL_DIALOGUE_RULES, /日常微信、电话、拜访默认一句，通常8-35字/);
assert.match(NPC_NATURAL_DIALOGUE_RULES, /长度不随支持度机械增加/);
assert.match(NPC_NATURAL_DIALOGUE_RULES, /无论支持、冷淡、不悦或反复拒绝，都礼貌客气/);
assert.match(NPC_NATURAL_DIALOGUE_RULES, /模糊推脱不等于会面已结束/);
assert.match(NPC_NATURAL_DIALOGUE_RULES, /不得自行编造熟悉度、忙碌事件或新的状态数值/);
assert.match(NPC_NATURAL_DIALOGUE_RULES, /正式邮件/);
assert.match(NPC_NATURAL_DIALOGUE_RULES, /系统结构化字段/);

const isolatedProfile = { base: '基础背景', low: '低档正文', medium: '中档正文', high: '高档正文' };
const isolatedLow = composeNpcRolePrompt(isolatedProfile, 39, 50, customThresholds);
const isolatedMedium = composeNpcRolePrompt(isolatedProfile, 40, 50, customThresholds);
const isolatedHigh = composeNpcRolePrompt(isolatedProfile, 80, 50, customThresholds);
assert.match(isolatedLow, /低档正文/);
assert.doesNotMatch(isolatedLow, /中档正文|高档正文|40|80|服务端支持度|档位规则/);
assert.match(isolatedLow, /无论愉悦度高低，始终礼貌客气/);
assert.ok(isolatedLow.startsWith(NPC_NATURAL_DIALOGUE_RULES), 'shared natural dialogue rules are injected before the role prompt');
assert.equal(isolatedLow.split(NPC_NATURAL_DIALOGUE_RULES).length - 1, 1, 'shared rules appear once in a composed prompt');
assert.equal(`${customerPlainTextPrompt}\n\n${isolatedLow}`.split(NPC_NATURAL_DIALOGUE_RULES).length - 1, 1, 'combined plain text prompt includes shared rules exactly once');
assert.equal(`${customerJsonPrompt}\n\n${isolatedLow}`.split(NPC_NATURAL_DIALOGUE_RULES).length - 1, 1, 'combined JSON prompt includes shared rules exactly once');
assert.match(isolatedMedium, /中档正文/);
assert.equal(isolatedMedium.split(NPC_NATURAL_DIALOGUE_RULES).length - 1, 1, 'medium-tier composed prompt includes one shared rule');
assert.doesNotMatch(isolatedMedium, /低档正文|高档正文/);
assert.match(isolatedHigh, /高档正文/);
assert.equal(isolatedHigh.split(NPC_NATURAL_DIALOGUE_RULES).length - 1, 1, 'high-tier composed prompt includes one shared rule');
assert.doesNotMatch(isolatedHigh, /低档正文|中档正文/);
assert.match(composeNpcRolePrompt(isolatedProfile, 20, 34), /措辞略显克制/);
assert.match(composeNpcRolePrompt(isolatedProfile, 20, 35), /措辞保持正常、职业/);
assert.match(composeNpcRolePrompt(isolatedProfile, 20, 70), /措辞略显自然、友善/);

assert.deepEqual(Object.keys(PROJECT_ONE_NPC_ROLE_PROMPTS).sort(), [...PROJECT_ONE_FIVE_PERSON_IDS].sort());
console.log('五人人物提示词分档专项测试通过');
