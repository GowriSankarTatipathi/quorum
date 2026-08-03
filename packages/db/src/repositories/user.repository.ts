import { prisma } from '../client.js';
import type { UpdateUserAuthorityInput, UserRecord, UserWithOrg } from '../types.js';
import { toUser, toUserWithOrg } from './mappers.js';

const WITH_ORG = { org: true } as const;

export const userRepository = {
  /**
   * Create the first user of a workspace.
   *
   * Lives here rather than in the Auth.js adapter so that the raw Prisma client stays
   * confined to `@quorum/db`. The adapter supplies identity; this supplies the domain
   * facts Auth.js has no concept of — tenancy and role.
   */
  async createOwner(input: {
    orgId: string;
    email: string;
    emailVerified: Date | null;
    name: string | null;
    image: string | null;
  }): Promise<UserRecord> {
    const row = await prisma.user.create({
      data: {
        orgId: input.orgId,
        email: input.email.toLowerCase(),
        emailVerified: input.emailVerified,
        name: input.name,
        image: input.image,
        role: 'OWNER',
      },
    });
    return toUser(row);
  },

  async findById(id: string): Promise<UserRecord | null> {
    const row = await prisma.user.findUnique({ where: { id } });
    return row ? toUser(row) : null;
  },

  /** The hot path for request authentication: one query returns both the identity and
   *  the workspace policy that constrains it. */
  async findByIdWithOrg(id: string): Promise<UserWithOrg | null> {
    const row = await prisma.user.findUnique({ where: { id }, include: WITH_ORG });
    return row ? toUserWithOrg(row) : null;
  },

  async findByEmailWithOrg(email: string): Promise<UserWithOrg | null> {
    const row = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: WITH_ORG,
    });
    return row ? toUserWithOrg(row) : null;
  },

  async listByOrg(orgId: string): Promise<UserRecord[]> {
    const rows: unknown[] = await prisma.user.findMany({
      where: { orgId },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((r) => toUser(r as Record<string, unknown>));
  },

  async markSignedIn(id: string): Promise<void> {
    await prisma.user.update({ where: { id }, data: { lastLoginAt: new Date() } });
  },

  /**
   * Changing role or approval authority bumps `tokenVersion` in the same statement.
   *
   * Access tokens are stateless and live for 15 minutes, so without this a demoted
   * user keeps their old authority until the token expires. Coupling the two in one
   * update makes it impossible to change authority and forget to invalidate.
   */
  async updateAuthority(id: string, input: UpdateUserAuthorityInput): Promise<UserWithOrg> {
    const row = await prisma.user.update({
      where: { id },
      data: { ...input, tokenVersion: { increment: 1 } },
      include: WITH_ORG,
    });
    return toUserWithOrg(row);
  },

  /** Used by "sign out everywhere": invalidates every outstanding access token. */
  async bumpTokenVersion(id: string): Promise<number> {
    const row = await prisma.user.update({
      where: { id },
      data: { tokenVersion: { increment: 1 } },
      select: { tokenVersion: true },
    });
    return Number((row as { tokenVersion: unknown }).tokenVersion);
  },

  async setDisabled(id: string, disabled: boolean): Promise<UserRecord> {
    const row = await prisma.user.update({
      where: { id },
      data: {
        disabledAt: disabled ? new Date() : null,
        ...(disabled ? { tokenVersion: { increment: 1 } } : {}),
      },
    });
    return toUser(row);
  },

  async countByOrg(orgId: string): Promise<number> {
    return Number(await prisma.user.count({ where: { orgId } }));
  },
};

export type UserRepository = typeof userRepository;
