import { IDENTITY, JSON_ONLY } from './shared/index.js';

export const RECOVERY_PROMPT_VERSION = 'recovery.v2';

export interface RecoveryAttemptView {
  attempt: number;
  strategy: string;
  succeeded: boolean | null;
}

export interface RecoveryAgentInput {
  errorClass: string;
  errorMessage: string;
  humanMessage: string;
  /** Only the rungs still available: already-tried and unaffordable ones are removed. */
  availableStrategies: readonly string[];
  attempts: readonly RecoveryAttemptView[];
  pageDigest: string;
  currentUrl: string;
  stepObjective: string;
  budgetRemainingUsd: number;
}

const STRATEGY_DESCRIPTIONS: Record<string, string> = {
  retry_same: 'transient issue; the same action again after a backoff',
  wait_longer: 'content is probably still loading; extend the wait',
  rescroll_rescan: 'the element may be below the fold or lazily mounted',
  dismiss_overlay: 'a modal, cookie banner or consent wall is intercepting clicks',
  alternate_selector: 'target the same element by a different accessible property',
  alternate_route:
    'a different URL for the same information (sitemap, footer link, /plans vs /pricing)',
  switch_model: 'extraction failed on ambiguous content; try the other provider',
  decompose: 'the step was too broad; split it into smaller steps',
  skip_and_note: 'this datum is not obtainable; continue and record why',
  request_human: 'a human can resolve this in seconds and we cannot',
};

export function buildRecoveryPrompt(input: RecoveryAgentInput): { system: string; user: string } {
  const menu = input.availableStrategies
    .map((strategy) => `${strategy} — ${STRATEGY_DESCRIPTIONS[strategy] ?? 'available'}`)
    .join('\n');

  const system = `${IDENTITY}

You are RECOVERY. A step failed. Choose the next strategy.

<available_strategies>
${menu}
</available_strategies>

<rules>
1. Choose only from the list above. Strategies already tried for this failure, and any the
   remaining budget cannot afford, have already been removed — so the list is what is
   genuinely still open.
2. Prefer cheap strategies first; escalate only when the cheap ones are spent.
3. request_human is a legitimate FIRST choice for a CAPTCHA, a login, a payment, a 2FA
   prompt, a consent wall that resisted one dismissal, or any judgement call about the
   user's own data. Do not spend the user's money proving you cannot solve a CAPTCHA.
4. State the expected outcome concretely, so the system can tell afterwards whether the
   recovery actually worked rather than merely ran.
5. If you choose request_human, write the exact question to put in front of the person.
   "Something went wrong" is not a question.
</rules>

${JSON_ONLY}

<schema>
{
  "strategy": "one of the available strategies",
  "rationale": "why this one, in one or two sentences",
  "expectedOutcome": "what should be true if this works",
  "alternateUrl": "url or null — required when strategy is alternate_route",
  "humanQuestion": "question or null — required when strategy is request_human"
}
</schema>`;

  const history =
    input.attempts.length > 0
      ? input.attempts
          .map(
            (attempt) =>
              `attempt ${String(attempt.attempt)}: ${attempt.strategy} → ${
                attempt.succeeded === null ? 'unknown' : attempt.succeeded ? 'worked' : 'failed'
              }`,
          )
          .join('\n')
      : 'none';

  const user = `<step_objective>${input.stepObjective}</step_objective>
<error class="${input.errorClass}">
${input.errorMessage}
</error>
<history>
${history}
</history>
<current_url>${input.currentUrl}</current_url>
<budget_remaining_usd>${input.budgetRemainingUsd.toFixed(4)}</budget_remaining_usd>
<page_content>
${input.pageDigest}
</page_content>`;

  return { system, user };
}
