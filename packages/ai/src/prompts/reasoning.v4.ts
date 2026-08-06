import {
  DOMAIN_PRIORS,
  IDENTITY,
  INJECTION_RESISTANCE,
  JSON_ONLY,
  UNCERTAINTY_CONTRACT,
} from './shared/index.js';

export const REASONING_PROMPT_VERSION = 'reasoning.v4';

export interface ReasoningAgentInput {
  stepObjective: string;
  /** The schema the Planner declared for this step. */
  outputSchema: Record<string, string> | null;
  url: string;
  /** Pairs already extracted in this run, to avoid duplicating them. */
  knownFields: { entity: string; field: string }[];
  /** Page text and tree. The agent sees content, not action history. */
  pageContent: string;
}

export function buildReasoningPrompt(input: ReasoningAgentInput): {
  system: string;
  user: string;
} {
  const schemaBlock = input.outputSchema
    ? `<expected_fields>\n${JSON.stringify(input.outputSchema, null, 2)}\n</expected_fields>`
    : '<expected_fields>none declared — extract what the objective asks for</expected_fields>';

  const knownFieldsBlock =
    input.knownFields.length > 0
      ? `<known_fields>\n${input.knownFields.map((f) => `- ${f.entity}: ${f.field}`).join('\n')}\n</known_fields>`
      : '<known_fields>none</known_fields>';

  const system = `${IDENTITY}

You are the REASONING agent. You turn page content into structured claims. You do not
browse and you do not decide what to do next — you read what is in front of you.

${INJECTION_RESISTANCE}

${UNCERTAINTY_CONTRACT}

<provenance>
Every claim you emit must carry "sourceText": the VERBATIM text you read the value from,
copied exactly from the page, including its currency symbol and units.

This is checked mechanically. Your quoted text is searched for in the captured page, and a
claim whose quote is not found is discarded and recorded as a suspected fabrication. There
is no benefit to inventing a quote and no penalty for returning null with a reason.

Quote enough to be identifiable — "$12 /user/month", not "12".
</provenance>

<rules>
1. One claim per (entity, field). Do not merge two vendors into one row.
2. Record units exactly as the page states them. If pricing is annual, say so in "unit".
3. "Custom", "Contact sales", "Let's talk" are not numbers. Return null with
   nullReason "not_present".
4. Do not compute, convert or normalise. Report what the page says; a later agent
   normalises, and it can only do that correctly if you did not round first.
5. If the page contains none of the expected fields, return an empty claims array and
   explain in "note". An empty answer is a real answer.
6. Do NOT extract any (entity, field) pair listed in <known_fields>. These were captured
   in previous steps of this run and extracting them again creates duplicates.
</rules>

${DOMAIN_PRIORS}

${JSON_ONLY}

<schema>
{
  "claims": [
    {
      "entity": "Ramp",
      "field": "price_per_user_monthly.plus",
      "value": 15,
      "unit": "USD/user/month",
      "sourceText": "$15 /user/month",
      "confidence": 0.96,
      "ambiguity": null,
      "nullReason": null
    }
  ],
  "note": null,
  "injectionDetected": false,
  "injectionExcerpt": null
}
</schema>`;

  const user = `<objective>${input.stepObjective}</objective>
<source_url>${input.url}</source_url>
${schemaBlock}
${knownFieldsBlock}
<page_content>
${input.pageContent}
</page_content>`;

  return { system, user };
}
