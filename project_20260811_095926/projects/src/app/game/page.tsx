'use client';

import { Suspense, useEffect, useId, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import {
  Building2,
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  Mail,
  MapPin,
  MessageCircle,
  Mic,
  MicOff,
  PackageCheck,
  Phone,
  Play,
  Send,
  Sparkles,
  Timer,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import { isCurrentPreparationType, type GamePublicResearchRecord, type GameRuntimeState } from '@/lib/game/state';
import { isLegacyCompetitorPlaceholder, type CompetitorProfile } from '@/lib/contracts/competitors';
import { CustomerActivityPlanner } from '@/components/customer-activity-planner';
import { BID_RULE_PROPOSAL_COST } from '@/lib/game/bid-rules';
import styles from './game-board.module.css';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  ts: number;
  deliveryStatus?: 'sent' | 'replied' | 'unanswered';
  readStatus?: 'read' | 'unread';
  channel?: 'email' | 'work_phone' | 'online' | 'offline';
  attachments?: ChatAttachmentView[];
  emailAttachments?: EmailAttachmentDraft[];
}

interface CallHistoryRecord {
  id: string;
  npcId: string;
  outcome: 'connected' | 'unanswered' | 'declined' | 'call_later';
  round: number;
  createdAt: string;
}

interface EmailAttachmentDraft {
  fileName: string;
  description: string;
}

interface ChatAttachmentView extends EmailAttachmentDraft {
  viewed?: boolean;
  impact?: string;
}

interface NpcProfile {
  id: string;
  category: string;
  name: string;
  title: string;
  gender: string;
  age: number | null;
  hometown: string;
  personality: string;
  weakness: string | null;
}

interface AppointmentView {
  id: string;
  npcId: string;
  visitType: 'short' | 'formal' | 'informal';
  approach: 'dedicated' | 'drop_by';
  status: string;
  location: string;
  purpose: string;
  scheduledMinute: number;
  scheduledLabel?: string;
  durationMinutes: number;
  conditions: string[];
}

interface PreparationView {
  id: string;
  npcId: string;
  appointmentId?: string;
  type: string;
  title: string;
  status: string;
  cost: number;
  minutes: number;
  feedback?: { strengths: string[]; risks: string[]; nextStep: string };
  brief?: {
    audience: string;
    problem: string;
    dimensions: string;
    evidence: string;
    nextStep: string;
  };
}

interface NotificationView {
  id: string;
  npcId?: string;
  title: string;
  body: string;
  read: boolean;
  createdLabel?: string;
  target?: string;
}

interface MeetingMinutesView {
  id: string;
  appointmentId: string;
  npcId: string;
  visitType: 'short' | 'formal' | 'informal';
  summary: string;
  confirmedItems: string[];
  npcCommitments: string[];
  playerCommitments: string[];
  pendingMaterials: string[];
  nextStep: string;
  nextStepRound: number;
  nextStepMinute: number;
  owner: string;
  revisionCount: number;
}

interface InvitationResultView {
  appointment: AppointmentView;
  npcName: string;
  feedback: string;
}

interface MeetingMinutesDraft {
  id: string;
  summary: string;
  confirmedItems: string;
  npcCommitments: string;
  playerCommitments: string;
  nextStep: string;
}

interface ActiveMeetingView {
  id: string;
  npcId: string;
  appointmentId?: string;
  visitType: 'short' | 'formal' | 'informal';
  turnCount: number;
  maxTurns: number;
  durationMinutes: number;
  workTopicOpenedBy?: string;
  usedPreparationIds: string[];
  completedTasks: string[];
  awaitingFinalReplyFrom?: 'player';
}

type DesignerImageAssetMap = Record<string, string>;

interface GameSaveView {
  id: string;
  scenarioCode: string;
  updatedAt: string;
  startedAt: string;
}

interface ProjectTimerView {
  durationMs: number;
  elapsedMs: number;
  remainingMs: number;
  recoveredIntervals: number;
  isPaused: boolean;
  expiresAt: string | null;
  lastResumedAt: string | null;
  serverNow: string | null;
}

interface ProjectNoticeView {
  title: string;
  summary: string;
  budget: string | number;
  sections: Array<{ heading: string; content: string[] }>;
}

interface SpeechRecognitionResultEventLike {
  results: ArrayLike<{ 0: { transcript: string } }>;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;
type WorkspaceMode = 'global_plan' | 'overview' | 'wechat_request' | 'conversation' | 'postal' | 'visit' | 'preparation';
type CommunicationChannel = 'email' | 'work_phone' | 'online';
type VisitStep = 'intro' | 'preparation' | 'mode' | 'brief' | 'brief_result';

const COMMON_WECHAT_EMOJIS = ['😀', '🙂', '😊', '👍', '👏', '🙏', '🎉', '💡', '✅', '🙌', '🤝', '⏳', '✨', '💪', '😄', '📌'] as const;
const WECHAT_STICKERS = [
  { id: 'received', name: '收到', symbol: '📩', hint: '已收到，马上跟进' },
  { id: 'okay', name: '好的', symbol: '👌', hint: '好的，按这个推进' },
  { id: 'thanks', name: '感谢', symbol: '🙏', hint: '感谢你的配合' },
  { id: 'cheer', name: '加油', symbol: '💪', hint: '一起加油推进' },
  { id: 'like', name: '赞', symbol: '👍', hint: '这个建议很好' },
  { id: 'wait', name: '稍等', symbol: '⏳', hint: '我确认后回复' },
  { id: 'hard-work', name: '辛苦了', symbol: '☕', hint: '辛苦你跟进了' },
  { id: 'handshake', name: '握手', symbol: '🤝', hint: '合作愉快' },
] as const;
const NPC_EXPRESSIONS = new Set(['angry', 'serious', 'calm', 'pleasant', 'very_happy']);

const SCENE_INFO: Record<string, { name: string; budget: number; difficulty: number; description: string }> = {
  'project-1': {
    name: '项目一 · 单单位内部竞标',
    budget: 100,
    difficulty: 1,
    description: '围绕客户的真实组织需求建立联系、摸清决策链，并用可靠方案推动项目。根据人物的语言和行动判断项目进展。',
  },
  'project-2': { name: '项目二 · 国产化改造项目', budget: 300, difficulty: 2, description: '协调甲方与设计院，推动复杂技术改造项目。' },
  'project-3': { name: '项目三 · 大型央企升级项目', budget: 1000, difficulty: 3, description: '识别多部门制衡关系，建立可靠的高层沟通路径。' },
  'project-4': { name: '项目四 · 一体化总包解决方案', budget: 200, difficulty: 4, description: '重塑客户价值，寻找超越单品低价竞争的突破口。' },
};

const VISIT_LABELS = { short: '短时拜访', formal: '正式拜访', informal: '非正式拜访' } as const;
const VISIT_DURATIONS = { short: 5, formal: 40, informal: 60 } as const;
const VISIT_MAX_TURNS = { short: 2, formal: 6, informal: 5 } as const;
const STATUS_LABELS: Record<string, string> = {
  pending: '待回复',
  accepted: '已接受',
  countered: 'NPC改期',
  rejected: '已拒绝',
  cancelled: '已取消',
  missed: '已爽约',
  active: '进行中',
  completed: '已完成',
};
const PREPARATION_OPTIONS = [
  { type: 'visit_preparation', title: '拜访前准备', minutes: 0, cost: 0 },
] as const;
const NPC_FALLBACK_IMAGES: Record<string, string> = {
  'P1-001': '/assets/people/zhang-jianguo.png',
  'P1-002': '/assets/people/li-minghui.png',
  'P1-003': '/assets/people/wang-defu.png',
  'P1-004': '/assets/people/zhao-xiaochen.png',
  'P1-005': '/assets/people/liu-siqi.png',
};
function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function firstRecord(source: Record<string, unknown> | null, keys: string[]): Record<string, unknown> | null {
  if (!source) return null;
  for (const key of keys) {
    const result = asRecord(source[key]);
    if (result) return result;
  }
  return null;
}

function firstArray(source: Record<string, unknown> | null, keys: string[]): unknown[] {
  if (!source) return [];
  for (const key of keys) {
    if (Array.isArray(source[key])) return source[key] as unknown[];
  }
  return [];
}

function firstString(source: Record<string, unknown> | null, keys: string[], fallback = ''): string {
  if (!source) return fallback;
  for (const key of keys) {
    if (typeof source[key] === 'string') return source[key] as string;
  }
  return fallback;
}

function firstNumber(source: Record<string, unknown> | null, keys: string[], fallback = 0): number {
  if (!source) return fallback;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return fallback;
}

function parseMinuteLabel(label: string, fallback = 540): number {
  const matched = /^(\d{1,2}):(\d{2})$/.exec(label);
  return matched ? Number(matched[1]) * 60 + Number(matched[2]) : fallback;
}

function formatClock(totalMinutes: number): string {
  const normalized = Math.max(0, Math.round(totalMinutes));
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
}

function formatCountdown(milliseconds: number): string {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function readProjectTimer(state: unknown): ProjectTimerView | null {
  const timer = firstRecord(asRecord(state), ['projectTimer']);
  if (!timer) return null;
  const durationMs = firstNumber(timer, ['durationMs'], 1_200_000);
  const remainingMs = firstNumber(timer, ['remainingMs'], durationMs);
  return {
    durationMs,
    elapsedMs: firstNumber(timer, ['elapsedMs'], Math.max(0, durationMs - remainingMs)),
    remainingMs,
    recoveredIntervals: firstNumber(timer, ['recoveredIntervals']),
    isPaused: timer.isPaused === true,
    expiresAt: firstString(timer, ['expiresAt']) || null,
    lastResumedAt: firstString(timer, ['lastResumedAt']) || null,
    serverNow: firstString(timer, ['serverNow']) || null,
  };
}

function timerRemainingAtServerProjection(timer: ProjectTimerView): number {
  const expiryMs = timer.expiresAt ? Date.parse(timer.expiresAt) : Number.NaN;
  const serverNowMs = timer.serverNow ? Date.parse(timer.serverNow) : Number.NaN;
  return Number.isFinite(expiryMs) && Number.isFinite(serverNowMs)
    ? Math.max(0, expiryMs - serverNowMs)
    : timer.remainingMs;
}

function formatMessageTime(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(timestamp));
}

function callOutcomeLabel(outcome: CallHistoryRecord['outcome']): string {
  const labels: Record<CallHistoryRecord['outcome'], string> = {
    connected: '已接通',
    unanswered: '未接通',
    declined: '已拒接',
    call_later: '建议稍后联系',
  };
  return labels[outcome];
}

function imageCandidates(imageAssets: DesignerImageAssetMap, npcId: string, expression?: string): string[] {
  return [...new Set([
    expression ? imageAssets[`person_expression:${npcId}:${expression}`] : undefined,
    imageAssets[`person_intro:${npcId}`],
    NPC_FALLBACK_IMAGES[npcId],
  ].filter((value): value is string => Boolean(value)))];
}

function sceneImageCandidates(imageAssets: DesignerImageAssetMap, npcId: string, location: string): string[] {
  const locationKey = /电梯/.test(location) ? 'elevator' : /酒馆|酒吧|酒/.test(location) ? 'bar' : /饭店|餐厅|餐馆|餐/.test(location) ? 'restaurant' : 'office';
  const keys = npcId === 'P1-001'
    ? ['visit_scene:leader_office', 'visit_scene:office']
    : [`visit_scene:${locationKey}`, 'visit_scene:office'];
  return [...new Set([...keys.map((key) => imageAssets[key]), '/images/game/visit-meeting-room-empty-v1.png'].filter((value): value is string => Boolean(value)))];
}

function PersonPortrait({
  npcId,
  name,
  imageAssets,
  className,
  expression,
  sizes,
  priority = false,
}: {
  npcId: string;
  name: string;
  imageAssets: DesignerImageAssetMap;
  className: string;
  expression?: string;
  sizes: string;
  priority?: boolean;
}) {
  const sources = imageCandidates(imageAssets, npcId, expression);
  const sourceKey = sources.join('|');
  const [failedSources, setFailedSources] = useState<string[]>([]);
  useEffect(() => setFailedSources([]), [sourceKey]);
  const source = sources.find((candidate) => !failedSources.includes(candidate));

  return (
    <div className={className} aria-label={`${name}头像`}>
      {source ? <Image src={source} alt={name} fill sizes={sizes} unoptimized priority={priority} onError={() => setFailedSources((current) => current.includes(source) ? current : [...current, source])} /> : <span className="select-none">{name.slice(0, 1)}</span>}
    </div>
  );
}

function VisitBackdrop({ sources }: { sources: string[] }) {
  const sourceKey = sources.join('|');
  const [failedSources, setFailedSources] = useState<string[]>([]);
  useEffect(() => setFailedSources([]), [sourceKey]);
  const source = sources.find((candidate) => !failedSources.includes(candidate));
  return <>{source ? <Image src={source} alt="拜访场景" fill sizes="100vw" unoptimized priority className={styles.visitBackdropImage} onError={() => setFailedSources((current) => current.includes(source) ? current : [...current, source])} /> : null}<div className={styles.visitBackdropFallback} /></>;
}

function simulationRecord(state: GameRuntimeState | null): Record<string, unknown> | null {
  const root = asRecord(state);
  return firstRecord(root, ['simulation', 'simulationState', 'simulationTime', 'schedule']) ?? root;
}

function getAppointments(state: GameRuntimeState | null): AppointmentView[] {
  const root = asRecord(state);
  const simulation = simulationRecord(state);
  const raw = firstArray(simulation, ['appointments', 'visits', 'calendar']) .length > 0
    ? firstArray(simulation, ['appointments', 'visits', 'calendar'])
    : firstArray(root, ['appointments', 'visits']);
  return raw.map((value, index) => {
    const item = asRecord(value);
    const rawType = firstString(item, ['visitType', 'type', 'meetingType'], 'formal');
    const visitType: AppointmentView['visitType'] = rawType === 'short' || rawType === 'informal' ? rawType : 'formal';
    const scheduledLabel = firstString(item, ['scheduledTime', 'timeLabel', 'time']);
    return {
      id: firstString(item, ['id', 'appointmentId'], `appointment-${index}`),
      npcId: firstString(item, ['npcId', 'contactId']),
      visitType,
      approach: ['drop_by', 'drop_in'].includes(firstString(item, ['approach', 'invitationMethod', 'travelMode', 'invitationMode'])) ? 'drop_by' as const : 'dedicated' as const,
      status: firstString(item, ['status'], 'pending'),
      location: firstString(item, ['location', 'venue'], visitType === 'formal' ? '办公室' : '咖啡厅'),
      purpose: firstString(item, ['purpose', 'objective'], '进一步沟通'),
      scheduledMinute: firstNumber(item, ['startMinute', 'scheduledMinute', 'minuteOfDay'], scheduledLabel ? parseMinuteLabel(scheduledLabel) : 840),
      scheduledLabel: scheduledLabel || undefined,
      durationMinutes: firstNumber(item, ['durationMinutes', 'duration'], VISIT_DURATIONS[visitType]),
      conditions: firstArray(item, ['conditions', 'requirements']).filter((entry): entry is string => typeof entry === 'string'),
    };
  });
}

function getPreparations(state: GameRuntimeState | null): PreparationView[] {
  const root = asRecord(state);
  const simulation = simulationRecord(state);
  const nested = firstArray(simulation, ['preparations', 'materials', 'inventory']);
  const raw = nested.length > 0 ? nested : firstArray(root, ['preparations', 'materials', 'inventory']);
  return raw.map((value, index) => {
    const item = asRecord(value);
    const brief = firstRecord(item, ['brief']);
    const feedback = firstRecord(item, ['feedback']);
    const type = firstString(item, ['type', 'preparationType', 'kind'], 'materials');
    const option = PREPARATION_OPTIONS.find((entry) => entry.type === type);
    return {
      id: firstString(item, ['id', 'preparationId'], `preparation-${index}`),
      npcId: firstString(item, ['npcId', 'contactId']),
      appointmentId: firstString(item, ['appointmentId']) || undefined,
      type,
      title: firstString(item, ['title', 'name'], option?.title ?? '拜访材料'),
      status: firstString(item, ['status'], 'ready'),
      cost: firstNumber(item, ['costPoints', 'cost', 'actionPointCost'], option?.cost ?? 0),
      minutes: firstNumber(item, ['timeMinutes', 'minutes', 'durationMinutes'], option?.minutes ?? 0),
      feedback: feedback ? {
        strengths: firstArray(feedback, ['strengths']).filter((entry): entry is string => typeof entry === 'string'),
        risks: firstArray(feedback, ['risks']).filter((entry): entry is string => typeof entry === 'string'),
        nextStep: firstString(feedback, ['nextStep']),
      } : undefined,
      brief: brief ? {
        audience: firstString(brief, ['audience']),
        problem: firstString(brief, ['problem']),
        dimensions: firstString(brief, ['dimensions']),
        evidence: firstString(brief, ['evidence']),
        nextStep: firstString(brief, ['nextStep']),
      } : undefined,
    };
  }).filter((item) => isCurrentPreparationType(item.type));
}

function getNotifications(state: GameRuntimeState | null): NotificationView[] {
  const root = asRecord(state);
  const simulation = simulationRecord(state);
  const nested = firstArray(simulation, ['notifications', 'inbox', 'messages']);
  const raw = nested.length > 0 ? nested : firstArray(root, ['notifications', 'inbox']);
  return raw.map((value, index) => {
    const item = asRecord(value);
    const readAt = firstString(item, ['readAt']);
    const notificationMinute = firstNumber(item, ['minute', 'minuteOfDay'], -1);
    const explicitLabel = firstString(item, ['createdLabel', 'timeLabel', 'createdAt']);
    return {
      id: firstString(item, ['id', 'notificationId'], `notification-${index}`),
      npcId: firstString(item, ['npcId', 'contactId']) || undefined,
      title: firstString(item, ['title', 'subject'], '新消息'),
      body: firstString(item, ['body', 'content', 'message'], '你收到一条新的项目消息。'),
      read: typeof item?.isRead === 'boolean' ? item.isRead : typeof item?.read === 'boolean' ? item.read : Boolean(readAt),
      createdLabel: explicitLabel || (notificationMinute >= 0 ? formatClock(notificationMinute) : undefined),
      target: firstString(item, ['targetId', 'target', 'entry']) || undefined,
    };
  });
}

function getMeetingMinutes(state: GameRuntimeState | null): MeetingMinutesView[] {
  const root = asRecord(state);
  const simulation = simulationRecord(state);
  const nested = firstArray(simulation, ['meetingMinutes', 'visitMinutes']);
  const raw = nested.length > 0 ? nested : firstArray(root, ['meetingMinutes', 'visitMinutes']);
  return raw.map((value, index) => {
    const item = asRecord(value);
    const rawType = firstString(item, ['visitType', 'meetingType'], 'formal');
    const visitType: MeetingMinutesView['visitType'] = rawType === 'short' || rawType === 'informal' ? rawType : 'formal';
    const stringItems = (keys: string[]) => firstArray(item, keys).filter((entry): entry is string => typeof entry === 'string');
    return {
      id: firstString(item, ['id', 'minutesId'], `meeting-minutes-${index}`),
      appointmentId: firstString(item, ['appointmentId']),
      npcId: firstString(item, ['npcId', 'contactId']),
      visitType,
      summary: firstString(item, ['summary'], '本次拜访已完成。'),
      confirmedItems: stringItems(['confirmedItems', 'confirmedFacts']),
      npcCommitments: stringItems(['npcCommitments', 'customerCommitments']),
      playerCommitments: stringItems(['playerCommitments', 'ourCommitments']),
      pendingMaterials: stringItems(['pendingMaterials', 'materialsToSend']),
      nextStep: firstString(item, ['nextStep'], '确认纪要并安排后续沟通'),
      nextStepRound: firstNumber(item, ['nextStepRound', 'nextRound'], state?.currentRound ?? 1),
      nextStepMinute: firstNumber(item, ['nextStepMinute', 'nextMinute'], 9 * 60),
      owner: firstString(item, ['owner'], '我方销售 / 客户联系人'),
      revisionCount: firstNumber(item, ['revisionCount'], 0),
    };
  });
}

function getActiveMeeting(state: GameRuntimeState | null, appointments: AppointmentView[]): ActiveMeetingView | null {
  const root = asRecord(state);
  const raw = firstRecord(root, ['activeMeeting', 'meeting']);
  if (!raw) return null;
  const appointmentId = firstString(raw, ['appointmentId']);
  const appointment = appointments.find((item) => item.id === appointmentId);
  const actionId = firstString(raw, ['actionId']);
  const legacyType = actionId === 'dinner' || actionId === 'tea' ? 'informal' : actionId ? 'formal' : undefined;
  const rawType = firstString(raw, ['visitType', 'type', 'meetingType'], appointment?.visitType ?? legacyType ?? 'formal');
  const visitType: ActiveMeetingView['visitType'] = rawType === 'short' || rawType === 'informal' ? rawType : 'formal';
  return {
    id: firstString(raw, ['id', 'meetingId'], 'active-meeting'),
    npcId: firstString(raw, ['npcId', 'contactId']),
    appointmentId: appointmentId || undefined,
    visitType,
    turnCount: firstNumber(raw, ['turnCount', 'currentTurn'], 0),
    maxTurns: firstNumber(raw, ['maxTurns'], VISIT_MAX_TURNS[visitType]),
    durationMinutes: firstNumber(raw, ['durationMinutes', 'duration'], VISIT_DURATIONS[visitType]),
    workTopicOpenedBy: firstString(raw, ['workTopicOpenedBy', 'topicOpenedBy']) || undefined,
    usedPreparationIds: firstArray(raw, ['usedPreparationIds']).filter((id): id is string => typeof id === 'string'),
    completedTasks: firstArray(raw, ['completedTasks']).map((value) => typeof value === 'string' ? value : firstString(asRecord(value), ['type', 'name'])).filter(Boolean),
    awaitingFinalReplyFrom: firstString(raw, ['awaitingFinalReplyFrom']) === 'player' ? 'player' : undefined,
  };
}

function getActivePhoneCall(state: GameRuntimeState | null): { npcId: string; startedRound: number; startedAt: string } | null {
  const raw = firstRecord(asRecord(state), ['activePhoneCall']);
  const npcId = firstString(raw, ['npcId']);
  if (!raw || !npcId) return null;
  return {
    npcId,
    startedRound: firstNumber(raw, ['startedRound'], state?.currentRound ?? 1),
    startedAt: firstString(raw, ['startedAt']),
  };
}

function makeCommandId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `command-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function commandResultMessage(type: string, value: unknown): string {
  const result = asRecord(value);
  if (typeof result?.message === 'string') return result.message;
  if (type === 'invite') {
    const appointment = firstRecord(result, ['appointment']);
    const status = firstString(appointment, ['status']);
    return status ? `邀约结果：${STATUS_LABELS[status] ?? status}` : '邀约已发送';
  }
  if (type === 'give_gift') {
    const disposition = firstString(result, ['disposition']);
    const labels: Record<string, string> = {
      delighted_acceptance: '对方愉快地收下了礼品。',
      cautious_acceptance: '对方谨慎收下了礼品，态度仍值得留意。',
      polite_decline: '对方婉拒了礼品。',
      firm_rejection: '对方明确拒绝了礼品。',
      reported: '对方拒绝并上报了本次送礼。',
    };
    return labels[disposition] ?? '礼品递交结果已记录';
  }
  if (type === 'prepare') return '准备工作已完成，材料已进入库存';
  if (type === 'start_visit') return '拜访已开始';
  if (type === 'end_visit') return '拜访已结束，记录已保存';
  if (type === 'end_phone_call') return '工作电话已挂断';
  if (type === 'follow_up') return '材料或跟进消息已送出';
  if (type === 'update_appointment') return '预约状态已更新';
  if (type === 'research_public_info') return '人物公开信息已整理';
  if (type === 'work_plan') return '工作计划已提交并记录';
  if (type === 'postal') return '邮寄材料已送出并记录';
  if (type === 'brief_visit') return '拜访方案评估已生成';
  return '操作已完成';
}

export default function GamePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#F5F7FB] flex items-center justify-center text-slate-500">正在进入项目...</div>}>
      <GameInner />
    </Suspense>
  );
}

function GameInner() {
  const params = useSearchParams();
  const router = useRouter();
  const location = params.get('location') || 'project-1';
  const requestedSessionId = params.get('sessionId') || '';
  const scene = SCENE_INFO[location] ?? SCENE_INFO['project-1'];
  const [messages, setMessages] = useState<Message[]>([]);
  const [gameSessionId, setGameSessionId] = useState('');
  const [gameState, setGameState] = useState<GameRuntimeState | null>(null);
  const [timerSync, setTimerSync] = useState<{ timer: ProjectTimerView; syncedAt: number } | null>(null);
  const [timerNow, setTimerNow] = useState(0);
  const [projectNotice, setProjectNotice] = useState<ProjectNoticeView | null>(null);
  const [showProjectNotice, setShowProjectNotice] = useState(false);
  const [competitorProfiles, setCompetitorProfiles] = useState<CompetitorProfile[]>([]);
  const [competitorProfilesKey, setCompetitorProfilesKey] = useState('');
  const [competitorLoadStatus, setCompetitorLoadStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [competitorLoadError, setCompetitorLoadError] = useState('');
  const [competitorRetry, setCompetitorRetry] = useState(0);
  const [showCompetitors, setShowCompetitors] = useState(false);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const competitorSessionRef = useRef('');
  const competitorProfilesLoadedRef = useRef(false);
  const [savePickerReady, setSavePickerReady] = useState(false);
  const [activeSaves, setActiveSaves] = useState<GameSaveView[]>([]);
  const [savePickerError, setSavePickerError] = useState('');
  const [loadingSave, setLoadingSave] = useState(false);
  const [npcs, setNpcs] = useState<NpcProfile[]>([]);
  const [designerImageAssets, setDesignerImageAssets] = useState<DesignerImageAssetMap>({});
  const [selectedNpc, setSelectedNpc] = useState<string | null>(null);
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('global_plan');
  const [communicationChannel, setCommunicationChannel] = useState<CommunicationChannel>('email');
  const [visitStep, setVisitStep] = useState<VisitStep>('intro');
  const [visitPreparationSkipped, setVisitPreparationSkipped] = useState(false);
  const [wechatRequestDraft, setWechatRequestDraft] = useState('');
  const [attachmentDescription, setAttachmentDescription] = useState('');
  const [expressionPanel, setExpressionPanel] = useState<'emoji' | 'sticker' | null>(null);
  const [visitExpressionOverride, setVisitExpressionOverride] = useState<Record<string, string>>({});
  const [phoneCallActive, setPhoneCallActive] = useState(false);
  const [phoneCallStartedAt, setPhoneCallStartedAt] = useState<number | null>(null);
  const [callHistory, setCallHistory] = useState<CallHistoryRecord[]>([]);
  const [callHistoryStatus, setCallHistoryStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [callHistoryRefreshKey, setCallHistoryRefreshKey] = useState(0);
  const [publicInfoNpcId, setPublicInfoNpcId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [commandBusy, setCommandBusy] = useState<string | null>(null);
  const [commandFeedback, setCommandFeedback] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const preparationType = 'visit_preparation' as const;
  const [preparationText, setPreparationText] = useState('');
  const [preparationAppointmentId, setPreparationAppointmentId] = useState('');
  const [globalPlanDraft, setGlobalPlanDraft] = useState('');
  const [npcPlanDraft, setNpcPlanDraft] = useState('');
  const [postalDraft, setPostalDraft] = useState('');
  const [postalAttachmentTitle, setPostalAttachmentTitle] = useState('');
  const [postalAttachmentContent, setPostalAttachmentContent] = useState('');
  const [visitBriefDraft, setVisitBriefDraft] = useState('');
  const [publicInfoRecord, setPublicInfoRecord] = useState<GamePublicResearchRecord | undefined>();
  const [invitationResult, setInvitationResult] = useState<InvitationResultView | null>(null);
  const [showSubmissionCheck, setShowSubmissionCheck] = useState(false);
  const [customerActivityRefreshKey, setCustomerActivityRefreshKey] = useState(0);
  const [showBidRuleProposal, setShowBidRuleProposal] = useState(false);
  const [proposalNpcId, setProposalNpcId] = useState('');
  const [proposalText, setProposalText] = useState('');
  const [minutesDraft, setMinutesDraft] = useState<MeetingMinutesDraft | null>(null);
  const restoredGlobalPlanSessionRef = useRef('');
  const restoredContactPlanKeyRef = useRef('');
  const latestGameStateRef = useRef<GameRuntimeState | null>(null);
  const streamingRef = useRef(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const channelMessagesRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const phoneCallEndedByUserRef = useRef(false);
  const typewriterTimerRef = useRef<number | null>(null);
  const typewriterQueueRef = useRef<string[]>([]);
  const commandBusyRef = useRef(false);
  const retryCommandRef = useRef<{ signature: string; commandId: string } | null>(null);
  const retryChatRef = useRef<{ signature: string; commandId: string } | null>(null);

  const refreshCustomerActivitiesAfter = (delayMs = 0) => window.setTimeout(() => {
    setCustomerActivityRefreshKey((current) => current + 1);
  }, delayMs);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/designer/image-assets', { cache: 'no-store' })
      .then(async (response) => response.ok ? response.json() : null)
      .then((data) => {
        if (cancelled || !Array.isArray(data?.assets)) return;
        const assets: DesignerImageAssetMap = {};
        for (const item of data.assets) {
          const asset = asRecord(item);
          const slotKey = firstString(asset, ['slotKey']);
          const imageUrl = firstString(asset, ['imageUrl']);
          if (slotKey && imageUrl) assets[slotKey] = imageUrl;
        }
        setDesignerImageAssets(assets);
      })
      .catch(() => {
        // Local character portraits and the local visit scene remain available if designer assets are offline.
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch('/project-one-notice.json', { cache: 'no-store' })
      .then(async (response) => response.ok ? response.json() : null)
      .then((data) => {
        if (cancelled || !data || typeof data.title !== 'string' || !Array.isArray(data.sections)) return;
        const sections = data.sections.flatMap((value: unknown) => {
          const item = asRecord(value);
          const heading = firstString(item, ['heading']);
          const content = firstArray(item, ['content']).filter((line): line is string => typeof line === 'string');
          return heading ? [{ heading, content }] : [];
        });
        setProjectNotice({
          title: data.title,
          summary: typeof data.summary === 'string' ? data.summary : scene.description,
          budget: typeof data.budget === 'string' || typeof data.budget === 'number' ? data.budget : `${scene.budget} 万元`,
          sections,
        });
      })
      .catch(() => {
        // The project summary remains available from the selected scenario when the notice file cannot load.
      });
    return () => { cancelled = true; };
  }, [scene.budget, scene.description]);

  const projectId = location.replace('project-', '');
  useEffect(() => {
    const sessionKey = `${gameSessionId}:${projectId}`;
    if (competitorSessionRef.current !== sessionKey) {
      competitorSessionRef.current = sessionKey;
      competitorProfilesLoadedRef.current = false;
      setCompetitorProfiles([]);
      setCompetitorProfilesKey('');
      setSelectedCompanyId(null);
      setCompetitorLoadError('');
    }
    if (!gameSessionId) {
      setCompetitorProfiles([]);
      setCompetitorProfilesKey('');
      setSelectedCompanyId(null);
      setCompetitorLoadStatus('idle');
      setCompetitorLoadError('');
      return;
    }

    let cancelled = false;
    let requestInFlight = false;
    let controller: AbortController | null = null;
    const loadProfiles = async () => {
      if (cancelled || requestInFlight) return;
      requestInFlight = true;
      controller?.abort();
      controller = new AbortController();
      const requestToken = localStorage.getItem('weixun_session') || '';
      if (!competitorProfilesLoadedRef.current) setCompetitorLoadStatus('loading');
      try {
        const response = await fetch(`/api/game-data/competitor-profiles?project_id=${encodeURIComponent(projectId)}`, {
          cache: 'no-store',
          headers: { 'x-session': requestToken },
          signal: controller.signal,
        });
        const result = await response.json().catch(() => null) as { success?: unknown; data?: unknown; error?: unknown } | null;
        if (cancelled) return;
        if ((localStorage.getItem('weixun_session') || '') !== requestToken) {
          competitorProfilesLoadedRef.current = false;
          setCompetitorProfiles([]);
          setCompetitorProfilesKey('');
          setSelectedCompanyId(null);
          setCompetitorLoadStatus('error');
          setCompetitorLoadError('登录状态已变化，请重试后查看竞争对手资料。');
          return;
        }
        if (!response.ok || result?.success !== true || !Array.isArray(result.data)) {
          const message = typeof result?.error === 'string' ? result.error : '暂时无法读取竞争对手资料';
          throw new Error(message);
        }
        const profiles = result.data.filter((item): item is CompetitorProfile => {
          if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
          const profile = item as Record<string, unknown>;
          return typeof profile.project_id === 'number'
            && ['id', 'company_name', 'features', 'more_info', 'industry', 'solution_summary', 'representative_experience', 'service_support']
              .every((key) => typeof profile[key] === 'string');
        }).filter((profile) => profile.project_id === Number(projectId))
          .filter((profile) => !isLegacyCompetitorPlaceholder(profile));
        if (cancelled) return;
        setCompetitorProfiles(profiles);
        setCompetitorProfilesKey(sessionKey);
        competitorProfilesLoadedRef.current = true;
        setCompetitorLoadStatus('ready');
        setCompetitorLoadError('');
        setSelectedCompanyId((current) => current && profiles.some((profile) => profile.id === current) ? current : null);
      } catch (error) {
        if (cancelled || (error instanceof DOMException && error.name === 'AbortError')) return;
        if ((localStorage.getItem('weixun_session') || '') !== requestToken) {
          competitorProfilesLoadedRef.current = false;
          setCompetitorProfiles([]);
          setCompetitorProfilesKey('');
          setSelectedCompanyId(null);
          setCompetitorLoadStatus('error');
          setCompetitorLoadError('登录状态已变化，请重试后查看竞争对手资料。');
          return;
        }
        setCompetitorLoadStatus('error');
        setCompetitorLoadError(error instanceof Error ? error.message : '暂时无法读取竞争对手资料');
      } finally {
        requestInFlight = false;
      }
    };

    void loadProfiles();
    const refreshInterval = window.setInterval(() => void loadProfiles(), 30_000);
    const onFocus = () => void loadProfiles();
    const onVisibility = () => { if (document.visibilityState === 'visible') void loadProfiles(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      controller?.abort();
      window.clearInterval(refreshInterval);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [gameSessionId, projectId, competitorRetry]);

  const currentCompetitorKey = `${gameSessionId}:${projectId}`;
  const visibleCompetitorProfiles = competitorProfilesKey === currentCompetitorKey ? competitorProfiles : [];
  const selectedCompany = visibleCompetitorProfiles.find((profile) => profile.id === selectedCompanyId) ?? null;
  useEffect(() => {
    if (!showCompetitors) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowCompetitors(false);
        setSelectedCompanyId(null);
      }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [showCompetitors]);

  useEffect(() => {
    setTimerNow(Date.now());
    const interval = window.setInterval(() => setTimerNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const projectTimer = readProjectTimer(gameState) ?? timerSync?.timer ?? null;
  const timerSyncedAt = timerSync?.syncedAt ?? timerNow;
  const timerSyncTimestamp = timerSync?.syncedAt ?? 0;
  const localTimerElapsed = projectTimer?.isPaused ? 0 : Math.max(0, timerNow - timerSyncedAt);
  const remainingAtSync = projectTimer ? timerRemainingAtServerProjection(projectTimer) : 1_200_000;
  const remainingGameTime = Math.max(0, remainingAtSync - localTimerElapsed);
  const coins = gameState?.actionPoints ?? 0;
  const appointments = getAppointments(gameState);
  const preparations = getPreparations(gameState);
  const notifications = getNotifications(gameState);
  const meetingMinutes = getMeetingMinutes(gameState);
  const workPlans = gameState?.workPlans ?? [];
  const postalRecords = gameState?.postalRecords ?? [];
  const visitBriefs = gameState?.visitBriefs ?? [];
  const activeMeeting = getActiveMeeting(gameState, appointments);
  const activePhoneCall = getActivePhoneCall(gameState);
  const phoneCallIsActive = phoneCallActive || Boolean(activePhoneCall);
  const npcExpressions = firstRecord(asRecord(gameState), ['npcExpressions']);
  const npcExpressionFor = (npcId: string) => {
    const saved = firstString(npcExpressions, [npcId]);
    if (NPC_EXPRESSIONS.has(saved)) return saved;
    const recent = visitExpressionOverride[npcId];
    return recent && NPC_EXPRESSIONS.has(recent) ? recent : 'calm';
  };
  const publicInfoItems = (npcId: string) => {
    const researched = gameState?.publicResearch?.[npcId];
    const disclosed = (gameState?.workPlans ?? []).flatMap((plan) => (plan.disclosures ?? [])
      .filter((item) => item.npcId === npcId)
      .flatMap((item) => [...item.facts, ...item.clues]));
    return [...new Set([...(researched?.facts ?? []), ...(researched?.weakSignals ?? []), ...disclosed])];
  };
  const contactStatus = (npcId: string) => {
    if (activeMeeting?.npcId === npcId) return '正在拜访';
    if (appointments.some((item) => item.npcId === npcId && item.status === 'completed')) return '已完成拜访';
    if (appointments.some((item) => item.npcId === npcId && ['pending', 'accepted', 'countered'].includes(item.status))) return '已有拜访预约';
    const status = gameState?.npcContacts?.[npcId]?.status;
    if (status === 'online') return '工作微信已添加';
    if (status && status !== 'known') return '已建立接触';
    return '尚未有效接触';
  };
  const peopleByLevel = {
    senior: npcs.filter((npc) => npc.category === '高层'),
    middle: npcs.filter((npc) => npc.category === '中层'),
    frontline: npcs.filter((npc) => npc.category === '一线'),
  };
  const organizationRows = peopleByLevel.senior.length + peopleByLevel.middle.length + peopleByLevel.frontline.length === npcs.length
    && peopleByLevel.senior.length === 1 && peopleByLevel.middle.length === 2 && peopleByLevel.frontline.length === 2
    ? [peopleByLevel.senior, peopleByLevel.middle, peopleByLevel.frontline]
    : [npcs.slice(0, 1), npcs.slice(1, 3), npcs.slice(3)];
  const hasContacted = (npcId: string) => {
    const root = asRecord(gameState);
    const contactedIds = firstArray(root, ['contactedNpcIds', 'metNpcIds']);
    return gameState?.npcContacts?.[npcId]?.status !== 'known' || contactedIds.includes(npcId) || activeMeeting?.npcId === npcId;
  };
  const visibleChannelMessages = messages.filter((message) => message.channel === (activeMeeting ? 'offline' : communicationChannel));
  const phoneCallStartedAtMs = phoneCallStartedAt ?? (activePhoneCall?.npcId === selectedNpc ? Date.parse(activePhoneCall.startedAt) : Number.NaN);
  const currentPhoneMessages = !Number.isFinite(phoneCallStartedAtMs)
    ? []
    : messages.filter((message) => message.channel === 'work_phone'
      && message.ts >= phoneCallStartedAtMs
      && message.content !== '[电话呼出]');
  const offlineMessages = messages.filter((message) => message.channel === 'offline');
  const latestNpcMeetingMessage = [...offlineMessages].reverse().find((message) => message.role === 'assistant');
  const latestPlayerMeetingMessage = [...offlineMessages].reverse().find((message) => message.role === 'user');
  const selectedProfile = npcs.find((npc) => npc.id === selectedNpc) ?? null;
  const selectedContact = selectedNpc ? gameState?.npcContacts?.[selectedNpc] : undefined;
  const selectedAppointments = appointments.filter((item) => item.npcId === selectedNpc);
  const selectedPreparations = preparations.filter((item) => item.npcId === selectedNpc || (item.appointmentId && selectedAppointments.some((appointment) => appointment.id === item.appointmentId)));
  const selectedMinutes = meetingMinutes.filter((item) => item.npcId === selectedNpc);
  const nextAppointment = appointments
    .filter((item) => ['accepted', 'countered', 'pending'].includes(item.status))
    .sort((a, b) => a.scheduledMinute - b.scheduledMinute)[0];
  useEffect(() => {
    if (!gameSessionId || !gameState || restoredGlobalPlanSessionRef.current === gameSessionId) return;
    const saved = [...(gameState.workPlans ?? [])].reverse().find((plan) => plan.scope === 'global');
    if (saved) setGlobalPlanDraft(saved.content);
    restoredGlobalPlanSessionRef.current = gameSessionId;
  }, [gameSessionId, gameState]);
  useEffect(() => {
    if (!gameSessionId || !gameState || !selectedNpc) return;
    const key = `${gameSessionId}:${selectedNpc}`;
    if (restoredContactPlanKeyRef.current === key) return;
    const saved = [...(gameState.workPlans ?? [])].reverse().find((plan) => plan.scope === 'npc' && plan.npcId === selectedNpc);
    setNpcPlanDraft(saved?.content ?? '');
    restoredContactPlanKeyRef.current = key;
  }, [gameSessionId, gameState, selectedNpc]);
  const proposalNpcOptions = activeMeeting
    ? npcs.filter((npc) => npc.id === activeMeeting.npcId)
    : npcs.filter((npc) => hasContacted(npc.id));
  const submissionWarnings = [
    !gameState?.unlockedClues?.includes('decision_process') ? '尚未核实完整决策链' : '',
    meetingMinutes.length === 0 ? '尚未完成任何线下拜访' : '',
    gameState?.complianceRisks?.some((risk) => risk.status === 'latent' || risk.status === 'triggered') ? '存在未消除的合规风险' : '',
  ].filter(Boolean);

  const applyServerState = (nextState: GameRuntimeState) => {
    latestGameStateRef.current = nextState;
    setGameState(nextState);
    const timer = readProjectTimer(nextState);
    if (timer) setTimerSync({ timer, syncedAt: Date.now() });
  };

  useEffect(() => {
    if (!gameSessionId || gameState?.status !== 'playing') return;
    let cancelled = false;
    let requestInFlight = false;
    const syncTimer = async () => {
      if (cancelled || requestInFlight || commandBusyRef.current || streaming) return;
      requestInFlight = true;
      try {
        const response = await fetch(`/api/game/sessions/${gameSessionId}/timer`, {
          method: 'POST',
          headers: { 'x-session': localStorage.getItem('weixun_session') || '' },
        });
        const data = await response.json().catch(() => null);
        const state = data?.state as GameRuntimeState | undefined;
        if (cancelled || !response.ok || !state) return;
        const latestState = latestGameStateRef.current;
        if (commandBusyRef.current || streamingRef.current || (latestState && state.version < latestState.version)) return;
        latestGameStateRef.current = state;
        setGameState(state);
        const timer = readProjectTimer(state);
        if (timer) setTimerSync({ timer, syncedAt: Date.now() });
        if (state.status !== 'playing') router.push(`/result?sessionId=${gameSessionId}`);
      } catch {
        // The local countdown keeps displaying its last server projection; the next sync retries.
      } finally {
        requestInFlight = false;
      }
    };
    const interval = window.setInterval(() => void syncTimer(), 5000);
    const remainingAtEffect = projectTimer?.isPaused
      ? null
      : Math.max(0, remainingAtSync - (timerSyncTimestamp ? Date.now() - timerSyncTimestamp : 0));
    const expiry = remainingAtEffect === null ? null : window.setTimeout(() => void syncTimer(), remainingAtEffect + 40);
    const onVisible = () => { if (document.visibilityState === 'visible') void syncTimer(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      if (expiry !== null) window.clearTimeout(expiry);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [gameSessionId, gameState?.status, streaming, commandBusy, projectTimer?.isPaused, remainingAtSync, timerSyncTimestamp, router]);

  useEffect(() => {
    let cancelled = false;
    const token = localStorage.getItem('weixun_session') || '';
    const headers = { 'Content-Type': 'application/json', 'x-session': token };
    const storageKey = `game-session:${location}`;
    const projectId = location.replace('project-', '');

    const bootstrap = async () => {
      if (requestedSessionId) {
        await openSave(requestedSessionId, true);
        return;
      }
      const saveResponse = await fetch(`/api/game/sessions?scenarioCode=${encodeURIComponent(location)}`, { headers });
      const saveData = await saveResponse.json().catch(() => null);
      if (!saveResponse.ok) throw new Error(saveData?.error || '存档列表加载失败');
      if (!cancelled) {
        setActiveSaves(Array.isArray(saveData?.saves) ? saveData.saves : []);
        setSavePickerReady(true);
      }
      return;
      let id = localStorage.getItem(storageKey) || '';
      let restored: { id: string; state: GameRuntimeState } | null = null;
      if (id) {
        const response = await fetch(`/api/game/sessions/${id}`, { headers });
        if (response.ok) restored = (await response.json()).gameSession;
        else {
          localStorage.removeItem(storageKey);
          id = '';
        }
      }
      if (!id) {
        const response = await fetch('/api/game/sessions', { method: 'POST', headers, body: JSON.stringify({ scenarioCode: location }) });
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(data?.error || '对局创建失败');
        restored = data.gameSession;
        id = restored?.id || '';
        localStorage.setItem(storageKey, id);
      }
      if (!restored || cancelled) return;
      setGameSessionId(restored!.id);
      applyServerState(restored!.state);
      const npcResponse = await fetch(`/api/game-data/npcs?project_id=${projectId}&game_session_id=${restored!.id}`, { headers });
      if (!npcResponse.ok) throw new Error('NPC加载失败');
      const npcData = await npcResponse.json();
      const loaded: NpcProfile[] = Array.isArray(npcData.data) ? npcData.data : [];
      if (cancelled) return;
      setNpcs(loaded);
      const activePhoneCall = getActivePhoneCall(restored!.state);
      const resumedNpcId = restored!.state.activeMeeting?.npcId ?? activePhoneCall?.npcId ?? null;
      setSelectedNpc(resumedNpcId);
      setWorkspaceMode(restored!.state.activeMeeting?.npcId || activePhoneCall ? 'conversation' : 'global_plan');
      setCommunicationChannel(getActivePhoneCall(restored!.state)?.npcId ? 'work_phone' : 'email');
    };

    bootstrap().catch((error) => {
      if (cancelled) return;
      const code = error instanceof Error ? error.message : '对局初始化失败';
      setSavePickerError(code === 'SAVE_LIST_UNAVAILABLE'
        ? '数据库暂时无法连接，当前存档尚未加载。请检查网络或 Supabase 配置后重试。'
        : code);
      setSavePickerReady(true);
    });
    return () => { cancelled = true; };
  }, [location]);

  useEffect(() => {
    if (!gameSessionId || !selectedNpc) return;
    fetch(`/api/game/sessions/${gameSessionId}/messages?npcId=${encodeURIComponent(selectedNpc)}`, {
      headers: { 'x-session': localStorage.getItem('weixun_session') || '' },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('对话历史加载失败');
        return response.json();
      })
      .then((data) => {
        const restored: Message[] = (data.messages || []).map((message: { role: Message['role']; content: string; createdAt: string; metadata?: Record<string, unknown> }) => ({
          role: message.role,
          content: message.content,
          ts: new Date(message.createdAt).getTime(),
          deliveryStatus: message.metadata?.deliveryStatus as Message['deliveryStatus'],
          readStatus: message.metadata?.readStatus === 'read' ? 'read' : message.metadata?.readStatus === 'unread' ? 'unread' : undefined,
          channel: message.metadata?.channel as Message['channel'],
          attachments: Array.isArray(message.metadata?.attachments)
            ? message.metadata.attachments.filter((item): item is ChatAttachmentView => Boolean(item) && typeof item === 'object' && typeof (item as Record<string, unknown>).fileName === 'string' && typeof (item as Record<string, unknown>).description === 'string')
            : undefined,
          emailAttachments: Array.isArray(message.metadata?.emailAttachments)
            ? message.metadata.emailAttachments.filter((item): item is EmailAttachmentDraft => Boolean(item) && typeof item === 'object' && typeof (item as Record<string, unknown>).fileName === 'string' && typeof (item as Record<string, unknown>).description === 'string')
            : undefined,
        }));
        setMessages(restored);
      })
      .catch((error) => console.error(error));
  }, [gameSessionId, selectedNpc]);

  useEffect(() => {
    if (!gameSessionId || !selectedNpc) {
      setCallHistory([]);
      setCallHistoryStatus('idle');
      return;
    }
    let cancelled = false;
    setCallHistory([]);
    setCallHistoryStatus('loading');
    fetch(`/api/game/sessions/${gameSessionId}/call-history?npcId=${encodeURIComponent(selectedNpc)}`, {
      headers: { 'x-session': localStorage.getItem('weixun_session') || '' },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('通话记录加载失败');
        return response.json();
      })
      .then((data) => {
        if (cancelled || !Array.isArray(data?.calls)) return;
        const records = data.calls.flatMap((value: unknown): CallHistoryRecord[] => {
          const item = asRecord(value);
          const id = firstString(item, ['id']);
          const npcId = firstString(item, ['npcId']);
          const outcome = firstString(item, ['outcome']);
          const round = firstNumber(item, ['round']);
          const createdAt = firstString(item, ['createdAt']);
          if (!id || !npcId || !createdAt || !['connected', 'unanswered', 'declined', 'call_later'].includes(outcome)) return [];
          return [{ id, npcId, outcome: outcome as CallHistoryRecord['outcome'], round, createdAt }];
        });
        setCallHistory(records);
        setCallHistoryStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setCallHistoryStatus('error');
      });
    return () => { cancelled = true; };
  }, [gameSessionId, selectedNpc, callHistoryRefreshKey]);

  useEffect(() => {
    setAttachmentDescription('');
    setExpressionPanel(null);
    setWechatRequestDraft('');
  }, [selectedNpc]);

  useEffect(() => {
    setPhoneCallActive(false);
    setPhoneCallStartedAt(null);
    setInput('');
  }, [gameSessionId, selectedNpc]);

  useEffect(() => {
    if (workspaceMode === 'conversation' || !phoneCallActive) return;
    phoneCallEndedByUserRef.current = true;
    abortRef.current?.abort();
    setPhoneCallActive(false);
    setPhoneCallStartedAt(null);
    setInput('');
  }, [workspaceMode, phoneCallActive]);

  useEffect(() => {
    const container = channelMessagesRef.current;
    if (!container || workspaceMode !== 'conversation') return;
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
  }, [messages, workspaceMode]);

  useEffect(() => {
    setVisitExpressionOverride({});
  }, [gameSessionId]);

  useEffect(() => () => {
    abortRef.current?.abort();
    if (typewriterTimerRef.current !== null) window.clearInterval(typewriterTimerRef.current);
    typewriterQueueRef.current = [];
  }, []);

  const openSave = async (sessionId: string, trackContinue = false) => {
    setLoadingSave(true);
    setSavePickerError('');
    try {
      const headers = { 'Content-Type': 'application/json', 'x-session': localStorage.getItem('weixun_session') || '' };
      const response = await fetch(`/api/game/sessions/${sessionId}${trackContinue ? '?entry=continue' : ''}`, { headers });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.gameSession) throw new Error(data?.error || '存档读取失败');
      const restored = data.gameSession as { id: string; state: GameRuntimeState };
      if (restored.state.status !== 'playing') {
        router.push(`/result?sessionId=${sessionId}`);
        return;
      }
      const projectId = location.replace('project-', '');
      const npcResponse = await fetch(`/api/game-data/npcs?project_id=${projectId}&game_session_id=${restored.id}`, { headers });
      if (!npcResponse.ok) throw new Error('NPC 加载失败');
      const npcData = await npcResponse.json();
      const loaded: NpcProfile[] = Array.isArray(npcData.data) ? npcData.data : [];
      localStorage.setItem(`game-session:${location}`, restored.id);
      setGameSessionId(restored.id);
      applyServerState(restored.state);
      setNpcs(loaded);
      const activePhoneCall = getActivePhoneCall(restored.state);
      const resumedNpcId = restored.state.activeMeeting?.npcId ?? activePhoneCall?.npcId ?? null;
      setSelectedNpc(resumedNpcId);
      setWorkspaceMode(restored.state.activeMeeting?.npcId || activePhoneCall ? 'conversation' : 'global_plan');
      setCommunicationChannel(getActivePhoneCall(restored.state)?.npcId ? 'work_phone' : 'email');
    } catch (error) {
      setSavePickerError(error instanceof Error ? error.message : '存档读取失败');
    } finally {
      setLoadingSave(false);
    }
  };

  const startNewGame = async () => {
    const replacing = activeSaves.length > 0;
    if (replacing && !window.confirm('开始新游戏会永久覆盖当前进度，原存档无法恢复。确定继续吗？')) return;
    setLoadingSave(true);
    setSavePickerError('');
    try {
      const headers = { 'Content-Type': 'application/json', 'x-session': localStorage.getItem('weixun_session') || '' };
      const response = await fetch('/api/game/sessions', {
        method: 'POST',
        headers,
        body: JSON.stringify({ scenarioCode: location, replaceExisting: replacing }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.gameSession) throw new Error(
        data?.error === 'SAVE_REPLACE_FAILED'
          ? '新存档创建失败，原存档已保留，请稍后重试'
          : data?.error === 'SAVE_LIMIT_REACHED'
            ? '已有进行中的对局，请确认覆盖后重试'
            : data?.error || '新游戏创建失败',
      );
      await openSave(data.gameSession.id);
    } catch (error) {
      setSavePickerError(error instanceof Error ? error.message : '新游戏创建失败');
      setLoadingSave(false);
    }
  };

  const runCommand = async (type: string, payload: Record<string, unknown> = {}) => {
    if (!gameSessionId || !gameState || commandBusyRef.current || streaming) return false;
    if (type === 'submit' && phoneCallIsActive) {
      setCommandFeedback('请先挂断当前工作电话，再提交项目。');
      return false;
    }
    commandBusyRef.current = true;
    setCommandBusy(type);
    setCommandFeedback('');
    const signature = `${type}:${JSON.stringify(payload)}`;
    const commandId = retryCommandRef.current?.signature === signature ? retryCommandRef.current.commandId : makeCommandId();
    retryCommandRef.current = { signature, commandId };
    try {
      const response = await fetch(`/api/game/sessions/${gameSessionId}/commands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-session': localStorage.getItem('weixun_session') || '' },
        body: JSON.stringify({ commandId, expectedVersion: gameState.version, type, payload }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        if (data?.error === 'STATE_VERSION_CONFLICT' && data?.state) {
          applyServerState(data.state as GameRuntimeState);
          setCommandFeedback('房间状态已同步，请确认后重试刚才的操作。');
          return false;
        }
        throw new Error(data?.error || '操作失败，请稍后重试');
      }
      const nextState = data?.state ?? data?.gameSession?.state;
      if (nextState) applyServerState(nextState);
      retryCommandRef.current = null;
      if (type === 'propose_bid_rule') {
        // The outcome is intentionally not shown here; the NPC can disclose it in conversation.
        setShowBidRuleProposal(false);
        setProposalText('');
        setCommandFeedback('已将你的想法传达给客户。');
      } else if (type === 'request_wechat') {
        const status = firstString(asRecord(data?.result), ['status']);
        const statusLabels: Record<string, string> = {
          accepted: '客户接受了工作微信申请，现在可以开始微信沟通。',
          pending: '工作微信申请已送达，等待客户确认。',
          later: '客户表示稍后再处理工作微信申请。',
          rejected: '客户暂不接受工作微信申请。',
        };
        setCommandFeedback(statusLabels[status] ?? commandResultMessage(type, data?.result));
        if (status === 'accepted') {
          setCommunicationChannel('online');
          setWorkspaceMode('conversation');
          setWechatRequestDraft('');
        }
      } else {
        setCommandFeedback(commandResultMessage(type, data?.result));
      }
      if (type === 'end_visit') setWorkspaceMode('overview');
      if (type === 'end_phone_call') {
        setPhoneCallActive(false);
        setPhoneCallStartedAt(null);
        setCallHistoryRefreshKey((current) => current + 1);
      }
      if (type === 'end_visit') refreshCustomerActivitiesAfter(700);
      if (type === 'end_phone_call') refreshCustomerActivitiesAfter();
      if (type === 'invite' && nextState) {
        const result = asRecord(data?.result);
        const appointmentId = firstString(firstRecord(result, ['appointment']), ['id', 'appointmentId']);
        const appointment = getAppointments(nextState).find((item) => item.id === appointmentId);
        if (appointment && selectedProfile) {
          const feedback = [...getNotifications(nextState)].reverse().find((item) => item.npcId === selectedProfile.id)?.body
            ?? commandResultMessage(type, data?.result);
          setInvitationResult({ appointment, npcName: selectedProfile.name, feedback });
        }
      }
      if (type === 'research_public_info') {
        const record = firstRecord(asRecord(data?.result), ['publicResearch']);
        if (record) setPublicInfoRecord(record as unknown as GamePublicResearchRecord);
      }
      if (nextState?.status && nextState.status !== 'playing') router.push(`/result?sessionId=${gameSessionId}`);
      return true;
    } catch (error) {
      if (type === 'propose_bid_rule') {
        // Keep the player's text available for editing without surfacing internal decision state.
        const code = error instanceof Error ? error.message : '';
        const message = code === 'PROPOSAL_DIRECTION_UNCLEAR'
          ? '请换种说法，具体说明你希望客户关注的项目要求。'
          : code === 'NPC_RULE_AUTHORITY_REQUIRED'
            ? '对方暂时不便继续讨论这个话题，可在后续交流中再沟通。'
            : code === 'RULE_PROPOSAL_ALREADY_MADE'
              ? '你已经和这位联系人沟通过类似的项目想法。'
              : '这次沟通未能继续，请稍后再试。';
        alert(message);
        return false;
      }
      const code = error instanceof Error ? error.message : '';
      const userMessage: Record<string, string> = {
        WORK_PLAN_NEEDS_DETAIL: '计划描述过于简单，请补充目标、证据或下一步。',
        PREPARATION_NEEDS_DETAIL: '拜访准备还不够具体，请补充对象、问题、证据和下一步。',
        VISIT_PREPARATION_REQUIRED: '请先完成拜访准备，或明确选择跳过准备。',
        PHONE_CALL_NOT_ACTIVE: '请先拨打并接通工作电话。',
        PHONE_CALL_ACTIVE: '请先结束当前通话，再切换联系人或沟通方式。',
      };
      const fallbackMessage = /^[A-Z0-9_]+$/.test(code) ? '操作暂时未能完成，请稍后重试。' : code || '操作失败';
      alert(userMessage[code] ?? fallbackMessage);
      return false;
    } finally {
      commandBusyRef.current = false;
      setCommandBusy(null);
    }
  };

  const endPhoneCall = async () => {
    const activeCall = getActivePhoneCall(gameState);
    if (!activeCall) {
      setPhoneCallActive(false);
      setPhoneCallStartedAt(null);
      return true;
    }
    const ended = await runCommand('end_phone_call', { npcId: activeCall.npcId });
    if (ended) {
      setPhoneCallActive(false);
      setPhoneCallStartedAt(null);
    }
    return ended;
  };

  const sendMessage = async (
    content: string,
    communication?: { intent?: 'outreach' | 'message' | 'call_connect'; channel?: Message['channel']; hidePlayerMessage?: boolean },
  ) => {
    if (!content.trim() || streaming || !selectedNpc || !gameSessionId || !gameState) return;
    const contact = gameState.npcContacts?.[selectedNpc];
    const intent = communication?.intent ?? (contact?.status === 'known' ? 'outreach' : 'message');
    const channel: Message['channel'] = communication?.channel ?? (activeMeeting?.npcId === selectedNpc
      ? 'offline'
      : communicationChannel);
    const canAttach = channel === 'email' || channel === 'online';
    const attachmentText = attachmentDescription.trim();
    const outgoingAttachments = canAttach && attachmentText
      ? [{ fileName: channel === 'email' ? '邮件附件说明' : '微信附件说明', description: attachmentText }]
      : [];
    const chatSignature = `${selectedNpc}:${intent}:${channel}:${gameState.version}:${content.trim()}:${JSON.stringify(outgoingAttachments)}`;
    const chatCommandId = retryChatRef.current?.signature === chatSignature
      ? retryChatRef.current.commandId
      : makeCommandId();
    retryChatRef.current = { signature: chatSignature, commandId: chatCommandId };
    const userMessage: Message = { role: 'user', content: content.trim(), ts: Date.now(), deliveryStatus: 'sent', channel, attachments: outgoingAttachments };
    // The scene renderer filters on channel. Preserve it on the optimistic
    // NPC placeholder so a successful face-to-face reply is visible directly,
    // not only after reloading the persisted conversation history.
    const assistantMessage: Message = { role: 'assistant', content: '', ts: Date.now() + 1, channel };
    setMessages((current) => communication?.hidePlayerMessage ? [...current, assistantMessage] : [...current, userMessage, assistantMessage]);
    setInput('');
    streamingRef.current = true;
    setStreaming(true);
    abortRef.current = new AbortController();
    typewriterQueueRef.current = [];
    if (typewriterTimerRef.current !== null) window.clearInterval(typewriterTimerRef.current);
    let networkComplete = false;
    let turnCommitted = false;
    let shouldRefreshCustomerActivities = false;
    let activityRefreshScheduled = false;
    const finishIfReady = () => {
      if (!networkComplete || typewriterQueueRef.current.length > 0) return;
      if (typewriterTimerRef.current !== null) window.clearInterval(typewriterTimerRef.current);
      typewriterTimerRef.current = null;
      streamingRef.current = false;
      setStreaming(false);
      if (turnCommitted && shouldRefreshCustomerActivities && !activityRefreshScheduled) {
        activityRefreshScheduled = true;
        refreshCustomerActivitiesAfter(700);
      }
    };
    typewriterTimerRef.current = window.setInterval(() => {
      const backlog = typewriterQueueRef.current.length;
      if (!backlog) return finishIfReady();
      const visible = typewriterQueueRef.current.splice(0, backlog > 120 ? 3 : backlog > 60 ? 2 : 1).join('');
      setMessages((current) => current.map((item) => item.ts === assistantMessage.ts ? { ...item, content: item.content + visible } : item));
    }, 30);

    try {
      const deliveredPreparationIds = Array.from(new Set([
        ...selectedPreparations.filter((item) => item.status === 'delivered' || item.status === 'used').map((item) => item.id),
        ...(activeMeeting?.usedPreparationIds ?? []),
      ]));
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-session': localStorage.getItem('weixun_session') || '' },
        body: JSON.stringify({
          gameSessionId,
          scenarioId: location,
          npcId: selectedNpc,
          message: userMessage.content,
          intent,
          channel,
          commandId: chatCommandId,
          expectedVersion: gameState.version,
          contextType: activeMeeting ? `${activeMeeting.visitType}_visit` : 'online',
          appointmentId: activeMeeting?.appointmentId,
          attachments: outgoingAttachments,
          usedPreparationIds: deliveredPreparationIds,
        }),
        signal: abortRef.current.signal,
      });
      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => null) as { error?: string; details?: unknown } | null;
        throw new Error(body?.error || `对话请求失败（HTTP ${response.status}）`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let received = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (raw === '[DONE]') {
            networkComplete = true;
            finishIfReady();
            continue;
          }
          try {
            const event = JSON.parse(raw);
            if (typeof event.content === 'string' && event.content) {
              received += event.content;
              const contentChunk = event.content as string;
              typewriterQueueRef.current.push(...Array.from(contentChunk));
            }
              if (event.type === 'result' && event.state) {
              applyServerState(event.state);
              retryChatRef.current = null;
              turnCommitted = true;
              if (channel === 'email' || event.responseAction === 'final_player_reply') shouldRefreshCustomerActivities = true;
                if (typeof event.npcExpression === 'string' && NPC_EXPRESSIONS.has(event.npcExpression)) {
                  setVisitExpressionOverride((current) => ({ ...current, [selectedNpc]: event.npcExpression }));
                }
                const readNoReply = event.responseAction === 'read_no_reply' || event.deliveryStatus === 'read_no_reply';
                const finalPlayerReply = event.responseAction === 'final_player_reply';
                if (readNoReply || finalPlayerReply || event.deliveryStatus === 'unanswered') {
                  typewriterQueueRef.current = [];
                  setMessages((current) => current
                    .filter((item) => item.ts !== assistantMessage.ts)
                    .map((item) => (readNoReply || event.deliveryStatus === 'unanswered') && item.ts === userMessage.ts
                      ? { ...item, deliveryStatus: 'unanswered', readStatus: event.readStatus === 'read' || readNoReply ? 'read' : 'unread' }
                      : item));
                }
              if (intent === 'call_connect') {
                setCallHistoryRefreshKey((current) => current + 1);
                if (event.callConnected === false) {
                  setPhoneCallActive(false);
                  setPhoneCallStartedAt(null);
                  setInput('');
                }
              }
                if (event.deliveryStatus === 'replied' && !readNoReply && !finalPlayerReply) {
                setMessages((current) => current.map((item) => item.ts === userMessage.ts ? { ...item, deliveryStatus: 'replied' } : item));
                }
                if (finalPlayerReply && !getActiveMeeting(event.state as GameRuntimeState, getAppointments(event.state as GameRuntimeState))) {
                  setWorkspaceMode('overview');
                  setInput('');
                }
              if (Array.isArray(event.attachments)) {
                const returnedAttachments = event.attachments.filter((item: unknown): item is ChatAttachmentView => {
                  const attachment = asRecord(item);
                  return Boolean(attachment && typeof attachment.fileName === 'string' && typeof attachment.description === 'string');
                });
                setMessages((current) => current.map((item) => item.ts === userMessage.ts ? { ...item, attachments: returnedAttachments } : item));
              }
              if (event.invitation === true) {
                const appointmentRecord = asRecord(event.appointment);
                const appointmentId = firstString(appointmentRecord, ['id', 'appointmentId']);
                const appointment = getAppointments(event.state).find((item) => item.id === appointmentId);
                const profile = npcs.find((npc) => npc.id === selectedNpc);
                if (appointment && profile) {
                  const feedback = typeof event.reply === 'string' && event.reply.trim()
                    ? event.reply
                    : [...getNotifications(event.state)].reverse().find((item) => item.npcId === selectedNpc)?.body ?? '邀约结果已记录。';
                  setInvitationResult({ appointment, npcName: profile.name, feedback });
                }
              }
              if (canAttach && outgoingAttachments.length > 0) setAttachmentDescription('');
            }
            if (event.type === 'error' && !received) {
              const detail = typeof event.code === 'string' ? ` ${event.code}` : '';
              setMessages((current) => current.map((item) => item.ts === assistantMessage.ts ? { ...item, content: `（${event.error || '服务暂时不可用'}${detail}）` } : item));
              if (intent === 'call_connect') {
                setPhoneCallActive(false);
                setPhoneCallStartedAt(null);
                setInput('');
              }
            }
          } catch {
            // 忽略无法识别的 SSE 心跳片段。
          }
        }
      }
      networkComplete = true;
      if (!turnCommitted && !communication?.hidePlayerMessage && !(channel === 'work_phone' && phoneCallEndedByUserRef.current)) setInput((current) => current || content.trim());
      finishIfReady();
    } catch (error) {
      console.error(error);
      typewriterQueueRef.current = [];
      if (typewriterTimerRef.current !== null) window.clearInterval(typewriterTimerRef.current);
      typewriterTimerRef.current = null;
      const reason = error instanceof Error ? error.message : '未知错误';
      setMessages((current) => current.map((item) => item.ts === assistantMessage.ts ? { ...item, content: `（本次未推进：${reason}。请重试。）` } : item));
      if (intent === 'call_connect') {
        setPhoneCallActive(false);
        setPhoneCallStartedAt(null);
        setInput('');
      }
      if (!communication?.hidePlayerMessage && !(channel === 'work_phone' && phoneCallEndedByUserRef.current)) setInput((current) => current || content.trim());
      streamingRef.current = false;
      setStreaming(false);
    }
  };

  const toggleRecording = () => {
    if (typeof window === 'undefined') return;
    const speechWindow = window as Window & { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor };
    const Constructor = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (!Constructor) return alert('当前浏览器不支持语音识别，请使用 Chrome。');
    if (isRecording && recognitionRef.current) {
      recognitionRef.current.stop();
      setIsRecording(false);
      return;
    }
    const recognition = new Constructor();
    recognition.lang = 'zh-CN';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      let transcript = '';
      for (let index = 0; index < event.results.length; index += 1) transcript += event.results[index][0].transcript;
      setInput(transcript);
    };
    recognition.onend = () => setIsRecording(false);
    recognition.onerror = () => setIsRecording(false);
    recognitionRef.current = recognition;
    recognition.start();
    setIsRecording(true);
  };

  const npcUnread = (npcId: string) => notifications.filter((item) => !item.read && item.npcId === npcId).length;
  const openContact = async (npcId: string) => {
    if (activeMeeting && activeMeeting.npcId !== npcId) return;
    if (commandBusy || streaming) return;
    if (phoneCallIsActive && !await endPhoneCall()) return;
    setSelectedNpc(npcId);
    setCommunicationChannel('email');
    setPhoneCallActive(false);
    setVisitStep('intro');
    setWorkspaceMode('overview');
  };

  const openVisit = () => {
    if (!selectedNpc) return;
    const acceptedAppointment = selectedAppointments.find((item) => item.status === 'accepted');
    const hasReadyPreparation = selectedPreparations.some((item) => item.status === 'ready');
    setPreparationAppointmentId(acceptedAppointment?.id ?? '');
    setVisitPreparationSkipped(false);
    setVisitStep(hasReadyPreparation ? 'mode' : 'intro');
    setWorkspaceMode('visit');
  };

  const continueToVisitPreparation = () => {
    if (!selectedNpc) return;
    if (!selectedAppointments.some((item) => item.status === 'accepted') && !window.confirm('当前没有已接受的预约。直接登门存在关系风险，是否继续进入拜访准备？')) {
      return;
    }
    setVisitPreparationSkipped(false);
    setVisitStep('preparation');
    setWorkspaceMode('preparation');
  };

  const skipVisitPreparation = () => {
    if (!window.confirm('跳过拜访准备会按正式拜访成本执行。确认跳过并继续吗？')) return;
    setVisitPreparationSkipped(true);
    setVisitStep('mode');
    setWorkspaceMode('visit');
  };

  const submitWechatRequest = async () => {
    if (!selectedNpc || !wechatRequestDraft.trim()) return;
    const success = await runCommand('request_wechat', { npcId: selectedNpc, message: wechatRequestDraft.trim() });
    if (success && selectedContact?.wechatStatus === 'accepted') {
      setCommunicationChannel('online');
      setWorkspaceMode('conversation');
    }
  };

  const sendSticker = (name: string) => {
    const sticker = WECHAT_STICKERS.find((item) => item.name === name);
    if (!sticker || !selectedNpc || communicationChannel !== 'online' || (selectedContact?.wechatStatus !== 'accepted' && selectedContact?.status !== 'online')) return;
    setExpressionPanel(null);
    void sendMessage(`[表情包：${sticker.name}]`, { intent: 'message', channel: 'online' });
  };

  const insertEmoji = (emoji: string) => {
    if (!COMMON_WECHAT_EMOJIS.includes(emoji as typeof COMMON_WECHAT_EMOJIS[number])) return;
    const textarea = chatInputRef.current;
    const start = textarea?.selectionStart ?? input.length;
    const end = textarea?.selectionEnd ?? input.length;
    const next = `${input.slice(0, start)}${emoji}${input.slice(end)}`;
    const cursor = start + emoji.length;
    setInput(next);
    window.requestAnimationFrame(() => {
      chatInputRef.current?.focus();
      chatInputRef.current?.setSelectionRange(cursor, cursor);
    });
  };

  const submitPreparation = async () => {
    if (!selectedNpc) return;
    if (preparationText.trim().length < 10) {
      setCommandFeedback('请用自然语言写明你的拜访前准备，至少 10 个字。');
      return;
    }
    const success = await runCommand('prepare', {
      npcId: selectedNpc,
      appointmentId: preparationAppointmentId || undefined,
      preparationType,
      type: preparationType,
      title: '拜访前准备',
      content: preparationText,
    });
    if (success) {
      setPreparationText('');
      setVisitStep('mode');
      setWorkspaceMode('visit');
    }
  };

  const submitWorkPlan = async (scope: 'global' | 'npc') => {
    const content = (scope === 'global' ? globalPlanDraft : npcPlanDraft).trim();
    if (content.length < 10) {
      setCommandFeedback('请至少写 10 个字，说明计划目标与拟采取的动作。');
      return;
    }
    if (scope === 'npc' && !selectedNpc) return;
    const success = await runCommand('work_plan', { scope, npcId: scope === 'npc' ? selectedNpc : undefined, content });
    if (success) setCommandFeedback('计划已保存，内容保留在编辑区。');
  };

  const currentPlanAlreadySaved = (scope: 'global' | 'npc', content: string) => workPlans.some((plan) => plan.scope === scope
    && (scope === 'global' || plan.npcId === selectedNpc)
    && plan.content.trim() === content.trim());

  const submitPostal = async () => {
    if (!selectedNpc || !postalDraft.trim()) {
      setCommandFeedback('请填写邮寄说明。');
      return;
    }
    const hasTitle = postalAttachmentTitle.trim().length > 0;
    const hasContent = postalAttachmentContent.trim().length > 0;
    if (hasTitle !== hasContent) {
      setCommandFeedback('如需附带材料，请同时填写材料名称和内容简介。');
      return;
    }
    const success = await runCommand('postal', {
      npcId: selectedNpc,
      content: postalDraft.trim(),
      ...(hasTitle && hasContent ? { attachment: { title: postalAttachmentTitle.trim(), content: postalAttachmentContent.trim() } } : {}),
    });
    if (success) {
      setPostalDraft('');
      setPostalAttachmentTitle('');
      setPostalAttachmentContent('');
    }
  };

  const submitVisitBrief = async () => {
    if (!selectedNpc || visitBriefDraft.trim().length < 10) {
      setCommandFeedback('请至少写 10 个字，说明拜访对象、目标和拟沟通内容。');
      return;
    }
    const success = await runCommand('brief_visit', { npcId: selectedNpc, content: visitBriefDraft.trim() });
    if (success) {
      setVisitBriefDraft('');
      setVisitStep('brief_result');
      setWorkspaceMode('visit');
    }
  };

  const startDirectVisit = async (skipPreparation = false) => {
    if (!selectedNpc || activeMeeting) return;
    const readyIds = selectedPreparations.filter((item) => item.status === 'ready').map((item) => item.id);
    if (!readyIds.length && !skipPreparation) {
      setCommandFeedback('直接拜访前请先完成拜访准备，或明确选择未准备登门。');
      return;
    }
    const success = await runCommand('start_visit', { npcId: selectedNpc, preparationIds: skipPreparation ? [] : readyIds, ...(skipPreparation ? { skipPreparation: true } : {}) });
    if (success) setWorkspaceMode('conversation');
  };

  const startScheduledVisit = async (appointment: AppointmentView, skipPreparation = visitPreparationSkipped) => {
    const preparationIds = preparations.filter((item) => item.npcId === appointment.npcId && item.status === 'ready' && (!item.appointmentId || item.appointmentId === appointment.id)).map((item) => item.id);
    const success = await runCommand('start_visit', { appointmentId: appointment.id, preparationIds: skipPreparation ? [] : preparationIds, ...(skipPreparation ? { skipPreparation: true } : {}) });
    if (success) {
      setSelectedNpc(appointment.npcId);
      setWorkspaceMode('conversation');
    }
  };

  const openMinutesEditor = (minutes: MeetingMinutesView) => setMinutesDraft({
    id: minutes.id,
    summary: minutes.summary,
    confirmedItems: minutes.confirmedItems.join('；'),
    npcCommitments: minutes.npcCommitments.join('；'),
    playerCommitments: minutes.playerCommitments.join('；'),
    nextStep: minutes.nextStep,
  });

  const saveMeetingMinutes = async () => {
    if (!minutesDraft) return;
    const splitItems = (value: string) => value.split(/[\n；;]/).map((item) => item.trim()).filter(Boolean);
    const success = await runCommand('update_meeting_minutes', {
      minutesId: minutesDraft.id,
      summary: minutesDraft.summary,
      confirmedItems: splitItems(minutesDraft.confirmedItems),
      npcCommitments: splitItems(minutesDraft.npcCommitments),
      playerCommitments: splitItems(minutesDraft.playerCommitments),
      nextStep: minutesDraft.nextStep,
    });
    if (success) setMinutesDraft(null);
  };

  const selectedNpcName = selectedProfile?.name ?? '联系人';
  const openOrResearchPublicInfo = async (npcId: string) => {
    setPublicInfoRecord(undefined);
    const success = await runCommand('research_public_info', { npcId });
    if (success) setPublicInfoNpcId(npcId);
  };
  const renderMessageAttachments = (message: Message) => {
    if (message.role !== 'user') return null;
    const attachments: ChatAttachmentView[] = message.attachments ?? message.emailAttachments ?? [];
    if (!attachments?.length) return null;
    return <div className="mx-4 mb-4 rounded-xl border border-blue-100 bg-blue-50 p-3"><div className="text-[10px] font-semibold text-blue-900">附件 · {attachments.length} 个</div><div className="mt-2 space-y-2">{attachments.map((attachment, index) => <div key={`${attachment.fileName}-${index}`} className="rounded-lg bg-white px-3 py-2 text-[11px] text-slate-700"><div className="font-semibold text-slate-900">{attachment.fileName}</div><div className="mt-1 leading-5">{attachment.description}</div><div className="mt-2 inline-flex rounded-full bg-slate-100 px-2 py-1 text-[9px] font-semibold text-slate-600">{attachment.viewed === true ? '客户已查看' : attachment.viewed === false ? '客户尚未查看' : '查看状态待更新'}</div>{attachment.impact && <div className="mt-1 text-[10px] leading-4 text-slate-600">{attachment.impact}</div>}</div>)}</div></div>;
  };

  return (
    <div className={`${styles.gamePage} min-h-screen flex flex-col`}>
      <header className={`${styles.topbar} ${activeMeeting ? 'hidden' : ''}`}>
        <div className={styles.headerTop}>
          <div className={styles.brand}>
            <div className={styles.brandIcon}><Building2 className="h-5 w-5" /></div>
            <div>
              <div className={styles.brandTitle}>销售作战台</div>
              <div className={styles.brandCaption}>正式项目 · 项目攻关实训</div>
            </div>
          </div>
          <button type="button" className={styles.projectSummaryCard} onClick={() => setShowProjectNotice(true)} aria-label="打开项目招标通知">
            <span className={styles.projectSummaryIcon}><Building2 className="h-4 w-4" /></span>
            <span className={styles.projectSummaryCopy}>
              <span className={styles.projectSummaryEyebrow}>项目背景 · 点击查看通知</span>
              <strong>{projectNotice?.title ?? scene.name}</strong>
              <small>{projectNotice?.summary ?? scene.description} · 预算 {projectNotice?.budget ?? `${scene.budget} 万元`}</small>
            </span>
            <ChevronRight className={styles.projectSummaryArrow} />
          </button>
          <button type="button" className={styles.competitorSummaryCard} onClick={() => { setSelectedCompanyId(null); setShowCompetitors(true); }} aria-label="查看竞争对手资料">
            <span className={styles.competitorSummaryIcon}><Users className="h-4 w-4" /></span>
            <span className={styles.projectSummaryCopy}>
              <span className={styles.projectSummaryEyebrow}>项目竞品</span>
              <strong>竞争对手</strong>
              <small>{visibleCompetitorProfiles.length > 0 ? `${visibleCompetitorProfiles.length} 家公司 · 点击查看` : '点击查看公司资料'}</small>
            </span>
            <ChevronRight className={styles.projectSummaryArrow} />
          </button>
          <div className={styles.headerStatus}>
            <div role="timer" className={styles.timerCard} aria-label={`项目剩余时间 ${formatCountdown(remainingGameTime)}`}>
              <Timer className={styles.timerIcon} aria-hidden="true" />
              <span className={styles.timerCopy}><small>剩余时间</small><strong>{formatCountdown(remainingGameTime)}</strong></span>
              <span className={styles.timerHint}>{activeMeeting ? '拜访中暂停' : projectTimer?.isPaused ? '等待开始' : '每 5 分钟恢复 5 点'}</span>
            </div>
            <div className={styles.topAp} title="行动点最多为 28 点"><Sparkles className="h-4 w-4" /><span>行动点</span><strong>{coins}<span className="ml-0.5 text-[10px] font-semibold text-amber-700">/28</span></strong></div>
          </div>
          <div className={styles.headerActions}>
            <button onClick={() => setShowSubmissionCheck(true)} disabled={Boolean(commandBusy) || streaming || Boolean(activeMeeting) || phoneCallIsActive}>提交项目</button>
          </div>
        </div>
        {nextAppointment && (
          <div className={styles.nextAppointment}>
            <CalendarClock className="h-3.5 w-3.5" />
            可执行拜访：{npcs.find((npc) => npc.id === nextAppointment.npcId)?.name ?? '联系人'} · {VISIT_LABELS[nextAppointment.visitType]}
          </div>
        )}
      </header>

      <div className={`${styles.workspace} min-h-0 flex-1 ${activeMeeting ? 'hidden' : ''}`}>
        <section className={styles.organizationColumn}>
          <div className={styles.organizationHeader}><div className="text-base font-bold text-slate-900">联系人</div><p className="mt-1 text-[10px] text-slate-500">点击联系人查看详情；连线表示人物层级，不展示具体层级名称。</p></div>
          <div className={styles.organizationCanvas}>
            <div className={styles.organizationCaption}>接触状态与公开信息数量会更新在对应卡片</div>
             <svg className={styles.organizationLines} viewBox="0 0 600 490" preserveAspectRatio="none" aria-hidden="true"><path d="M300 130V151H150V168 M300 151H450V168 M150 287V307H450 M450 287V307 M150 307V326 M450 307V326" /></svg>
            <div className={styles.organizationGrid}>{organizationRows.map((row, rowIndex) => <div className={styles.organizationRow} key={`org-row-${rowIndex}`}>{row.map((npc) => { const infoCount = publicInfoItems(npc.id).length; const unread = npcUnread(npc.id); return <button key={npc.id} onClick={() => openContact(npc.id)} disabled={Boolean(activeMeeting && activeMeeting.npcId !== npc.id)} className={`${styles.personNode} ${selectedNpc === npc.id ? styles.personNodeSelected : ''} disabled:cursor-not-allowed disabled:opacity-45`}><div className={styles.personHead}><PersonPortrait npcId={npc.id} name={npc.name} imageAssets={designerImageAssets} className={styles.personAvatar} sizes="55px" /><span className={styles.personIdentity}><span className={styles.personName}>{npc.name}</span></span>{unread > 0 && <span className="ml-auto h-2 w-2 shrink-0 rounded-full bg-red-500" />}</div><div className={styles.personStatus}><i className={styles.statusDot} />{contactStatus(npc.id)}</div><div className={styles.personMeta}><span>{infoCount} 条公开信息</span>{appointments.some((item) => item.npcId === npc.id && ['pending', 'accepted', 'countered'].includes(item.status)) && <span className={styles.appointmentTag}>已有预约</span>}</div></button>; })}</div>)}</div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-3 text-[10px] text-slate-500"><span>人物层级通过连线表示；已获取信息会随项目状态更新。</span>{selectedNpc && <button onClick={() => void openOrResearchPublicInfo(selectedNpc)} disabled={Boolean(commandBusy) || Boolean(activeMeeting)} className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 font-semibold text-blue-700 disabled:opacity-40">搜索公开信息 · 2行动点</button>}</div>
        </section>
         <main className={`${styles.rightColumn} flex min-h-[680px] min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm`}>
          {selectedNpc && <div className={`${styles.workspaceHeader} flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4`}>
            <div className="flex items-center gap-3">
              {selectedNpc ? <PersonPortrait npcId={selectedNpc} name={selectedNpcName} imageAssets={designerImageAssets} className={styles.contactAvatar} sizes="54px" /> : <div className={styles.contactAvatar}><UserRound className="h-5 w-5" /></div>}
              <div><div className="text-sm font-bold">{selectedNpcName}</div><div className="text-[11px] text-slate-500">联系人 · {contactStatus(selectedNpc)}</div></div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {activeMeeting?.npcId === selectedNpc && <span className="rounded-full bg-emerald-50 px-3 py-1 text-[10px] font-semibold text-emerald-700">{VISIT_LABELS[activeMeeting.visitType]} · {activeMeeting.turnCount}/{activeMeeting.maxTurns}轮</span>}
              {!activeMeeting && <button onClick={async () => { if (phoneCallIsActive && !await endPhoneCall()) return; setSelectedNpc(null); setCommandFeedback(''); setWorkspaceMode('global_plan'); }} disabled={Boolean(commandBusy) || streaming} className={`${styles.workspaceBackButton} rounded-lg border px-3 py-1.5 text-[11px] font-semibold ${workspaceMode === 'global_plan' ? 'border-blue-300 bg-blue-50 text-blue-800' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>← 总体计划</button>}
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] text-slate-600">公开信息 {publicInfoItems(selectedNpc).length}</span>
            </div>
          </div>}

          {selectedNpc && !activeMeeting && <div className={styles.actionStrip}>
            <button onClick={async () => { if (phoneCallIsActive && communicationChannel !== 'email' && !await endPhoneCall()) return; setCommunicationChannel('email'); setInput(''); setWorkspaceMode('conversation'); }} disabled={Boolean(commandBusy) || streaming} className={`${styles.actionButton} ${workspaceMode === 'conversation' && communicationChannel === 'email' ? styles.actionButtonActive : ''}`}><Mail className="h-4 w-4" /><span>邮件</span></button>
            <button onClick={async () => { setCommunicationChannel('work_phone'); setInput(''); setWorkspaceMode('conversation'); }} disabled={Boolean(commandBusy) || streaming} className={`${styles.actionButton} ${workspaceMode === 'conversation' && communicationChannel === 'work_phone' ? styles.actionButtonActive : ''}`}><Phone className="h-4 w-4" /><span>电话</span></button>
            <button onClick={async () => { if (phoneCallIsActive && communicationChannel !== 'online' && !await endPhoneCall()) return; setInput(''); if (selectedContact?.wechatStatus === 'accepted' || selectedContact?.status === 'online') { setCommunicationChannel('online'); setWorkspaceMode('conversation'); } else { setWechatRequestDraft(''); setWorkspaceMode('wechat_request'); } }} disabled={Boolean(commandBusy) || streaming} className={`${styles.actionButton} ${workspaceMode === 'wechat_request' || (workspaceMode === 'conversation' && communicationChannel === 'online') ? styles.actionButtonActive : ''}`}><MessageCircle className="h-4 w-4" /><span>{selectedContact?.wechatStatus === 'accepted' || selectedContact?.status === 'online' ? '微信' : '申请微信'}</span></button>
            <button onClick={async () => { if (phoneCallIsActive && !await endPhoneCall()) return; setInput(''); setWorkspaceMode('postal'); }} disabled={Boolean(commandBusy) || streaming} className={`${styles.actionButton} ${workspaceMode === 'postal' ? styles.actionButtonActive : ''}`}><PackageCheck className="h-4 w-4" /><span>邮寄</span></button>
            <button onClick={async () => { if (phoneCallIsActive && !await endPhoneCall()) return; setInput(''); openVisit(); }} disabled={Boolean(commandBusy) || streaming} className={`${styles.actionButton} ${workspaceMode === 'visit' || workspaceMode === 'preparation' ? styles.actionButtonActive : ''}`}><MapPin className="h-4 w-4" /><span>拜访</span></button>
          </div>}

          {selectedNpc && !activeMeeting && <section className={styles.npcPlanPanel}>
            <div className={styles.npcPlanHeader}><strong>{selectedNpcName} · 联系人补充记录（可选）</strong><span>新记录 1 行动点 · 重复内容不重复扣点</span></div>
            <div className={styles.npcPlanForm}><textarea value={npcPlanDraft} onChange={(event) => setNpcPlanDraft(event.target.value)} maxLength={4000} rows={2} placeholder={`记录与 ${selectedNpcName} 相关的已知事项、待确认问题或后续安排……`} /><button onClick={() => void submitWorkPlan('npc')} disabled={Boolean(commandBusy) || npcPlanDraft.trim().length < 10 || (coins < 1 && !currentPlanAlreadySaved('npc', npcPlanDraft))}>{commandBusy === 'work_plan' ? '记录中…' : currentPlanAlreadySaved('npc', npcPlanDraft) ? '再次查看记录' : '提交记录'}</button></div>
            {workPlans.filter((plan) => plan.scope === 'npc' && plan.npcId === selectedNpc).slice(-1).map((plan) => <div key={plan.id} className={styles.npcPlanHistory}><span>已记录</span><p>{plan.content}</p></div>)}
          </section>}

          {commandFeedback && <div role="status" className="border-b border-slate-200 bg-slate-50 px-5 py-2 text-xs text-slate-700">{commandFeedback}</div>}

          {workspaceMode === 'global_plan' && !activeMeeting && (
            <div className={`${styles.workspaceContent} flex-1 overflow-y-auto bg-white p-5 sm:p-6`} aria-label="整体工作计划">
              <header className={styles.globalPlanHeader}>
                <div className="text-xs font-semibold tracking-[0.14em] text-blue-600">WORKSPACE NOTE</div>
                <h2 className="mt-2 text-lg font-bold text-slate-900">整体工作计划</h2>
                <p className="mt-1 text-xs leading-5 text-slate-500">这里可以记录本项目的工作安排与已知事项。计划为可选记录，提交后会同步到本次正式项目。</p>
              </header>
              <section className={styles.globalPlanCard} aria-label="整体工作计划表单">
                <label className="mt-4 block text-xs font-semibold text-slate-700" htmlFor="global-work-plan">整体工作计划（可选）</label>
                <textarea id="global-work-plan" aria-label="整体工作计划（可选）" value={globalPlanDraft} onChange={(event) => setGlobalPlanDraft(event.target.value)} maxLength={4000} rows={7} placeholder="记录你希望推进的事项、需要确认的信息或下一步安排……" className="mt-2 w-full resize-y rounded-xl border border-slate-200 px-4 py-3 text-sm leading-6 outline-none focus:border-blue-400" />
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2"><span className="text-[10px] leading-5 text-slate-500">草稿不扣点；有效计划提交消耗 1 点。相同内容重复查看不重复扣点。</span><button onClick={() => void submitWorkPlan('global')} disabled={Boolean(commandBusy) || globalPlanDraft.trim().length < 10 || (coins < 1 && !currentPlanAlreadySaved('global', globalPlanDraft))} className="rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-bold text-white disabled:opacity-40">{commandBusy === 'work_plan' ? '提交中…' : currentPlanAlreadySaved('global', globalPlanDraft) ? '再次查看计划' : '提交计划 · 1点'}</button></div>
              </section>
            </div>
          )}

          {workspaceMode === 'overview' && selectedNpc && !activeMeeting && (
            <div className={`${styles.workspaceContent} flex-1 overflow-y-auto bg-slate-50 p-5 sm:p-6`}>
              <div className={`${styles.contactOverview} mx-auto max-w-3xl space-y-4`}>
                <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div><div className="text-xs font-semibold tracking-[0.14em] text-blue-600">联系人概览</div><h2 className="mt-1 text-lg font-bold text-slate-900">{selectedNpcName} · 联系人概览</h2><p className="mt-1 text-xs text-slate-500">联系人 · {contactStatus(selectedNpc)}</p></div>
                    <div className="rounded-xl bg-blue-50 px-4 py-3 text-center"><strong className="block text-lg text-blue-800">{publicInfoItems(selectedNpc).length}</strong><span className="text-[10px] text-blue-700">条已获得信息</span></div>
                  </div>
                  <div className="mt-4 border-t border-slate-100 pt-4">
                    <div className="text-xs font-bold text-slate-800">已获得的信息</div>
                    {publicInfoItems(selectedNpc).length > 0
                      ? <div className="mt-2 space-y-2">{publicInfoItems(selectedNpc).map((fact, index) => <div key={`${selectedNpc}-info-${index}`} className="rounded-xl bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-700">{fact}</div>)}</div>
                      : <p className="mt-2 text-xs text-slate-500">完成公开资料搜索或交流后，已获得的信息会显示在这里。</p>}
                  </div>
                  {hasContacted(selectedNpc) && <button onClick={() => { setProposalNpcId(selectedNpc); setProposalText(''); setShowBidRuleProposal(true); }} disabled={Boolean(commandBusy) || streaming || coins < BID_RULE_PROPOSAL_COST} className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-40">表达项目想法 · {BID_RULE_PROPOSAL_COST}行动点</button>}
                </section>

                <section className={`${styles.visitHistory} rounded-2xl border border-slate-200 bg-white p-5 shadow-sm`}>
                  <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-bold text-slate-900">拜访安排与历史</h3><button onClick={openVisit} className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-[11px] font-semibold text-indigo-800">查看拜访</button></div>
                  {selectedAppointments.length === 0
                    ? <p className="mt-3 rounded-xl border border-dashed border-slate-300 p-3 text-xs text-slate-500">暂无拜访预约或记录。</p>
                    : <div className={`${styles.visitAppointmentList} mt-3 space-y-2`}>{selectedAppointments.slice().reverse().map((appointment) => <article key={appointment.id} className={`${styles.visitAppointment} rounded-xl border border-slate-200 bg-slate-50 p-3`}><div className="flex flex-wrap items-center justify-between gap-2 text-xs"><strong>{VISIT_LABELS[appointment.visitType]}</strong><span className="rounded-full bg-white px-2 py-1 text-[10px] text-slate-600">{STATUS_LABELS[appointment.status] ?? appointment.status}</span></div><div className="mt-1 text-[11px] text-slate-600">{appointment.scheduledLabel ?? formatClock(appointment.scheduledMinute)} · {appointment.location}</div>{appointment.conditions.length > 0 && <div className="mt-1 text-[10px] text-amber-800">前置条件：{appointment.conditions.join('；')}</div>}{appointment.status === 'countered' && <div className="mt-2 flex gap-2"><button onClick={() => void runCommand('update_appointment', { appointmentId: appointment.id, action: 'cancel' })} disabled={Boolean(commandBusy)} className="rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-[10px] font-semibold">取消</button><button onClick={() => void runCommand('update_appointment', { appointmentId: appointment.id, action: 'accept_counter' })} disabled={Boolean(commandBusy)} className="rounded-lg bg-amber-600 px-2.5 py-1 text-[10px] font-semibold text-white">接受改期</button></div>}</article>)}</div>}
                  {selectedMinutes.length > 0 && <div className="mt-4 border-t border-slate-100 pt-4"><div className="flex items-center justify-between gap-2"><h4 className="text-xs font-bold text-slate-800">拜访纪要</h4><span className="text-[10px] text-slate-400">{selectedMinutes.length} 份</span></div><div className="mt-2 space-y-2">{selectedMinutes.slice(-3).reverse().map((minutes) => <article key={minutes.id} className="rounded-xl bg-violet-50/70 p-3"><div className="flex items-center justify-between gap-2"><span className="text-[10px] font-semibold text-violet-900">{VISIT_LABELS[minutes.visitType]}</span><button onClick={() => openMinutesEditor(minutes)} className="rounded-lg border border-violet-200 bg-white px-2 py-1 text-[10px] font-semibold text-violet-800">查看 / 修订</button></div><p className="mt-1 text-xs leading-5 text-slate-700">{minutes.summary}</p>{minutes.npcCommitments.length > 0 && <p className="mt-1 text-[10px] leading-4 text-slate-600">客户承诺：{minutes.npcCommitments.join('；')}</p>}{minutes.playerCommitments.length > 0 && <p className="mt-1 text-[10px] leading-4 text-slate-600">我方承诺：{minutes.playerCommitments.join('；')}</p>}</article>)}</div></div>}
                </section>
              </div>
            </div>
          )}

          {workspaceMode === 'wechat_request' && selectedNpc && !activeMeeting && (
            <div className={`${styles.workspaceContent} flex-1 overflow-y-auto bg-slate-50 p-5 sm:p-6`}>
              <section className={`${styles.wechatRequestCard} mx-auto max-w-2xl rounded-2xl border border-emerald-100 bg-white p-5 shadow-sm`}>
                <div className="text-xs font-semibold tracking-[0.14em] text-emerald-700">WORK WECHAT</div>
                <h2 className="mt-1 text-lg font-bold text-slate-900">申请添加 {selectedNpcName} 的工作微信</h2>
                <p className="mt-2 text-xs leading-5 text-slate-600">用自己的话说明添加工作微信的原因和后续沟通安排。申请会交给客户确认。</p>
                {selectedContact?.wechatStatus && selectedContact.wechatStatus !== 'accepted' && <div className="mt-3 rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-xs text-emerald-900">当前申请状态：{selectedContact.wechatStatus === 'pending' ? '等待对方确认' : selectedContact.wechatStatus === 'later' ? '对方表示稍后处理' : selectedContact.wechatStatus === 'rejected' ? '对方暂未接受' : selectedContact.wechatStatus}</div>}
                {selectedContact?.status === 'known' && <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">请先通过邮件或电话建立接触，再申请添加工作微信。</div>}
                <label className="mt-4 block text-xs font-semibold text-slate-800" htmlFor="wechat-request-message">申请说明（用自己的话说明添加工作微信的原因）</label>
                <textarea id="wechat-request-message" className={styles.wechatRequestTextarea} value={wechatRequestDraft} onChange={(event) => setWechatRequestDraft(event.target.value)} maxLength={1000} rows={5} placeholder="例如：为了方便后续同步项目安排和确认材料，我希望添加您的工作微信。" disabled={selectedContact?.status === 'known' || Boolean(commandBusy)} />
                <button onClick={() => void submitWechatRequest()} disabled={selectedContact?.status === 'known' || selectedContact?.wechatStatus === 'pending' || Boolean(commandBusy) || !wechatRequestDraft.trim()} className="mt-3 w-full rounded-xl bg-emerald-600 py-3 text-sm font-bold text-white disabled:opacity-40">{commandBusy === 'request_wechat' ? '正在提交…' : '提交微信申请'}</button>
                {selectedContact?.wechatStatus === 'pending' && <p className="mt-2 text-center text-[10px] text-slate-500">申请已提交，请等待客户确认。</p>}
              </section>
            </div>
          )}

          {workspaceMode === 'postal' && selectedNpc && !activeMeeting && (
            <div className="flex-1 overflow-y-auto bg-slate-50 p-5 sm:p-6"><div className="mx-auto max-w-2xl"><section className="rounded-2xl border border-amber-100 bg-white p-5 shadow-sm"><div className="text-xs font-semibold tracking-[0.14em] text-amber-700">POSTAL DELIVERY</div><h2 className="mt-1 text-lg font-bold">邮寄材料给 {selectedNpcName}</h2><p className="mt-1 text-xs leading-5 text-slate-500">邮寄会消耗 2 行动点。可选填材料名称和内容简介。</p><Field label="邮寄说明"><textarea value={postalDraft} onChange={(event) => setPostalDraft(event.target.value)} maxLength={2000} rows={5} placeholder="说明寄送目的、希望对方关注的内容及后续沟通安排。" className="w-full resize-y rounded-xl border border-slate-200 px-3 py-2.5 text-sm leading-6" /></Field><Field label="材料名称（可选）"><input value={postalAttachmentTitle} onChange={(event) => setPostalAttachmentTitle(event.target.value)} maxLength={160} placeholder="例如：项目技术方案" className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" /></Field><Field label="材料内容简介（可选）"><textarea value={postalAttachmentContent} onChange={(event) => setPostalAttachmentContent(event.target.value)} maxLength={2000} rows={3} placeholder="用自然语言概括寄送材料的主要内容。" className="w-full resize-y rounded-xl border border-slate-200 px-3 py-2.5 text-sm leading-6" /></Field><button onClick={() => void submitPostal()} disabled={Boolean(commandBusy) || streaming || !postalDraft.trim() || coins < 2 || (postalAttachmentTitle.trim().length > 0) !== (postalAttachmentContent.trim().length > 0)} className="mt-4 w-full rounded-xl bg-amber-600 py-3 text-sm font-bold text-white disabled:opacity-40">确认邮寄 · 2 行动点</button></section><section className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h3 className="text-sm font-bold">邮寄记录</h3>{postalRecords.filter((record) => record.npcId === selectedNpc).slice(-3).reverse().map((record) => <article key={record.id} className="mt-3 rounded-xl bg-slate-50 p-3 text-xs"><div className="text-[10px] text-slate-500">{record.costPoints}行动点</div><p className="mt-1 whitespace-pre-wrap leading-5 text-slate-700">{record.content}</p>{record.attachment && <div className="mt-2 border-l-2 border-amber-300 pl-2 text-[10px] text-slate-500">附件：{record.attachment.title} · {record.attachment.content}</div>}</article>)}</section></div></div>
          )}

          {workspaceMode === 'visit' && selectedNpc && !activeMeeting && (
            <div className={`${styles.workspaceContent} flex-1 overflow-y-auto bg-slate-50 p-5 sm:p-6`}>
              <div className="mx-auto max-w-3xl space-y-4">
                {visitStep === 'intro' && <section className={`${styles.visitFlow} ${styles.visitFlowStep} rounded-2xl border border-indigo-100 bg-white p-5 shadow-sm`}>
                  <div className="text-xs font-semibold tracking-[0.14em] text-indigo-600">VISIT</div><h2 className="mt-1 text-lg font-bold">拜访 {selectedNpcName}</h2>
                  {selectedAppointments.some((item) => item.status === 'accepted')
                    ? <p className="mt-2 text-xs leading-5 text-slate-600">你有已接受的拜访预约。继续后先完成准备，也可以明确选择跳过准备。</p>
                    : <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">当前没有已接受的预约。直接登门存在关系风险；继续后可先做准备，再由正式服务确认能否开始拜访。</div>}
                  <button onClick={continueToVisitPreparation} disabled={Boolean(commandBusy)} className="mt-4 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-bold text-white disabled:opacity-40">继续拜访</button>
                </section>}

                {visitStep === 'mode' && <section className={`${styles.visitFlow} ${styles.visitFlowStep} rounded-2xl border border-indigo-100 bg-white p-5 shadow-sm`}>
                  <div className="text-xs font-semibold tracking-[0.14em] text-indigo-600">VISIT MODE</div><h2 className="mt-1 text-lg font-bold">选择与 {selectedNpcName} 的拜访方式</h2>
                  <p className="mt-2 text-xs leading-5 text-slate-600">{visitPreparationSkipped ? '已明确跳过准备。' : '拜访准备已保存。'}实际模拟将进入面对面多轮沟通；简述方案会由正式服务评估你的计划。</p>
                  {selectedPreparations.filter((item) => item.status === 'ready').length > 0 && <div className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-700"><strong>可用准备：</strong>{selectedPreparations.filter((item) => item.status === 'ready').map((item) => item.title).join('、')}</div>}
                  {selectedPreparations.filter((item) => item.feedback).slice(-1).map((item) => <div key={`${item.id}-feedback`} className="mt-3 rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs leading-5 text-blue-900"><strong>准备反馈</strong>{item.feedback?.strengths.length ? <div className="mt-2"><span className="font-semibold">准备充分之处：</span>{item.feedback.strengths.join('；')}</div> : null}{item.feedback?.risks.length ? <div className="mt-1"><span className="font-semibold">需要补强：</span>{item.feedback.risks.join('；')}</div> : null}{item.feedback?.nextStep && <div className="mt-1"><span className="font-semibold">下一步：</span>{item.feedback.nextStep}</div>}</div>)}
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <button onClick={() => void startDirectVisit(visitPreparationSkipped)} disabled={Boolean(commandBusy) || streaming || coins < 3 || (!visitPreparationSkipped && !selectedPreparations.some((item) => item.status === 'ready'))} className="rounded-xl bg-indigo-600 p-4 text-left text-white disabled:opacity-40"><strong className="block text-sm">实际模拟 · 3行动点</strong><span className="mt-1 block text-[11px] leading-5 text-white/85">进入沉浸式拜访，与联系人逐轮沟通。</span></button>
                    <button onClick={() => setVisitStep('brief')} className="rounded-xl border border-violet-100 bg-violet-50 p-4 text-left"><strong className="block text-sm text-violet-950">简述拜访方案</strong><span className="mt-1 block text-[11px] leading-5 text-violet-800">描述目标、问题、材料和下一步，由正式服务评估 · 2 行动点。</span></button>
                  </div>
                  {selectedAppointments.filter((item) => item.status === 'accepted').length > 0 && <div className="mt-4 border-t border-slate-100 pt-4"><h3 className="text-xs font-bold text-slate-800">已接受的预约</h3><div className={`${styles.visitAppointmentList} mt-2 space-y-2`}>{selectedAppointments.filter((item) => item.status === 'accepted').map((appointment) => <article key={appointment.id} className={`${styles.visitAppointment} flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-100 bg-blue-50 p-3`}><div className="text-xs"><strong>{VISIT_LABELS[appointment.visitType]}</strong><div className="mt-1 text-[10px] text-slate-600">{appointment.scheduledLabel ?? formatClock(appointment.scheduledMinute)} · {appointment.location}</div></div><button onClick={() => void startScheduledVisit(appointment)} disabled={Boolean(commandBusy) || streaming || coins < 3 || (!visitPreparationSkipped && !selectedPreparations.some((item) => item.status === 'ready' && (!item.appointmentId || item.appointmentId === appointment.id)))} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">开始预约拜访 · 3行动点</button></article>)}</div></div>}
                  <button onClick={() => { setVisitStep('preparation'); setWorkspaceMode('preparation'); }} className="mt-4 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700">返回拜访准备</button>
                </section>}

                {visitStep === 'brief' && <section className={`${styles.visitFlow} ${styles.visitFlowStep} rounded-2xl border border-violet-100 bg-white p-5 shadow-sm`}>
                  <div className="text-xs font-semibold tracking-[0.14em] text-violet-600">BRIEF VISIT PLAN</div><h2 className="mt-1 text-lg font-bold">简述与 {selectedNpcName} 的拜访方案</h2><p className="mt-2 text-xs leading-5 text-slate-600">用自然语言写明目标、开场、需要确认的问题、使用的材料和预期下一步。</p>
                  <textarea value={visitBriefDraft} onChange={(event) => setVisitBriefDraft(event.target.value)} maxLength={4000} rows={8} placeholder="说明你会如何开场、确认哪些问题、使用什么材料以及希望形成什么下一步。" className="mt-4 w-full resize-y rounded-xl border border-violet-200 bg-white px-3 py-2.5 text-sm leading-6" />
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2"><span className="text-[10px] text-slate-500">评估消耗 2 行动点</span><div className="flex gap-2"><button onClick={() => setVisitStep('mode')} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700">返回选择方式</button><button onClick={() => void submitVisitBrief()} disabled={Boolean(commandBusy) || visitBriefDraft.trim().length < 10 || coins < 2} className="rounded-lg bg-violet-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-40">{commandBusy === 'brief_visit' ? '评估中…' : '提交拜访方案 · 2行动点'}</button></div></div>
                </section>}

                {visitStep === 'brief_result' && <section className={`${styles.visitFlow} ${styles.visitFlowStep} rounded-2xl border border-violet-100 bg-white p-5 shadow-sm`}>
                  <div className="text-xs font-semibold tracking-[0.14em] text-violet-600">VISIT REVIEW</div><h2 className="mt-1 text-lg font-bold">{selectedNpcName} · 拜访方案评估</h2>
                  {visitBriefs.filter((brief) => brief.npcId === selectedNpc).slice(-1).map((brief) => <div key={brief.id} className="mt-4 rounded-xl bg-slate-50 p-4 text-xs"><div className="text-[10px] text-slate-500">拜访方案评估</div><div className="mt-3 grid gap-3 sm:grid-cols-2"><div><strong>做得较好的部分</strong><ul className="mt-1 list-disc pl-4 leading-5 text-slate-600">{brief.strengths.map((item, index) => <li key={`${brief.id}-s-${index}`}>{item}</li>)}</ul></div><div><strong>需要补强</strong><ul className="mt-1 list-disc pl-4 leading-5 text-slate-600">{brief.risks.map((item, index) => <li key={`${brief.id}-risk-${index}`}>{item}</li>)}</ul></div></div><p className="mt-3 leading-5 text-violet-900"><strong>下一步：</strong>{brief.nextStep}</p></div>)}
                  <button onClick={() => setWorkspaceMode('overview')} className="mt-4 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700">返回联系人概览</button>
                </section>}

                <section className={`${styles.visitHistory} rounded-2xl border border-slate-200 bg-white p-5 shadow-sm`}><h3 className="text-sm font-bold text-slate-900">预约与拜访历史</h3>{selectedAppointments.length === 0 ? <p className="mt-3 text-xs text-slate-500">暂无预约记录。可继续拜访并先完成准备。</p> : <div className={`${styles.visitAppointmentList} mt-3 space-y-2`}>{selectedAppointments.slice().reverse().map((appointment) => <article key={appointment.id} className={`${styles.visitAppointment} rounded-xl border border-slate-200 bg-slate-50 p-3`}><div className="flex flex-wrap items-center justify-between gap-2 text-xs"><strong>{VISIT_LABELS[appointment.visitType]}</strong><span>{STATUS_LABELS[appointment.status] ?? appointment.status}</span></div><div className="mt-1 text-[10px] text-slate-600">{appointment.scheduledLabel ?? formatClock(appointment.scheduledMinute)} · {appointment.location}</div></article>)}</div>}{selectedMinutes.slice(-2).reverse().map((minutes) => <article key={minutes.id} className="mt-3 rounded-xl border border-violet-100 bg-violet-50/70 p-3 text-xs"><div className="flex items-center justify-between gap-2"><strong>拜访纪要</strong><button onClick={() => openMinutesEditor(minutes)} className="rounded-lg border border-violet-200 bg-white px-2 py-1 text-[10px] font-semibold text-violet-800">查看 / 修订</button></div><p className="mt-1 leading-5 text-slate-700">{minutes.summary}</p></article>)}</section>
              </div>
            </div>
          )}

          {workspaceMode === 'preparation' && selectedNpc && (
            <div className={`${styles.workspaceContent} ${styles.visitFlow} flex-1 overflow-y-auto bg-slate-50 p-5 sm:p-6`}>
              <div className={`${styles.visitFlowStep} mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white p-5 shadow-sm`}>
                <div className="mb-5 flex items-center justify-between"><div><h2 className="text-lg font-bold">为 {selectedNpcName} 做拜访前准备</h2><p className="mt-1 text-xs text-slate-500">结合已知信息，写明材料、问题、证据与拜访目标。准备本身不消耗行动点。</p></div><button onClick={() => { setVisitStep('intro'); setWorkspaceMode('visit'); }} className="rounded-lg border border-slate-200 p-2" aria-label="返回拜访"><X className="h-4 w-4" /></button></div>
                {selectedAppointments.length > 0 && <Field label="绑定拜访（可选）"><select value={preparationAppointmentId} onChange={(event) => setPreparationAppointmentId(event.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-400"><option value="">作为通用准备</option>{selectedAppointments.filter((item) => ['pending', 'accepted', 'countered'].includes(item.status)).map((item) => <option key={item.id} value={item.id}>{VISIT_LABELS[item.visitType]} · {item.location}</option>)}</select></Field>}
                <Field label="你的拜访前准备"><textarea value={preparationText} onChange={(event) => setPreparationText(event.target.value)} rows={10} placeholder="请自行写明你准备了哪些信息、材料、案例、问题、证据或其他事项，以及为什么这样准备。" className="w-full resize-none rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm leading-6 outline-none focus:border-blue-400" /></Field>
                <div className="mt-4 grid gap-2 sm:grid-cols-2"><button onClick={submitPreparation} disabled={Boolean(commandBusy) || preparationText.trim().length < 10} className="rounded-xl bg-blue-600 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40">{commandBusy === 'prepare' ? '准备中…' : '保存并选择拜访方式'}</button><button onClick={skipVisitPreparation} disabled={Boolean(commandBusy)} className="rounded-xl border border-amber-300 bg-amber-50 py-3 text-sm font-semibold text-amber-900 disabled:opacity-40">跳过准备</button></div>
              </div>
            </div>
          )}

          {workspaceMode === 'conversation' && (
            <>
              {activeMeeting?.npcId === selectedNpc && (
                <div className="border-b border-emerald-100 bg-emerald-50 px-5 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs"><MapPin className="h-4 w-4 text-emerald-700" /><strong>{VISIT_LABELS[activeMeeting.visitType]}</strong><span className="text-emerald-800">对话上限 {activeMeeting.maxTurns}轮</span></div>
                    {activeMeeting.awaitingFinalReplyFrom !== 'player' && <button onClick={() => runCommand('end_visit', { appointmentId: activeMeeting.appointmentId, reason: 'player', summary: '' })} disabled={Boolean(commandBusy) || streaming} className="rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-emerald-800 disabled:opacity-40">结束拜访</button>}
                  </div>
                  {activeMeeting.visitType === 'informal' && activeMeeting.workTopicOpenedBy !== 'npc' && <div className="mt-2 text-[11px] text-amber-800">当前是非正式交流，建议先聊生活与兴趣，等待对方自然谈到工作。</div>}
                  {activeMeeting.turnCount === activeMeeting.maxTurns - 1 && <div className="mt-2 rounded-lg border border-amber-300 bg-amber-100 px-3 py-2 text-[11px] font-semibold text-amber-900">只剩最后一轮对话，请优先确认结论、双方承诺和下一步。</div>}
                  {selectedPreparations.filter((item) => item.status !== 'delivered' && item.status !== 'used').length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {selectedPreparations.map((item) => {
                        const usedInMeeting = activeMeeting.usedPreparationIds.includes(item.id) || item.status === 'used';
                        return <button key={item.id} onClick={() => item.type.includes('gift')
                          ? runCommand('give_gift', { preparationId: item.id, appointmentId: activeMeeting.appointmentId, setting: activeMeeting.visitType === 'informal' ? 'private' : 'public', witnesses: [], exchangeRequested: false })
                          : runCommand('follow_up', { action: 'deliver_preparation', npcId: selectedNpc, appointmentId: activeMeeting.appointmentId, preparationId: item.id })
                        } disabled={Boolean(commandBusy) || streaming || usedInMeeting} className={`rounded-full border px-3 py-1 text-[10px] font-semibold disabled:opacity-40 ${usedInMeeting ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-emerald-200 bg-white text-emerald-800'}`}><PackageCheck className="mr-1 inline h-3 w-3" />{usedInMeeting ? '已使用' : item.type.includes('gift') ? '赠送' : '递交'}：{item.title}</button>;
                      })}
                    </div>
                  )}
                </div>
              )}
              <div ref={channelMessagesRef} className={`${styles.channelMessages} min-h-0 flex-1 overflow-y-auto p-5 ${activeMeeting ? 'hidden' : communicationChannel === 'email' ? 'bg-slate-100' : 'bg-slate-950'}`}>
                {selectedNpc && !activeMeeting && communicationChannel !== 'work_phone' && <div className={`mx-auto mb-4 max-w-2xl rounded-2xl border p-4 shadow-sm ${communicationChannel === 'email' ? 'border-slate-200 bg-white text-slate-800' : 'border-violet-200 bg-gradient-to-r from-violet-700 to-indigo-700 text-white'}`}><div className="flex items-center gap-2 text-sm font-bold">{communicationChannel === 'email' ? <Mail className="h-4 w-4" /> : <MessageCircle className="h-4 w-4" />}{communicationChannel === 'email' ? `写给 ${selectedNpcName} 的邮件` : `与 ${selectedNpcName} 的微信`}</div><div className={`mt-1 text-[11px] ${communicationChannel === 'email' ? 'text-slate-400' : 'text-white/70'}`}>{communicationChannel === 'email' ? '收件人：客户联系人　主题：项目沟通' : '通过工作微信自然沟通'}</div></div>}
                {!selectedNpc && <EmptyPhoneState icon={Users} title="选择一位联系人" description="从联系人列表选择人物，再通过电话、邮件或微信自然沟通，必要时提出拜访并准备材料。" />}
              {selectedNpc && !activeMeeting && communicationChannel === 'work_phone' && <div className={styles.phonePanel}><div className={styles.phoneCard}><PersonPortrait npcId={selectedNpc} name={selectedNpcName} imageAssets={designerImageAssets} className={styles.phonePortrait} sizes="180px" /><div className={styles.phoneEyebrow}>工作电话 · 正式项目</div><h3>{selectedNpcName}</h3><p>{phoneCallIsActive ? (streaming ? '正在接通…' : '通话已接通') : '准备拨打工作电话'}</p>{phoneCallIsActive ? <><div className={styles.phoneLog}><div className={styles.phoneLogTitle}>本次通话</div>{currentPhoneMessages.length > 0 ? currentPhoneMessages.slice(-4).map((message) => <p key={message.ts}><strong>{message.role === 'user' ? '我：' : `${selectedNpcName}：`}</strong>{message.content || (streaming ? '…' : '')}</p>) : <p className={styles.phoneLogEmpty}>{streaming ? '正在接通…' : '等待对方回应…'}</p>}</div><button onClick={() => void endPhoneCall()} disabled={Boolean(commandBusy) || streaming} className={styles.hangupButton}>挂断</button></> : <><div className={styles.callHistory}><div className={styles.callHistoryTitle}>历史通话记录</div>{callHistoryStatus === 'loading' ? <p className={styles.phoneLogEmpty}>正在加载通话记录…</p> : callHistoryStatus === 'error' ? <div className={styles.callHistoryError}><p>通话记录加载失败，请稍后重试</p><button onClick={() => setCallHistoryRefreshKey((current) => current + 1)}>重试</button></div> : callHistory.length > 0 ? callHistory.map((record) => <div key={record.id} className={styles.callHistoryItem}><span>{formatMessageTime(new Date(record.createdAt).getTime())}</span><strong>{callOutcomeLabel(record.outcome)}</strong></div>) : <p className={styles.phoneLogEmpty}>暂无历史通话记录</p>}</div><button onClick={() => { const startedAt = Date.now(); phoneCallEndedByUserRef.current = false; setPhoneCallStartedAt(startedAt); setPhoneCallActive(true); void sendMessage('[电话呼出]', { intent: 'call_connect', channel: 'work_phone', hidePlayerMessage: true }); }} disabled={!selectedNpc || streaming} className={styles.callButton}><Phone className="h-5 w-5" /><span>拨打工作电话</span></button></>}</div></div>}
                {selectedNpc && !activeMeeting && communicationChannel !== 'work_phone' && visibleChannelMessages.length === 0 && <div className="mx-auto mt-12 max-w-sm rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center"><MessageCircle className="mx-auto h-8 w-8 text-blue-500" /><div className="mt-3 text-sm font-bold">开始与 {selectedNpcName} 沟通</div><div className="mt-2 text-xs leading-5 text-slate-500">对方的真实态度不会直接显示，请留意措辞、回复节奏与后续行动。</div></div>}
                  {selectedNpc && !activeMeeting && communicationChannel === 'email' && <div className="channelMessageList mx-auto max-w-2xl space-y-3">{visibleChannelMessages.map((message) => <article key={message.ts} className="rounded-xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-100 px-4 py-2 text-[11px] text-slate-500"><div className="flex flex-wrap items-center gap-2"><strong className="text-slate-800">{message.role === 'user' ? '我方' : selectedNpcName}</strong><span>收件人：{message.role === 'user' ? selectedNpcName : '我方'}</span>{message.readStatus === 'read' && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-semibold text-emerald-700">已读</span>}{message.deliveryStatus === 'unanswered' && message.readStatus !== 'read' && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px]">未回复</span>}</div><div className="mt-1">主题：项目沟通　·　{formatMessageTime(message.ts)}</div></div><p className="whitespace-pre-wrap px-4 py-3 text-sm leading-6 text-slate-800">{message.content || (streaming ? '正在发送…' : '')}</p>{renderMessageAttachments(message)}</article>)}</div>}
                  {selectedNpc && !activeMeeting && communicationChannel === 'online' && <div className="channelMessageList mx-auto max-w-2xl space-y-3">{visibleChannelMessages.map((message) => { const sticker = WECHAT_STICKERS.find((item) => message.content.trim() === `[表情包：${item.name}]`); return <article key={message.ts} className={`rounded-2xl p-3 shadow-sm ${message.role === 'user' ? 'ml-auto max-w-[88%] bg-emerald-100 text-slate-800' : 'mr-auto max-w-[88%] border border-slate-200 bg-white text-slate-800'}`}><div className="mb-1 flex flex-wrap items-center gap-2 text-[10px] font-semibold text-slate-500">{message.role === 'user' ? '我方' : selectedNpcName} · {formatMessageTime(message.ts)}{message.readStatus === 'read' && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-semibold text-emerald-700">已读</span>}{message.deliveryStatus === 'unanswered' && message.readStatus !== 'read' && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px]">未回复</span>}</div>{sticker ? <div className={styles.stickerBubble} role="img" aria-label={`表情包：${sticker.name}`}><span>{sticker.symbol}</span><strong>{sticker.name}</strong></div> : <p className="whitespace-pre-wrap text-sm leading-6">{message.content || (streaming ? '正在发送…' : '')}</p>}{renderMessageAttachments(message)}</article>; })}</div>}
              </div>
              <div className={`${styles.channelComposer} border-t border-slate-200 bg-white p-4 ${activeMeeting ? 'hidden' : ''}`}>
                {commandFeedback && <div role="status" className="mb-2 text-[11px] text-slate-600">{commandFeedback}</div>}
                {(communicationChannel === 'email' || communicationChannel === 'online') && <div className="mb-3 rounded-xl border border-blue-100 bg-blue-50 p-3"><label htmlFor="chat-attachment-description" className="block text-[11px] font-semibold text-blue-900">附加材料（可选）</label><p className="mt-1 text-[10px] text-blue-700">用一段自然语言描述本次附带的材料内容。</p><textarea id="chat-attachment-description" className={styles.attachmentDescription} value={attachmentDescription} onChange={(event) => setAttachmentDescription(event.target.value)} disabled={streaming} maxLength={1000} rows={2} placeholder="例如：附上流程对比和验收边界清单，重点标注重复录入减少的位置。" /></div>}
                {communicationChannel === 'online' && (selectedContact?.wechatStatus === 'accepted' || selectedContact?.status === 'online') && <div className={styles.expressionTools} aria-label="微信表情工具"><button type="button" onClick={() => setExpressionPanel((current) => current === 'emoji' ? null : 'emoji')} aria-expanded={expressionPanel === 'emoji'} className={styles.expressionTool}>😊 Emoji</button><button type="button" onClick={() => setExpressionPanel((current) => current === 'sticker' ? null : 'sticker')} aria-expanded={expressionPanel === 'sticker'} className={styles.expressionTool}>🎴 表情包</button>{expressionPanel === 'emoji' && <div className={styles.expressionPanel} role="region" aria-label="Emoji 面板"><div className={styles.expressionPanelHead}>常用 Emoji <span>点击插入当前光标位置</span></div><div className={styles.emojiGrid}>{COMMON_WECHAT_EMOJIS.map((emoji) => <button key={emoji} type="button" className={styles.emojiButton} onClick={() => insertEmoji(emoji)} aria-label={`插入 ${emoji}`}>{emoji}</button>)}</div></div>}{expressionPanel === 'sticker' && <div className={styles.expressionPanel} role="region" aria-label="表情包面板"><div className={styles.expressionPanelHead}>工作表情包 <span>点击即可发送 · 1 行动点</span></div><div className={styles.stickerGrid}>{WECHAT_STICKERS.map((sticker) => <button key={sticker.id} type="button" className={styles.stickerButton} onClick={() => sendSticker(sticker.name)} disabled={streaming || Boolean(commandBusy)} aria-label={`发送表情包：${sticker.name}`}><span>{sticker.symbol}</span><strong>{sticker.name}</strong><small>{sticker.hint}</small></button>)}</div></div>}</div>}
                {communicationChannel === 'work_phone' && !phoneCallIsActive ? <div className="flex items-center justify-between rounded-xl bg-violet-50 px-4 py-3 text-sm text-violet-900"><span>请在上方电话面板中拨打；接通后可输入通话要点。</span><Phone className="h-4 w-4" /></div> : <div className="flex items-end gap-2">
                  <textarea ref={chatInputRef} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendMessage(input); } }} disabled={!selectedNpc || streaming} rows={3} placeholder={selectedContact?.status === 'known' ? '输入首次建联内容…' : communicationChannel === 'email' ? '撰写邮件正文…' : communicationChannel === 'online' ? '输入微信消息…' : '输入电话话术…'} className="min-h-[76px] flex-1 resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400 disabled:bg-slate-100" />
                  <button onClick={toggleRecording} disabled={!selectedNpc || streaming} className={`rounded-xl border p-3 ${isRecording ? 'border-red-300 bg-red-50 text-red-600' : 'border-slate-200 text-slate-500'}`}>{isRecording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}</button>
                    <button onClick={() => sendMessage(input)} disabled={!selectedNpc || streaming || !input.trim()} className="rounded-xl bg-blue-600 p-3 text-white disabled:opacity-40"><Send className="h-4 w-4" /></button>
                </div>}
                <div className="mt-2 text-[10px] text-slate-400">邮件与微信每条 1 行动点，附件另计 1 点；工作电话拨打 1 点，接通后同一通话内沟通不另扣点，挂断后需重新拨打。</div>
              </div>
            </>
          )}
        </main>
      </div>

      {activeMeeting && selectedNpc && (() => {
        const meetingNpc = npcs.find((npc) => npc.id === activeMeeting.npcId);
        const meetingName = meetingNpc?.name ?? selectedNpcName;
        const appointment = appointments.find((item) => item.id === activeMeeting.appointmentId);
        const meetingLocation = appointment?.location || '客户单位';
        const visibleTurn = Math.min(activeMeeting.turnCount + 1, activeMeeting.maxTurns);
        const awaitingFinalReply = activeMeeting.awaitingFinalReplyFrom === 'player';
        const meetingExpression = npcExpressionFor(activeMeeting.npcId);
        return (
          <section className={styles.visitImmersive} aria-label={`与${meetingName}的沉浸式拜访`}>
            <VisitBackdrop sources={sceneImageCandidates(designerImageAssets, activeMeeting.npcId, meetingLocation)} />
            <div className={styles.visitScrim} />
            <div className={styles.visitBody}>
              <div className={styles.visitHud}>
                <div className={styles.visitPlace}><span>正在拜访</span><strong>{meetingLocation}</strong><small>{VISIT_LABELS[activeMeeting.visitType]} · {meetingName}</small></div>
                <div className={styles.visitTimerBadge}><Timer className="h-4 w-4" /><strong>{formatCountdown(remainingGameTime)}</strong><small>拜访暂停 · 每轮 15 秒</small></div>
                <div className={styles.visitStatus}><span>当前轮次</span><strong>第 {visibleTurn} / {activeMeeting.maxTurns} 轮</strong><em>已完成 {activeMeeting.completedTasks.length} 项</em>{!awaitingFinalReply && <button onClick={() => runCommand('end_visit', { appointmentId: activeMeeting.appointmentId, reason: 'player', summary: '' })} disabled={Boolean(commandBusy) || streaming} aria-label="结束拜访"><X className="h-4 w-4" /></button>}</div>
              </div>
              <div className={styles.visitStage}>
                <div className={styles.visitPerson}>
                  <PersonPortrait npcId={activeMeeting.npcId} name={meetingName} imageAssets={designerImageAssets} className={styles.visitPortrait} expression={meetingExpression} sizes="(max-width: 780px) 52vw, 470px" priority />
                  <div className={styles.visitPersonLabel}><strong>{meetingName}</strong><span>客户联系人</span></div>
                </div>
                <section className={styles.visitDialogue}>
                  <div className={styles.visitDialogueHead}>{meetingName} · 客户联系人</div>
                  <p className={`${styles.visitDialogueCopy} ${latestNpcMeetingMessage ? '' : styles.visitDialogueEmpty}`}>
                    {latestNpcMeetingMessage?.content || (streaming ? '正在思考…' : awaitingFinalReply ? '客户已表示告辞，请回复最后一句后结束拜访。' : `${meetingName} 正在等你开场。请用自己的话说明这次拜访的来意。`)}
                  </p>
                  {awaitingFinalReply && <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">客户已表示告辞，请回复最后一句后结束拜访。</div>}
                  {latestPlayerMeetingMessage && <div className={styles.visitLastPlayer}><strong>你刚刚说：</strong>{latestPlayerMeetingMessage.content}</div>}
                  {streaming && <div className={styles.visitThinking}><span />正在整理回应…</div>}
                  <div className={styles.visitComposer}>
                    <textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendMessage(input); } }} disabled={streaming} rows={2} placeholder={awaitingFinalReply ? '输入最后一句回应…' : '输入你想说的话；也可以直接表达告辞…'} />
                    <div className={styles.visitComposerActions}><button onClick={() => sendMessage(input)} disabled={streaming || !input.trim()}><Send className="h-4 w-4" /><span>{streaming ? '等待回应…' : awaitingFinalReply ? '回应并结束' : '发送'}</span></button>{!awaitingFinalReply && <button onClick={() => runCommand('end_visit', { appointmentId: activeMeeting.appointmentId, reason: 'player', summary: '' })} disabled={Boolean(commandBusy) || streaming}>主动告辞</button>}</div>
                  </div>
                </section>
              </div>
            </div>
          </section>
        );
      })()}

      {showProjectNotice && (
        <Modal title="项目采购通知" onClose={() => setShowProjectNotice(false)}>
          <div className={styles.noticeMasthead}>
            <div className="text-xs font-semibold tracking-[0.16em] text-blue-700">模拟采购项目 · 项目通知</div>
            <h2 className="mt-2 text-xl font-bold text-slate-900">{projectNotice?.title ?? scene.name}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">{projectNotice?.summary ?? scene.description}</p>
            <div className="mt-4 flex flex-wrap gap-2 text-xs"><span className="rounded-full bg-white px-3 py-1.5 font-semibold text-slate-700">预算：{projectNotice?.budget ?? `${scene.budget} 万元`}</span><span className="rounded-full bg-white px-3 py-1.5 font-semibold text-slate-700">项目类型：销售攻关实训</span></div>
          </div>
          <div className="mt-5 space-y-4">
            {(projectNotice?.sections ?? []).map((section) => <section key={section.heading} className="rounded-xl border border-slate-200 bg-white p-4"><h3 className="text-sm font-bold text-slate-900">{section.heading}</h3><div className="mt-2 space-y-2">{section.content.map((line, index) => <p key={`${section.heading}-${index}`} className="text-sm leading-6 text-slate-600">{line}</p>)}</div></section>)}
            {(!projectNotice || projectNotice.sections.length === 0) && <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-600">{scene.description}</p>}
          </div>
          <p className="mt-4 text-[11px] leading-5 text-slate-400">本通知用于模拟实训。具体需求、决策路径和采购条件以项目沟通中确认的信息为准。</p>
        </Modal>
      )}

      {showCompetitors && (
        <Modal title={selectedCompany ? `${selectedCompany.company_name} · 资料详情` : '竞争对手资料'} onClose={() => { setShowCompetitors(false); setSelectedCompanyId(null); }}>
          {!selectedCompany && <div className={styles.noticeMasthead}>
            <div className="text-xs font-semibold tracking-[0.16em] text-blue-700">竞争格局 · 公司公开资料</div>
            <h2 className="mt-2 text-xl font-bold text-slate-900">公司列表</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">选择一家公司，查看其基本情况、优势和服务信息。</p>
          </div>}
          {competitorLoadStatus === 'loading' && visibleCompetitorProfiles.length === 0 && <p className="mt-5 rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-900" role="status">正在读取竞争对手资料…</p>}
          {competitorLoadStatus === 'loading' && visibleCompetitorProfiles.length > 0 && <p className="mt-4 text-xs text-slate-500" role="status">正在更新资料…</p>}
          {competitorLoadStatus === 'error' && (
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950" role="alert">
              <span>{competitorLoadError || '竞争对手资料加载失败。'}</span>
              <button type="button" aria-label="重试竞争对手资料" onClick={() => { setCompetitorLoadStatus('loading'); setCompetitorRetry((value) => value + 1); }} className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-semibold text-amber-900">重试</button>
            </div>
          )}
          {competitorLoadStatus === 'idle' && <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600"><span>当前尚未载入对局资料。</span><button type="button" aria-label="重新加载竞争对手资料" onClick={() => { setCompetitorLoadStatus('loading'); setCompetitorRetry((value) => value + 1); }} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700">重新加载</button></div>}
          {competitorLoadStatus === 'ready' && visibleCompetitorProfiles.length === 0 && (
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
              <span>当前项目尚未配置竞争对手资料。</span>
              <button type="button" aria-label="重新加载竞争对手资料" onClick={() => { setCompetitorLoadStatus('loading'); setCompetitorRetry((value) => value + 1); }} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700">重新加载</button>
            </div>
          )}
          <div className="mt-5 space-y-4">
            {!selectedCompany && visibleCompetitorProfiles.map((profile) => {
              const summary = profile.features.trim() || profile.more_info.trim() || profile.solution_summary.trim();
              return (
                <button type="button" key={profile.id} className={styles.competitorCompanyRow} onClick={() => setSelectedCompanyId(profile.id)} aria-label={`查看${profile.company_name}公司资料`}>
                  <span className={styles.competitorCompanyCopy}>
                    <span className={styles.competitorCompanyHeading}>
                      <strong>{profile.company_name}</strong>
                      {profile.industry.trim() && <small>{profile.industry}</small>}
                    </span>
                    <span className={styles.competitorCompanySummary}>{summary || '暂无公司介绍或核心优势'}</span>
                  </span>
                  <ChevronRight aria-hidden="true" />
                </button>
              );
            })}
            {selectedCompany && (
              <article className={styles.competitorCompanyDetail} aria-label={`${selectedCompany.company_name}资料`}>
                <button type="button" className={styles.competitorBackButton} onClick={() => setSelectedCompanyId(null)} aria-label="返回竞争对手列表"><ChevronLeft aria-hidden="true" />返回公司列表</button>
                <header className={styles.competitorDetailHeader}>
                  <h2>{selectedCompany.company_name}</h2>
                  {selectedCompany.industry.trim() && <span>{selectedCompany.industry}</span>}
                </header>
                <dl className={styles.competitorProfileDetails}>
                  {([
                    ['基本介绍', selectedCompany.more_info],
                    ['核心优势', selectedCompany.features],
                    ['方案特点', selectedCompany.solution_summary],
                    ['代表经验', selectedCompany.representative_experience],
                    ['服务支持', selectedCompany.service_support],
                  ] as const).filter(([, content]) => content.trim()).map(([heading, content]) => (
                    <div key={`${selectedCompany.id}-${heading}`}>
                      <dt>{heading}</dt>
                      <dd>{content}</dd>
                    </div>
                  ))}
                </dl>
              </article>
            )}
          </div>
          {!selectedCompany && <p className="mt-4 text-[11px] leading-5 text-slate-400">资料用于模拟项目分析，不代表评审结果或任何未公开的客户决策信息。</p>}
        </Modal>
      )}

      {!gameState && savePickerReady && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl overflow-hidden rounded-3xl border border-white/10 bg-white shadow-2xl">
            <div className="bg-[#0B1736] px-8 py-7 text-white"><div className="text-xs font-semibold tracking-[0.2em] text-blue-300">SALES SIMULATION</div><h1 className="mt-2 text-2xl font-bold">进入项目作战台</h1><p className="mt-2 text-sm text-slate-300">每位玩家只保留一个进行中的项目存档。</p></div>
            <div className="p-7">
              {activeSaves[0] ? <div className="mb-5 rounded-2xl border border-slate-200 bg-slate-50 p-5"><div className="flex items-center justify-between gap-4"><div><div className="text-xs font-semibold uppercase tracking-wider text-slate-400">当前进度</div><div className="mt-2 text-base font-bold text-slate-900">进行中的项目</div><div className="mt-1 text-xs text-slate-500">最近保存 {new Date(activeSaves[0].updatedAt).toLocaleString('zh-CN')}</div></div><span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">可继续</span></div></div> : <div className="mb-5 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-7 text-center text-sm text-slate-500">还没有进行中的项目，请开始新游戏。</div>}
              {savePickerError && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{savePickerError}</div>}
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <button onClick={() => activeSaves[0] && void openSave(activeSaves[0].id, true)} disabled={loadingSave || !activeSaves[0]} className="flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3.5 text-sm font-bold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-35"><ChevronRight className="h-4 w-4" />继续游戏</button>
                <button onClick={() => void startNewGame()} disabled={loadingSave} className="flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-3.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40"><Play className="h-4 w-4" />开始新游戏</button>
              </div>
              {activeSaves[0] && <p className="mt-3 text-center text-[11px] text-amber-700">开始新游戏会先要求确认，确认后覆盖当前存档。</p>}
            </div>
          </div>
        </div>
      )}

      {showBidRuleProposal && selectedNpc && (
        <Modal title="表达项目想法" onClose={() => setShowBidRuleProposal(false)}>
          <p className="text-sm leading-6 text-slate-600">用自己的话说明你希望客户在项目评审时重点关注什么。每次沟通消耗 {BID_RULE_PROPOSAL_COST} 行动点。</p>
          <Field label="沟通对象">
            <select value={proposalNpcId} onChange={(event) => setProposalNpcId(event.target.value)} disabled={Boolean(activeMeeting)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-400 disabled:bg-slate-100">
              {proposalNpcOptions.map((npc) => <option key={npc.id} value={npc.id}>{npc.name}</option>)}
            </select>
          </Field>
          <Field label="你想表达的内容">
            <textarea value={proposalText} onChange={(event) => setProposalText(event.target.value)} rows={5} maxLength={500} placeholder="例如：本项目的应用环境复杂，建议重点关注设备定位的精度和长期稳定性。" className="w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm leading-6 outline-none focus:border-blue-400" />
            <div className="mt-1 text-right text-[10px] text-slate-400">{proposalText.trim().length}/500 字 · 至少 12 字</div>
          </Field>
          {coins < BID_RULE_PROPOSAL_COST && <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">行动点不足，暂时无法沟通。</div>}
          <div className="mt-5 flex justify-end gap-2">
            <button onClick={() => setShowBidRuleProposal(false)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold">取消</button>
            <button onClick={async () => { await runCommand('propose_bid_rule', { targetContactId: proposalNpcId, proposalText: proposalText.trim() }); }} disabled={Boolean(commandBusy) || streaming || !proposalNpcId || proposalText.trim().length < 12 || coins < BID_RULE_PROPOSAL_COST} className="rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40">发送内容</button>
          </div>
        </Modal>
      )}

      {invitationResult && (
        <Modal title="邀约结果" onClose={() => setInvitationResult(null)}>
          <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-4"><PersonPortrait npcId={invitationResult.appointment.npcId} name={invitationResult.npcName} imageAssets={designerImageAssets} className={styles.invitationPortrait} sizes="48px" /><div><div className="font-bold">{invitationResult.npcName}</div><div className="text-xs text-slate-500">客户联系人</div></div></div>
          <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm leading-6 text-blue-950">{invitationResult.feedback}</div>
          <div className="mt-4 grid gap-2 text-xs sm:grid-cols-2"><div className="rounded-xl border border-slate-200 p-3"><span className="text-slate-500">状态</span><strong className="ml-2">{STATUS_LABELS[invitationResult.appointment.status] ?? invitationResult.appointment.status}</strong></div><div className="rounded-xl border border-slate-200 p-3"><span className="text-slate-500">执行</span><strong className="ml-2">接受后可按约定时间拜访</strong></div><div className="rounded-xl border border-slate-200 p-3"><span className="text-slate-500">地点</span><strong className="ml-2">{invitationResult.appointment.location}</strong></div><div className="rounded-xl border border-slate-200 p-3"><span className="text-slate-500">形式</span><strong className="ml-2">{VISIT_LABELS[invitationResult.appointment.visitType]}</strong></div></div>
        </Modal>
      )}

      {showSubmissionCheck && (
        <Modal title="项目提交检查" onClose={() => setShowSubmissionCheck(false)}>
          <p className="text-sm leading-6 text-slate-600">提交后将立即结算本局，结果页会展示我方与竞品对比、客户内部决策回放与证据链。</p>
          {phoneCallIsActive && <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">请先回到工作电话并挂断，再提交项目。</p>}
          <div className="mt-4 space-y-2 text-xs"><CheckRow label="决策链" value={gameState?.unlockedClues?.includes('decision_process') ? '已核实' : '未核实'} warning={!gameState?.unlockedClues?.includes('decision_process')} /><CheckRow label="公开信息" value="按需即时搜索" warning={false} /><CheckRow label="线下拜访纪要" value={`${meetingMinutes.length} 份`} warning={meetingMinutes.length === 0} /><CheckRow label="合规风险" value={gameState?.complianceRisks?.some((risk) => risk.status === 'latent' || risk.status === 'triggered') ? '存在风险' : '未发现高风险'} warning={Boolean(gameState?.complianceRisks?.some((risk) => risk.status === 'latent' || risk.status === 'triggered'))} /></div>
          {submissionWarnings.length > 0 && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900"><strong>提交前注意：</strong>{submissionWarnings.join('；')}</div>}
          <div className="mt-5 flex justify-end gap-2"><button onClick={() => setShowSubmissionCheck(false)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold">返回补充</button><button onClick={async () => { setShowSubmissionCheck(false); await runCommand('submit'); }} disabled={phoneCallIsActive || Boolean(commandBusy) || streaming} className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40">确认提交并结算</button></div>
        </Modal>
      )}

      {minutesDraft && (
        <Modal title="纠正拜访纪要" onClose={() => setMinutesDraft(null)}>
          <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs leading-5 text-blue-900">修订会保留系统原始纪要和修订次数，便于结果回放和教练复盘。</div>
          <Field label="会谈摘要"><textarea value={minutesDraft.summary} onChange={(event) => setMinutesDraft((current) => current ? { ...current, summary: event.target.value } : current)} rows={3} className="w-full rounded-xl border border-slate-200 p-3 text-sm" /></Field>
          <Field label="已确认事项（用分号分隔）"><textarea value={minutesDraft.confirmedItems} onChange={(event) => setMinutesDraft((current) => current ? { ...current, confirmedItems: event.target.value } : current)} rows={2} className="w-full rounded-xl border border-slate-200 p-3 text-sm" /></Field>
          <Field label="客户承诺"><textarea value={minutesDraft.npcCommitments} onChange={(event) => setMinutesDraft((current) => current ? { ...current, npcCommitments: event.target.value } : current)} rows={2} className="w-full rounded-xl border border-slate-200 p-3 text-sm" /></Field>
          <Field label="我方承诺"><textarea value={minutesDraft.playerCommitments} onChange={(event) => setMinutesDraft((current) => current ? { ...current, playerCommitments: event.target.value } : current)} rows={2} className="w-full rounded-xl border border-slate-200 p-3 text-sm" /></Field>
          <Field label="下一步"><input value={minutesDraft.nextStep} onChange={(event) => setMinutesDraft((current) => current ? { ...current, nextStep: event.target.value } : current)} className="w-full rounded-xl border border-slate-200 p-3 text-sm" /></Field>
          <button onClick={() => void saveMeetingMinutes()} disabled={Boolean(commandBusy) || !minutesDraft.summary.trim() || !minutesDraft.nextStep.trim()} className="mt-5 w-full rounded-xl bg-blue-600 py-3 text-sm font-bold text-white disabled:opacity-40">保存修订</button>
        </Modal>
      )}

      {publicInfoNpcId && publicInfoRecord && (
        <Modal title={`${npcs.find((npc) => npc.id === publicInfoNpcId)?.name ?? '人物'} · 公开资料卡`} onClose={() => setPublicInfoNpcId(null)}>
          <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-900">本资料只包含公开可获得的信息。弱线索是准备方向，不代表人物的真实态度或最终决策权。</div>
          <section className="mt-4"><h3 className="text-sm font-bold text-slate-900">公开事实</h3><div className="mt-2 space-y-2">{publicInfoRecord.facts.map((fact) => <div key={fact} className="flex gap-2 rounded-xl bg-slate-50 p-3 text-sm leading-6 text-slate-700"><Check className="mt-1 h-4 w-4 shrink-0 text-emerald-600" /><span>{fact}</span></div>)}</div></section>
          <section className="mt-5"><h3 className="text-sm font-bold text-slate-900">可供准备参考的弱线索</h3><div className="mt-2 space-y-2">{publicInfoRecord.weakSignals.map((signal) => <div key={signal} className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900">{signal}</div>)}</div></section>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-4 text-[11px] text-slate-500"><span>来源：{publicInfoRecord.sourceNote}</span><span>本次搜索消耗 {publicInfoRecord.costPoints} 行动点；关闭后不保存显示</span></div>
        </Modal>
      )}

      <CustomerActivityPlanner
        sessionId={gameSessionId}
        refreshSignal={customerActivityRefreshKey}
        onGameState={(state) => applyServerState(state as GameRuntimeState)}
      />

    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="mt-4 block"><span className="mb-1.5 block text-xs font-semibold text-slate-700">{label}</span>{children}</label>;
}

function CheckRow({ label, value, warning }: { label: string; value: string; warning: boolean }) {
  return <div className={`flex items-center justify-between rounded-xl border px-3 py-2.5 ${warning ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-slate-200 bg-slate-50 text-slate-700'}`}><span>{label}</span><strong>{value}</strong></div>;
}

function EmptyPhoneState({ icon: Icon, title, description }: { icon: typeof Mail; title: string; description: string }) {
  return <div className="flex min-h-48 flex-col items-center justify-center px-6 text-center"><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400"><Icon className="h-6 w-6" /></div><div className="mt-3 text-sm font-bold text-slate-700">{title}</div><div className="mt-1 text-[11px] leading-5 text-slate-500">{description}</div></div>;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const titleId = useId();
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm" role="presentation" onClick={onClose}><div role="dialog" aria-modal="true" aria-labelledby={titleId} className="max-h-[82vh] w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}><div className="flex items-center justify-between border-b border-slate-200 px-5 py-4"><h2 id={titleId} className="text-base font-bold">{title}</h2><button type="button" aria-label={`关闭${title}`} onClick={onClose} className="rounded-lg p-1.5 hover:bg-slate-100"><X className="h-4 w-4" /></button></div><div className="max-h-[calc(82vh-64px)] overflow-y-auto p-5">{children}</div></div></div>;
}
