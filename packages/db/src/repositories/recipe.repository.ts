import { type Prisma } from '@prisma/client';
import { prisma } from '../client.js';
import type { RecipeRecord } from '../types.js';
import { toRecipe } from './runtime-mappers.js';

export interface CreateRecipeInput {
  orgId: string;
  name: string;
  goalTemplate: string;
  planTemplate: Record<string, unknown>;
  corrections?: Record<string, unknown> | null;
}

export const recipeRepository = {
  async create(input: CreateRecipeInput): Promise<RecipeRecord> {
    const row = await prisma.recipe.create({
      data: {
        orgId: input.orgId,
        name: input.name,
        goalTemplate: input.goalTemplate,
        planTemplate: input.planTemplate as Prisma.InputJsonValue, // Prisma requires InputJsonValue for json fields
        corrections: (input.corrections ?? undefined) as Prisma.InputJsonValue | undefined, // Prisma requires InputJsonValue for json fields
      },
    });
    return toRecipe(row);
  },

  async findById(id: string): Promise<RecipeRecord | null> {
    const row = await prisma.recipe.findUnique({ where: { id } });
    return row ? toRecipe(row) : null;
  },

  async listForOrg(orgId: string): Promise<RecipeRecord[]> {
    const rows: unknown[] = await prisma.recipe.findMany({
      where: { orgId },
      orderBy: [{ runCount: 'desc' }, { name: 'asc' }],
    });
    return rows.map((r) => toRecipe(r as Record<string, unknown>));
  },

  /**
   * A human correction becomes a hint on the next run. This is the compounding loop: the
   * product gets better with use, which is the only durable advantage in an agent
   * business. Corrections are merged rather than replaced so earlier fixes survive.
   */
  async mergeCorrections(id: string, corrections: Record<string, unknown>): Promise<RecipeRecord> {
    const existing = await prisma.recipe.findUnique({
      where: { id },
      select: { corrections: true },
    });
    const previous = ((existing as { corrections: Record<string, unknown> | null } | null)
      ?.corrections ?? {}) satisfies Record<string, unknown>;
    return toRecipe(
      await prisma.recipe.update({
        where: { id },
        data: { corrections: { ...previous, ...corrections } as Prisma.InputJsonValue }, // Prisma requires InputJsonValue for json fields
      }),
    );
  },

  /**
   * Success rate is recomputed from the runs rather than incremented, because runs can
   * be re-verified or corrected after the fact and a running counter would drift away
   * from the truth it claims to summarise.
   */
  async refreshStats(id: string): Promise<RecipeRecord> {
    const [total, completed] = await prisma.$transaction([
      prisma.run.count({ where: { recipeId: id } }),
      prisma.run.count({ where: { recipeId: id, status: 'COMPLETED' } }),
    ]);
    const runCount = Number(total);
    const successRate = runCount === 0 ? null : (Number(completed) / runCount).toFixed(3);
    return toRecipe(await prisma.recipe.update({ where: { id }, data: { runCount, successRate } }));
  },

  async rename(id: string, name: string): Promise<RecipeRecord> {
    return toRecipe(await prisma.recipe.update({ where: { id }, data: { name } }));
  },

  async remove(id: string): Promise<void> {
    await prisma.recipe.delete({ where: { id } });
  },
};

export type RecipeRepository = typeof recipeRepository;
