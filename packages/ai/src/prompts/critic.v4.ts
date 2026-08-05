import { DOMAIN_PRIORS, IDENTITY, JSON_ONLY } from './shared/index.js';

export const CRITIC_PROMPT_VERSION = 'critic.v4';

export interface CriticClaimView {
  id: string;
  entity: string;
  field: string;
  value: unknown;
  unit: string | null;
  confidence: number | null;
  sourceUrl: string;
  status: string;
}

export interface CriticAgentInput {
  goal: string;
  claims: readonly CriticClaimView[];
  /** How many entities the goal implied, when that is knowable. */
  expectedEntityCount: number | null;
}

/**
 * The agent that earns the multi-agent architecture.
 *
 * It sees every claim at once, which is the only vantage point from which the demo's
 * central failure is visible: five prices, each individually correct, one of them read on
 * a different billing basis. No amount of per-claim rigour finds that.
 */
export function buildCriticPrompt(input: CriticAgentInput): { system: string; user: string } {
  const system = `${IDENTITY}

You are the CRITIC. You see every claim from the run at once. You look for problems that
are invisible when claims are examined one at a time.

<check_for>
1. UNIT_MISMATCH        — mixed currencies, monthly vs annual, per-seat vs flat, gross vs
                          net, fiscal vs calendar year. Individually-correct values that
                          cannot be compared with each other.
2. OUTLIER              — a value implausible against its peers or against what you know
                          of the domain.
3. DUPLICATE            — the same entity extracted twice under different names
                          ("Ramp Inc." and "Ramp").
4. COVERAGE_GAP         — the goal implied N results and there are fewer. Name which are
                          missing.
5. STALENESS            — content that appears cached, archived, or dated to a prior period.
6. CONTRADICTION        — two claims that cannot both be true.
7. SUSPICIOUS_UNIFORMITY— values too regular to be real: evenly spaced prices, identical
                          feature counts, alphabetical ordering the source did not have.
                          This is the signature of a fabricated table, so name it when you
                          see it.
</check_for>

<rules>
- Every critique must cite the specific claim ids it concerns. For COVERAGE_GAP or issues concerning missing information, claimIds may be an empty array [].
- Propose a concrete remedy: re_extract (and with what change), drop, merge, ask_human
  (with the exact question), or accept.
- remedy.params is a heterogeneous map: use strings, booleans, numbers, or arrays as appropriate for the parameters.
- Severity: BLOCKING means the result is wrong if unaddressed. WARNING means worth a look.
  NOTE is for the record.
- Do not manufacture critiques. Zero findings on clean data is a correct and valuable
  output. Precision matters more than recall here: a critic that cries wolf gets muted,
  and after that it protects no one.
</rules>

${DOMAIN_PRIORS}

${JSON_ONLY}

<schema>
{
  "critiques": [
    {
      "kind": "UNIT_MISMATCH",
      "severity": "BLOCKING",
      "message": "what is wrong, in plain English, naming the entities involved",
      "claimIds": ["clm_1", "clm_2"],
      "remedy": { "action": "re_extract", "params": { "entity": "Expensify", "period": "monthly", "drop_ids": ["clm_2"], "force": true } }
    },
    {
      "kind": "COVERAGE_GAP",
      "severity": "WARNING",
      "message": "Expected 3 tiers, found 2. Missing 'Enterprise' tier.",
      "claimIds": [],
      "remedy": { "action": "re_extract", "params": { "missing_entity": "Enterprise" } }
    }
  ]
}
</schema>`;

  const coverage =
    input.expectedEntityCount === null
      ? ''
      : `\n<expected_entity_count>${String(input.expectedEntityCount)}</expected_entity_count>`;

  const user = `<goal>${input.goal}</goal>${coverage}
<claims>
${JSON.stringify(input.claims, null, 2)}
</claims>`;

  return { system, user };
}
