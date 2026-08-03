import {
  PLANNER_PROMPT_VERSION,
  PlanSchema,
  buildPlannerPrompt,
  type Plan,
  type PlanStep,
} from '@quorum/ai';
import type { AutonomyMode, RiskLevel } from '@quorum/core';
import { orgRepository, recipeRepository, runRepository, stepRepository } from '@quorum/db';
import type { CreateStepInput } from '@quorum/db';
import { createHash } from 'node:crypto';
import { logger } from '../logger.js';
import { eventPublisher, newCorrelation } from '../services/event-publisher.js';
import { createRouter } from '../services/llm.js';
import { RunTelemetry } from '../services/telemetry.js';
import { env } from '../env.js';

export interface PlannerResult {
  plan: Plan;
  planHash: string;
  stepCount: number;
  refused: boolean;
}

export class PlannerRefusedError extends Error {
  constructor(readonly refusal: string) {
    super(refusal);
    this.name = 'PlannerRefusedError';
  }
}

/**
 * A stable fingerprint of what the human actually saw.
 *
 * `POST /runs/:id/plan/approve` carries this hash, so a plan regenerated or patched
 * between render and click no longer matches and the approval is refused. Without it
 * there is a real time-of-check/time-of-use window in which someone approves a plan
 * they never read — and "I didn't approve that" is not a conversation this product can
 * afford to have.
 */
export function hashPlan(plan: Plan): string {
  const canonical = JSON.stringify({
    summary: plan.summary,
    allowedHosts: [...plan.allowedHosts].sort(),
    steps: plan.steps.map((step) => ({
      index: step.index,
      objective: step.objective,
      targetUrl: step.targetUrl,
      agentPath: step.agentPath,
      riskLevel: step.riskLevel,
    })),
  });
  return createHash('sha256').update(canonical).digest('hex');
}

const RISK_ORDER: Record<RiskLevel, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };

/** Highest risk present in the plan — the sentence that lets a cautious user click Approve. */
export function planRiskSummary(plan: Plan): { highest: RiskLevel; irreversibleSteps: number[] } {
  let highest: RiskLevel = 'LOW';
  const irreversibleSteps: number[] = [];
  for (const step of plan.steps) {
    if (RISK_ORDER[step.riskLevel] > RISK_ORDER[highest]) highest = step.riskLevel;
    if (step.riskLevel === 'HIGH') irreversibleSteps.push(step.index);
  }
  return { highest, irreversibleSteps };
}

const toCreateStepInput = (step: PlanStep): CreateStepInput => ({
  index: step.index,
  objective: step.objective,
  targetUrl: step.targetUrl,
  agentPath: [...step.agentPath],
  outputSchema: step.outputSchema,
  riskLevel: step.riskLevel,
  notes: step.notes,
  estimatedMs: step.estimatedSeconds * 1000,
  estimatedMicroUsd: Math.round(step.estimatedUsd * 1_000_000),
});

export interface RunPlannerInput {
  runId: string;
  orgId: string;
  goal: string;
  mode: AutonomyMode;
  budgetMicroUsd: number;
  recipeId: string | null;
}

/**
 * The Planner agent.
 *
 * It decomposes a goal into an ordered plan and then stops. It never browses, and the
 * plan is persisted but not executed — the run parks in AWAITING_APPROVAL, because the
 * cheapest possible place to correct an agent is before it has spent ninety seconds
 * acting on a misunderstanding.
 */
export async function runPlanner(input: RunPlannerInput): Promise<PlannerResult> {
  const correlationId = newCorrelation();
  const ctx = { runId: input.runId, agent: 'planner' as const, correlationId };
  const started = Date.now();

  await eventPublisher.emit('run.planning.started', { goal: input.goal }, ctx);
  await eventPublisher.emit('agent.started', { agent: 'planner', stepIndex: null }, ctx);

  const org = await orgRepository.findById(input.orgId);
  const recipe = input.recipeId ? await recipeRepository.findById(input.recipeId) : null;

  const prompt = buildPlannerPrompt({
    goal: input.goal,
    mode: input.mode,
    budgetUsd: input.budgetMicroUsd / 1_000_000,
    maxSteps: env.MAX_PLAN_STEPS,
    allowedDomains: org?.allowedDomains ?? [],
    // Human corrections from previous runs of this recipe. This is the compounding loop:
    // one prompt field, and the product gets better the more it is used.
    recipeHints: recipe?.corrections ? JSON.stringify(recipe.corrections) : null,
  });

  const router = createRouter(new RunTelemetry(input.runId, null, correlationId));

  const { data: plan } = await router.call(
    {
      agent: 'planner',
      promptVersion: PLANNER_PROMPT_VERSION,
      system: prompt.system,
      user: prompt.user,
    },
    PlanSchema,
  );

  if (plan.refusal) {
    await eventPublisher.emit(
      'agent.finished',
      { agent: 'planner', durationMs: Date.now() - started, confidence: plan.confidence },
      ctx,
    );
    throw new PlannerRefusedError(plan.refusal);
  }

  // Steps are emitted one at a time so the canvas fills progressively rather than
  // appearing all at once — the user starts reading while the rest is still arriving.
  for (const step of plan.steps) {
    await eventPublisher.emit(
      'plan.step.proposed',
      {
        index: step.index,
        objective: step.objective,
        targetUrl: step.targetUrl,
        riskLevel: step.riskLevel,
        agentPath: [...step.agentPath],
        estimatedMs: step.estimatedSeconds * 1000,
        estimatedUsd: step.estimatedUsd,
        notes: step.notes,
      },
      ctx,
    );
  }

  await stepRepository.createMany(input.runId, plan.steps.map(toCreateStepInput));

  const planHash = hashPlan(plan);
  await runRepository.setPlanHash(input.runId, planHash);

  await eventPublisher.emit(
    'plan.completed',
    {
      stepCount: plan.steps.length,
      totalEstimatedUsd: plan.totalEstimatedUsd,
      planHash,
    },
    ctx,
  );
  await eventPublisher.emit(
    'agent.finished',
    { agent: 'planner', durationMs: Date.now() - started, confidence: plan.confidence },
    ctx,
  );

  logger.info(
    { runId: input.runId, steps: plan.steps.length, planHash: planHash.slice(0, 12) },
    'plan ready for approval',
  );

  return { plan, planHash, stepCount: plan.steps.length, refused: false };
}
