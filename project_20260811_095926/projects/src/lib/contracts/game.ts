import { z } from 'zod';
import { emailAttachmentSchema } from '@/lib/contracts/ai';

const customerActivityCommandBaseSchema = {
  taskId: z.string().trim().min(1).max(512),
  commandId: z.string().trim().min(1).max(128),
  expectedVersion: z.number().int().nonnegative(),
};

export const customerActivityMutationSchema = z.discriminatedUnion('action', [
  z.object({
    ...customerActivityCommandBaseSchema,
    action: z.literal('start'),
  }).strict(),
  z.object({
    ...customerActivityCommandBaseSchema,
    action: z.literal('save'),
    draft: z.string().max(12_000),
  }).strict(),
  z.object({
    ...customerActivityCommandBaseSchema,
    action: z.literal('submit'),
    draft: z.string().max(12_000).optional(),
  }).strict(),
]);

export type CustomerActivityMutation = z.infer<typeof customerActivityMutationSchema>;

export const createGameSessionRequestSchema = z.object({
  scenarioCode: z.literal('project-1'),
  replaceExisting: z.boolean().default(false),
});

export const relationshipActionRequestSchema = z.object({
  npcId: z.string().trim().min(1).max(128),
  actionId: z.enum(['gift', 'dinner', 'tea', 'festival', 'roadshow', 'visit', 'sample', 'video']),
});

export const timerControlRequestSchema = z.object({
  action: z.enum(['pause', 'resume']),
});

export const endMeetingRequestSchema = z.object({
  reason: z.enum(['player']).default('player'),
});

export const replenishActionPointsRequestSchema = z.object({
  amount: z.number().int().min(1).max(999),
});

const commandBaseSchema = {
  commandId: z.string().trim().min(1).max(128),
  expectedVersion: z.number().int().nonnegative(),
};

const npcIdSchema = z.string().trim().min(1).max(128);
const entityIdSchema = z.string().trim().min(1).max(160);
const textSchema = z.string().trim().min(1).max(1000);
const emptyPayloadSchema = z.object({}).default({});

export const contactGameCommandSchema = z.object({
  ...commandBaseSchema,
  type: z.literal('contact'),
  payload: z.object({
    npcId: npcIdSchema,
    channel: z.enum(['email', 'work_phone', 'wechat', 'online']),
    content: textSchema.optional(),
  }),
});

export const requestWechatGameCommandSchema = z.object({
  ...commandBaseSchema,
  type: z.literal('request_wechat'),
  payload: z.object({ npcId: npcIdSchema, message: textSchema }),
});

export const inviteGameCommandSchema = z.object({
  ...commandBaseSchema,
  type: z.literal('invite'),
  payload: z.object({
    npcId: npcIdSchema,
    channel: z.enum(['email', 'work_phone', 'wechat', 'online']),
    rawText: textSchema.optional(),
    attachmentIds: z.array(entityIdSchema).max(8).default([]),
    emailAttachments: z.array(emailAttachmentSchema).max(8).default([]),
    // Legacy structured fields remain optional for old clients and tests. New
    // player flows send natural language and let the server resolve defaults.
    invitationMethod: z.enum(['dedicated', 'drop_in']).optional(),
    visitType: z.enum(['short', 'formal', 'informal']).optional(),
    venue: z.string().trim().min(1).max(120).optional(),
    purpose: textSchema.optional(),
    scheduledRound: z.number().int().min(1).max(5).optional(),
    startMinute: z.number().int().min(9 * 60).max(22 * 60).optional(),
  }),
});

export const prepareGameCommandSchema = z.object({
  ...commandBaseSchema,
  type: z.literal('prepare'),
  payload: z.object({
    npcId: npcIdSchema,
    appointmentId: entityIdSchema.nullable().optional(),
    preparationType: z.enum(['visit_preparation', 'agenda', 'ppt', 'materials', 'courtesy_gift', 'boundary_gift']).default('visit_preparation'),
    title: z.string().trim().min(1).max(120).default('拜访前准备'),
    content: z.string().trim().min(10).max(4000),
  }),
});

export const startVisitGameCommandSchema = z.object({
  ...commandBaseSchema,
  type: z.literal('start_visit'),
  payload: z.object({
    appointmentId: entityIdSchema.optional(),
    /** No appointment means an at-risk direct drop-in visit. */
    npcId: npcIdSchema.optional(),
    preparationIds: z.array(entityIdSchema).max(12).default([]),
    // Optional for old persisted/client commands; reducer treats omission as false.
    skipPreparation: z.boolean().optional(),
  }).superRefine((value, context) => {
    if (!value.appointmentId && !value.npcId) context.addIssue({ code: z.ZodIssueCode.custom, path: ['npcId'], message: '直访需要指定NPC' });
  }),
});

export const workPlanGameCommandSchema = z.object({
  ...commandBaseSchema,
  type: z.literal('work_plan'),
  payload: z.object({
    scope: z.enum(['global', 'npc']),
    npcId: npcIdSchema.optional(),
    content: z.string().trim().min(10).max(4_000),
  }).superRefine((value, context) => {
    if (value.scope === 'npc' && !value.npcId) context.addIssue({ code: z.ZodIssueCode.custom, path: ['npcId'], message: '人物计划需要指定NPC' });
    if (value.scope === 'global' && value.npcId) context.addIssue({ code: z.ZodIssueCode.custom, path: ['npcId'], message: '整体计划不能指定NPC' });
  }),
});

