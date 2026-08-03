import { prisma } from '../client.js';
import type { OrgPolicyInput, OrgRecord } from '../types.js';
import { toOrg } from './mappers.js';

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base.length > 0 ? base : 'workspace';
}

export const orgRepository = {
  async findById(id: string): Promise<OrgRecord | null> {
    const row = await prisma.org.findUnique({ where: { id } });
    return row ? toOrg(row) : null;
  },

  async findBySlug(slug: string): Promise<OrgRecord | null> {
    const row = await prisma.org.findUnique({ where: { slug } });
    return row ? toOrg(row) : null;
  },

  /**
   * Slug collisions are resolved by suffixing rather than by failing. Two firms named
   * "Chen CPA" signing up in the same week is ordinary, and a signup that errors on a
   * cosmetic identifier is a self-inflicted wound.
   */
  async create(name: string): Promise<OrgRecord> {
    const base = slugify(name);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const slug = attempt === 0 ? base : `${base}-${String(attempt + 1)}`;
      const existing = await prisma.org.findUnique({ where: { slug } });
      if (existing) continue;
      return toOrg(await prisma.org.create({ data: { name, slug } }));
    }
    const unique = `${base}-${Date.now().toString(36)}`;
    return toOrg(await prisma.org.create({ data: { name, slug: unique } }));
  },

  async updatePolicy(id: string, policy: OrgPolicyInput): Promise<OrgRecord> {
    return toOrg(await prisma.org.update({ where: { id }, data: policy }));
  },
};

export type OrgRepository = typeof orgRepository;
