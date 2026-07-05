/**
 * Auth service — signup / login / logout and session lifecycle.
 *
 * Signup creates User + Organization + OrganizationMember(OWNER) in ONE
 * transaction (Phase 3: every account gets an org automatically). Sessions are
 * DB-backed; the raw token is returned to the caller (for the cookie) and only
 * its hash is stored.
 */
import { prisma } from '../db/prisma.js';
import { config } from '../config/index.js';
import { generateToken, hashPassword, hashToken, verifyPassword } from './password.js';
import { writeAuditLog } from '../audit/audit.service.js';

export interface AuthResult {
  token: string; // raw session token → set as cookie by the caller
  user: { id: string; email: string; name: string };
  organization: { id: string; name: string; slug: string };
}

/** Build a URL-safe, reasonably-unique org slug from a name. */
function slugify(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'org';
  const suffix = generateToken(4).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6);
  return `${base}-${suffix}`;
}

async function issueSession(userId: string, organizationId: string): Promise<string> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + config.sessionTtlDays * 24 * 60 * 60 * 1000);
  await prisma.session.create({
    data: { userId, organizationId, tokenHash: hashToken(token), expiresAt },
  });
  return token;
}

export interface SignupInput {
  email: string;
  password: string;
  name: string;
  organizationName?: string;
  ip?: string;
}

export async function signup(input: SignupInput): Promise<AuthResult> {
  const email = input.email.trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new AuthError('email_in_use', 'An account with this email already exists.', 409);

  const passwordHash = await hashPassword(input.password);
  const orgName = input.organizationName?.trim() || `${input.name.split(' ')[0]}'s Organization`;

  const { user, organization } = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { email, passwordHash, name: input.name.trim() } });
    const organization = await tx.organization.create({ data: { name: orgName, slug: slugify(orgName) } });
    await tx.organizationMember.create({
      data: { organizationId: organization.id, userId: user.id, role: 'OWNER' },
    });
    return { user, organization };
  });

  const token = await issueSession(user.id, organization.id);
  await writeAuditLog({ action: 'user.signup', userId: user.id, organizationId: organization.id, ip: input.ip });

  return {
    token,
    user: { id: user.id, email: user.email, name: user.name },
    organization: { id: organization.id, name: organization.name, slug: organization.slug },
  };
}

export interface LoginInput {
  email: string;
  password: string;
  ip?: string;
}

export async function login(input: LoginInput): Promise<AuthResult> {
  const email = input.email.trim().toLowerCase();
  const user = await prisma.user.findUnique({
    where: { email },
    include: { memberships: { include: { organization: true }, orderBy: { createdAt: 'asc' }, take: 1 } },
  });
  // Constant-ish failure path — same error whether email or password is wrong.
  if (!user || !user.passwordHash || !(await verifyPassword(input.password, user.passwordHash))) {
    throw new AuthError('invalid_credentials', 'Invalid email or password.', 401);
  }
  const membership = user.memberships[0];
  if (!membership) throw new AuthError('no_organization', 'Account has no organization.', 500);

  const token = await issueSession(user.id, membership.organizationId);
  await writeAuditLog({ action: 'user.login', userId: user.id, organizationId: membership.organizationId, ip: input.ip });

  return {
    token,
    user: { id: user.id, email: user.email, name: user.name },
    organization: {
      id: membership.organization.id,
      name: membership.organization.name,
      slug: membership.organization.slug,
    },
  };
}

/** Revoke a session by its raw token (idempotent). */
export async function logout(token: string): Promise<void> {
  await prisma.session.updateMany({
    where: { tokenHash: hashToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Resolve a raw session token to its auth context, or null if invalid/expired/revoked. */
export async function resolveSession(
  token: string,
): Promise<{ userId: string; organizationId: string } | null> {
  const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!session || session.revokedAt || session.expiresAt < new Date()) return null;
  return { userId: session.userId, organizationId: session.organizationId };
}

/** Typed auth error carrying an HTTP status. */
export class AuthError extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(message);
    this.name = 'AuthError';
  }
}
