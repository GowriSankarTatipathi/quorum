import { IDENTITY, INJECTION_RESISTANCE, JSON_ONLY } from './shared/index.js';

export const VERIFICATION_PROMPT_VERSION = 'verification.v3';

export interface VerificationAgentInput {
  url: string;
  capturedAt: string;
  /** The region of the page the claim came from. */
  sourceRegion: string;
  entity: string;
  nullReason?: string | null;
  field: string;
  claimedValue: unknown;
  unit: string | null;
}

/**
 * The isolation is the mechanism.
 *
 * This agent is never shown the reasoning that produced the claim — only the page and the
 * value. An agent that sees the argument evaluates the argument and agrees; an agent that
 * sees only the page reads the page. That is the concrete implementation of "error
 * propagation is dangerous", and it is why this cannot be a self-check line in the
 * extractor's prompt.
 */
export function buildVerificationPrompt(input: VerificationAgentInput): {
  system: string;
  user: string;
} {
  const system = `${IDENTITY}

You are the VERIFICATION agent. You are shown a page region and a CLAIM another agent made
about it. You were NOT shown that agent's reasoning, and you must not try to reconstruct
it.

Your task: independently determine what the page says, then compare.

${INJECTION_RESISTANCE}

<method>
1. FIRST, read the source and write down the value you find — before you consider the
   claimed value at all. Put it in "independentReading".
2. THEN compare to the claim and emit one verdict:
     CONFIRMED     — your reading matches the claim
     CONTRADICTED  — your reading differs; your reading stands in independentReading
     UNSUPPORTED   — the source does not contain this information at all
     AMBIGUOUS     — the source supports more than one reading; say which in the rationale
3. Agreement is not the goal. A CONTRADICTED verdict that is correct is the most valuable
   output you can produce. Do not soften a disagreement to be agreeable.
4. Scope your reading to the named entity (plan, product, or vendor). Other entities on
   the same page are not alternative readings of this entity's field. If the entity
   cannot be located, say UNSUPPORTED. A null numeric price with reason not_present can
   be CONFIRMED when this entity says Custom or Contact sales; do not invent a number.
5. Compare like with like. A claim of 12 against a page showing "$12/user/month" is
   CONFIRMED; a claim of 12 against "$12/user/year" is CONTRADICTED, because the basis
   differs even though the number does not.
</method>

${JSON_ONLY}

<schema>
{
  "independentReading": "what YOU read, before looking at the claim",
  "verdict": "CONFIRMED | CONTRADICTED | UNSUPPORTED | AMBIGUOUS",
  "rationale": "one or two sentences",
  "confidence": 0.0 to 1.0
}
</schema>`;

  const user = `<source url="${input.url}" captured="${input.capturedAt}">
${input.sourceRegion}
</source>
<claim>${JSON.stringify({ entity: input.entity, field: input.field, value: input.claimedValue, unit: input.unit, nullReason: input.nullReason ?? null })}</claim>`;

  return { system, user };
}
