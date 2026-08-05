import { z } from 'zod';

/** Agents a plan step may route through. The Planner cannot invent a pipeline. */
export const PLAN_AGENTS = ['browser', 'reasoning', 'verification', 'formatter'] as const;

const AGENT_SYNONYMS: Record<string, typeof PLAN_AGENTS[number]> = {
  extraction: 'reasoning',
  extract: 'reasoning',
  extractor: 'reasoning',
};

export const PlanStepSchema = z.object({
  index: z.number().int().min(0),
  objective: z.string().min(8).max(400),
  /** Null for steps that do no browsing, such as normalising results. */
  targetUrl: z.string().url().nullable(),
  agentPath: z
    .array(
      z.preprocess((val) => {
        if (typeof val === 'string') {
          const mapped = AGENT_SYNONYMS[val.toLowerCase()];
          if (mapped) {
            console.warn(`[schema] agentPath normalised: "${val}" -> "${mapped}"`);
            return mapped;
          }
        }
        return val;
      }, z.enum(PLAN_AGENTS))
    )
    .min(1)
    .max(4),
  /**
   * The output contract for an extraction step. Declaring it upstream turns a downstream
   * ambiguity into an upstream commitment: the Reasoning agent is validated against it,
   * Verification uses it to know what to check, and the UI renders it as `Expects:`.
   */
  outputSchema: z
    .preprocess((val) => {
      if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
        const normalised: Record<string, unknown> = {};
        let changed = false;
        
        for (const [key, v] of Object.entries(val)) {
          if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
            // A weak model might nest objects, either as JSON Schema with a 'type' property
            // or just by wrapping fields in another object.
            const obj = v as Record<string, unknown>;
            if (typeof obj.type === 'string') {
              normalised[key] = obj.type;
              changed = true;
              console.warn(
                `[schema] outputSchema field "${key}" normalised from nested object to type "${obj.type}"`,
              );
            } else {
              const keysDesc = `{${Object.keys(obj).join(',')}}`;
              normalised[key] = keysDesc;
              changed = true;
              console.warn(
                `[schema] outputSchema field "${key}" normalised from nested object to description "${keysDesc}"`,
              );
            }
          } else {
            normalised[key] = v;
          }
        }
        return changed ? normalised : val;
      }
      return val;
    }, z.record(z.string(), z.string()))
    .nullable(),
  riskLevel: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  /** Difficulties predicted before the run starts, e.g. a demo-gated pricing page. */
  notes: z.string().max(400).nullable(),
  estimatedSeconds: z.number().int().min(1).max(600),
  estimatedUsd: z.number().min(0).max(50),
});

export type PlanStep = z.infer<typeof PlanStepSchema>;

export const PlanSchema = z
  .object({
    /** One sentence the human reads before approving. */
    summary: z.string().min(10).max(300),
    steps: z.array(PlanStepSchema).min(1).max(30),
    /** Hosts the run may navigate to. Enforced by the driver, not only by the model. */
    allowedHosts: z.array(z.string().min(3)).max(50),
    totalEstimatedSeconds: z.number().int().min(1),
    totalEstimatedUsd: z.number().min(0),
    confidence: z.number().min(0).max(1),
    /** Present when the goal cannot be planned as stated. */
    refusal: z.string().max(400).nullable(),
  })
  .superRefine((plan, ctx) => {
    // Indices must be dense and ordered: the executor addresses steps by position, and a
    // gap would silently skip work while still reporting completion.
    plan.steps.forEach((step, position) => {
      if (step.index !== position) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['steps', position, 'index'],
          message: `step index must equal its position (${String(position)})`,
        });
      }
    });
  });

export type Plan = z.infer<typeof PlanSchema>;

/** JSON-Schema-ish rendering embedded in the prompt, kept beside the Zod definition so
 *  the two cannot drift apart unnoticed. */
export const PLAN_SCHEMA_DESCRIPTION = JSON.stringify(
  {
    summary: 'string — one sentence describing what this plan will do',
    steps: [
      {
        index: 'integer, starting at 0, dense and ordered',
        objective: 'string — one navigable objective on one site',
        targetUrl: 'string url or null',
        agentPath: `array of ${PLAN_AGENTS.join(' | ')}`,
        outputSchema: 'object mapping field name to type, or null for non-extraction steps',
        riskLevel: 'LOW | MEDIUM | HIGH',
        notes: 'string or null — difficulties you predict for this step',
        estimatedSeconds: 'integer',
        estimatedUsd: 'number',
      },
    ],
    allowedHosts: 'array of hostnames this run may visit',
    totalEstimatedSeconds: 'integer',
    totalEstimatedUsd: 'number',
    confidence: 'number 0..1 — how confident you are that this plan achieves the goal',
    refusal: 'string or null — set when the goal cannot be planned as stated',
  },
  null,
  2,
);
