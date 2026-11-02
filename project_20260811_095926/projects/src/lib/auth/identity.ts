// 身份权限类型定义 + 辅助函数
import { createHmac, timingSafeEqual } from 'node:crypto';

export type Role = 'platform_designer' | 'enterprise_admin' | 'trainer' | 'player';
export type SubRole = 'enterprise_employee' | 'paid_individual';

export interface RoleConfig {
  role: Role;
  subRole?: SubRole;
  name: string;
  icon: string; // lucide icon name
  color: string; // DESIGN.md 增量规范色
  description: string;
  permissions: string[];
  canPlayGame: boolean;
  isSubSelectable: boolean;
}

export const ROLE_CONFIGS: Record<Role, RoleConfig> = {
  platform_designer: {
    role: 'platform_designer',
    name: '平台设计师',
    icon: 'Wand2',
    color: '#7C3AED',
    description: '搭建与维护整个平台',
    permissions: ['页面编辑', '数据表编辑', '工作流编辑', '权限管理', '全局配置'],
    canPlayGame: true,
    isSubSelectable: false,
  },
  enterprise_admin: {
    role: 'enterprise_admin',
    name: '企业管理员',
    icon: 'Building2',
    color: '#0EA5E9',
    description: '管理学院与员工',
    permissions: ['学员管理', '邀请码生成', '查看员工对话', '查看诊断报告', '批量下载报告'],
    canPlayGame: false,
    isSubSelectable: false,
  },
  trainer: {
    role: 'trainer',
    name: '培训教练',
    icon: 'Megaphone',
    color: '#EA580C',
    description: '组织多人联机实训',
    permissions: ['创建多人房间', '全局启停对局', '查看所有玩家数据', '阶段性点评'],
    canPlayGame: true,
    isSubSelectable: false,
  },
  player: {
    role: 'player',
    name: '玩家',
    icon: 'UserRound',
    color: '#2F6BFF',
    description: '参与博弈演练',
    permissions: ['选择场景', 'AI 实时对话', '查看诊断报告', '积累能力值'],
    canPlayGame: true,
    isSubSelectable: true,
  },
};

export interface Session {
  userId: string;
  role: Role;
  subRole?: SubRole;
  displayName: string;
  enterpriseId?: string;
  permissions: string[];
  expiresAt: number;
}

export interface LoginProof {
  userId: string;
  expiresAt: number;
}

function getSigningSecret(): string {
  const secret =
    process.env.SESSION_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY;
  if (!secret) {
    // 仅本地开发兜底：无任何密钥时用固定值，保证 demo 可运行。
    // 正式环境必须设置 SESSION_SECRET，否则所有签名可被伪造。
    console.warn(
      '[auth] 未配置 SESSION_SECRET / SUPABASE 密钥，回退到不安全的开发签名密钥。正式环境必须设置 SESSION_SECRET。',
    );
    return 'weixun-dev-only-insecure-secret';
  }
  return secret;
}

function sign(payload: unknown): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', getSigningSecret()).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

function verify<T>(token: string): T | null {
  const dot = token.lastIndexOf('.');
  if (dot < 0) return null;
  const encoded = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac('sha256', getSigningSecret()).update(encoded).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) return null;
  try {
    return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf-8')) as T;
  } catch {
    return null;
  }
}

export function createSession(userId: string, role: Role, subRole?: SubRole, enterpriseId?: string): Session {
  const config = ROLE_CONFIGS[role];
  // displayName: 从 userId 抽手机号末 4 位 → "用户6105"；
  // 若 userId 不是 "u_<手机号>" 格式，则退化为 userId 末 4 位
  const phoneMatch = userId.match(/^u_(1[3-9]\d{9})$/);
  const tail = phoneMatch ? phoneMatch[1].slice(-4) : userId.slice(-4);
  return {
    userId,
    role,
    subRole,
    displayName: `用户${tail}`,
    enterpriseId,
    permissions: [...config.permissions],
    expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24h
  };
}

export function signSession(session: Session): string {
  return sign(session);
}

export function getSession(token: string | undefined): Session | null {
  if (!token) return null;
  const session = verify<Session>(token);
  if (!session) return null;
  if (typeof session.userId !== 'string' || !session.userId.trim() || !Number.isFinite(session.expiresAt)) return null;
  // A signed login proof is not a session and must never authorize an API call.
  if (!Object.prototype.hasOwnProperty.call(ROLE_CONFIGS, session.role)) return null;
  if (!Array.isArray(session.permissions) || !session.permissions.every((value) => typeof value === 'string')) return null;
  if (session.expiresAt < Date.now()) return null;
  return session;
}

export function signLoginProof(userId: string): string {
  return sign({ userId, expiresAt: Date.now() + 5 * 60 * 1000 } satisfies LoginProof);
}

export function verifyLoginProof(token: string | undefined): LoginProof | null {
  if (!token) return null;
  const proof = verify<LoginProof>(token);
  if (!proof) return null;
  if (typeof proof.userId !== 'string' || typeof proof.expiresAt !== 'number') return null;
  if (proof.expiresAt < Date.now()) return null;
  return proof;
}

export function hasPermission(session: Session | null, permission: string): boolean {
  if (!session) return false;
  return ROLE_CONFIGS[session.role]?.permissions.includes(permission) ?? false;
}
