import 'server-only';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { orgRepository, prisma, userRepository } from '@quorum/db';
import type { Adapter, AdapterUser } from 'next-auth/adapters';

/**
 * Workspace provisioning on first sign-in.
 *
 * `User.orgId` is required, but the stock Prisma adapter has no concept of a workspace
 * and calls `user.create` without one — so signup would fail on a not-null constraint.
 * Wrapping `createUser` is the smallest correct intervention: identity stays entirely
 * with Auth.js, and the one domain fact it cannot know is supplied here.
 *
 * The first person to sign up owns their workspace. Anything else (silently joining an
 * org that shares your email domain) would let a stranger who controls a lookalike
 * mailbox into a firm's data, which is not a trade an accounting product can make.
 * Invitations arrive with member management; until then every signup is its own tenant.
 */
export function createQuorumAdapter(): Adapter {
  const base = PrismaAdapter(prisma);

  return {
    ...base,
    async createUser(user: AdapterUser): Promise<AdapterUser> {
      const email = user.email.toLowerCase();
      const org = await orgRepository.create(workspaceNameFor(user.name, email));

      const created = await userRepository.createOwner({
        orgId: org.id,
        email,
        emailVerified: user.emailVerified,
        name: user.name ?? null,
        image: user.image ?? null,
      });

      return {
        id: created.id,
        email: created.email,
        emailVerified: created.emailVerified,
        name: created.name,
        image: created.image,
      };
    },
  };
}

/** "maya@chen-cpa.com" becomes "Chen Cpa"; a display name is preferred when present. */
function workspaceNameFor(name: string | null | undefined, email: string): string {
  if (name && name.trim().length > 0) return `${name.trim()}'s workspace`;
  const domain = email.split('@')[1] ?? '';
  const label = domain.split('.')[0] ?? '';
  if (label.length === 0) return 'Workspace';
  return label
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