export const postalGameCommandSchema = z.object({
  ...commandBaseSchema,
  type: z.literal('postal'),
  payload: z.object({
    npcId: npcIdSchema,
    content: z.string().trim().min(1).max(2_000),
    attachment: z.object({
      title: z.string().trim().min(1).max(120),
      content: z.string().trim().min(1).max(1_000),
    }).strict().optional(),
  }),
});

export const briefVisitGameCommandSchema = z.object({
  ...commandBaseSchema,
  type: z.literal('brief_visit'),
  payload: z.object({ npcId: npcIdSchema, content: z.string().trim().min(10).max(4_000) }),
});

export const endVisitGameCommandSchema = z.object({
  ...commandBaseSchema,
  type: z.literal('end_visit'),
  payload: z.object({
    appointmentId: entityIdSchema.optional(),
    meetingId: entityIdSchema.optional(),
    reason: z.enum(['completed', 'player', 'npc_left']).default('completed'),
    summary: z.string().trim().max(2000).default(''),
  }),
});

export const endPhoneCallGameCommandSchema = z.object({
  ...commandBaseSchema,
  type: z.literal('end_phone_call'),
  payload: z.object({ npcId: npcIdSchema.optional() }),
});

export const giveGiftGameCommandSchema = z.object({
  ...commandBaseSchema,
  type: z.literal('give_gift'),
  payload: z.object({
    preparationId: entityIdSchema,
    appointmentId: entityIdSchema.optional(),
    setting: z.enum(['public', 'private']).default('public'),
    witnesses: z.array(npcIdSchema).max(8).default([]),
    exchangeRequested: z.boolean().default(false),
  }),
});

export const followUpGameCommandSchema = z.object({
  ...commandBaseSchema,
  type: z.literal('follow_up'),
  payload: z.union([
    z.object({
      action: z.literal('deliver_preparation'),
      npcId: npcIdSchema,
      appointmentId: entityIdSchema.optional(),
      preparationId: entityIdSchema,
    }),
    z.object({
      action: z.literal('message').default('message'),
      npcId: npcIdSchema,
      appointmentId: entityIdSchema,
      channel: z.enum(['email', 'work_phone', 'wechat', 'online']),
      content: textSchema,
      preparationIds: z.array(entityIdSchema).max(8).default([]),
    }),
  ]),
});

export const updateAppointmentGameCommandSchema = z.object({
  ...commandBaseSchema,
  type: z.literal('update_appointment'),
  payload: z.object({
    appointmentId: entityIdSchema,
    action: z.enum(['accept_counter', 'cancel']),
  }),
});

export const updateMeetingMinutesGameCommandSchema = z.object({
  ...commandBaseSchema,
  type: z.literal('update_meeting_minutes'),
  payload: z.object({
    minutesId: entityIdSchema,
    summary: z.string().trim().min(1).max(2000),
    confirmedItems: z.array(z.string().trim().min(1).max(300)).max(12),
    npcCommitments: z.array(z.string().trim().min(1).max(300)).max(12),
    playerCommitments: z.array(z.string().trim().min(1).max(300)).max(12),
    nextStep: z.string().trim().min(1).max(500),
  }),
});

/** Legacy no-op retained so an old open client does not corrupt a save. */
export const waitGameCommandSchema = z.object({
  ...commandBaseSchema,
  type: z.literal('wait'),
  payload: z.object({ minutes: z.number().int().min(1).max(13 * 60) }),
});

export const submitGameCommandSchema = z.object({
  ...commandBaseSchema,
  type: z.literal('submit'),
  payload: emptyPayloadSchema,
});

export const markNotificationReadGameCommandSchema = z.object({
  ...commandBaseSchema,
  type: z.literal('mark_notification_read'),
  payload: z.object({ notificationId: entityIdSchema }),
});

export const researchPublicInfoGameCommandSchema = z.object({
  ...commandBaseSchema,
  type: z.literal('research_public_info'),
  payload: z.object({ npcId: npcIdSchema }),
});

export const proposeBidRuleGameCommandSchema = z.object({
  ...commandBaseSchema,
  type: z.literal('propose_bid_rule'),
  // The player expresses a business recommendation in their own words.  The
  // server interprets a single explicit direction and never trusts a browser
  // supplied rule enum.
  payload: z.object({
    targetContactId: npcIdSchema,
    proposalText: z.string().trim().min(12).max(500),
  }),
});

/** Versioned deterministic commands used by the unified game command API. */
export const gameCommandSchema = z.discriminatedUnion('type', [
  contactGameCommandSchema,
  requestWechatGameCommandSchema,
  inviteGameCommandSchema,
  updateAppointmentGameCommandSchema,
  prepareGameCommandSchema,
  workPlanGameCommandSchema,
  postalGameCommandSchema,
  briefVisitGameCommandSchema,
  startVisitGameCommandSchema,
  endVisitGameCommandSchema,
  endPhoneCallGameCommandSchema,
  giveGiftGameCommandSchema,
  followUpGameCommandSchema,
  updateMeetingMinutesGameCommandSchema,
  waitGameCommandSchema,
  submitGameCommandSchema,
  markNotificationReadGameCommandSchema,
  researchPublicInfoGameCommandSchema,
  proposeBidRuleGameCommandSchema,
]);

export type GameCommand = z.infer<typeof gameCommandSchema>;

export const gameReviewSchema = z.object({
  strengths: z.array(z.string().trim().min(1).max(300)).min(1).max(3),
  improvements: z.array(z.string().trim().min(1).max(300)).min(1).max(3),
  nextActions: z.array(z.string().trim().min(1).max(300)).min(1).max(3),
});

export type GameReview = z.infer<typeof gameReviewSchema>;
