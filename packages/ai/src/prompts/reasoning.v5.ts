import {
  DOMAIN_PRIORS,
  IDENTITY,
  INJECTION_RESISTANCE,
  JSON_ONLY,
  UNCERTAINTY_CONTRACT,
} from './shared/index.js';

export const REASONING_PROMPT_VERSION = 'reasoning.v8';

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

  const groupedKnownFields = new Map<string, string[]>();
  for (const f of input.knownFields) {
    if (!groupedKnownFields.has(f.entity)) {
      groupedKnownFields.set(f.entity, []);
    }
    groupedKnownFields.get(f.entity)!.push(f.field);
  }

  const knownFieldsLines = Array.from(groupedKnownFields.entries()).map(([entity, fields]) => {
    return `- ${entity} (we have: ${fields.join(', ')})`;
  });

  const knownFieldsBlock =
    knownFieldsLines.length > 0
      ? `<already_extracted>\n${knownFieldsLines.join('\n')}\n</already_extracted>`
      : '<already_extracted>none</already_extracted>';

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

For lists such as features, return an array of the individual feature strings.
The sourceText must be a contiguous quote from the page, with its original line breaks;
it is NOT a joined or reformatted copy of the array. Never insert semicolons between
separate page lines. A numeric price may quote just its displayed price, such as "$8";
do not append a unit unless that unit is contiguous in the source text.

For lists such as features, quote a contiguous block exactly as it appears in the
provided page text, including intervening labels if necessary. Do not join separate
snippets with invented commas or semicolons. Extract every requested field; do not
replace missing feature extraction with a verification_summary claim.

Quote enough to be identifiable — "$12 /user/month", not "12".
</provenance>

<rules>
1. One claim per (entity, field). Do not merge two vendors into one row.
   Use the exact field names in <expected_fields>; do not rename them or substitute a summary.
   Report each requested field for every relevant entity, or null with a specific reason.
2. Record units exactly as the page states them. If pricing is annual, say so in "unit".
3. "Custom", "Contact sales", "Let's talk" are not numbers. Return null with
   nullReason "not_present".
4. Do not compute, convert or normalise. Report what the page says; a later agent
   normalises, and it can only do that correctly if you did not round first.
5. If the page contains none of the expected fields, return an empty claims array and
   explain in "note". An empty answer is a real answer.
6. <already_extracted> lists the entities and fields we successfully captured in previous steps.
   - Do NOT extract the specific fields we already have for these entities.
   - You MUST extract any OTHER expected fields for these entities that we do not have yet (e.g., if we have 'plan_name' but not 'price', you must extract 'price').
   - For any NEW entities not listed, extract ALL expected fields.
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
