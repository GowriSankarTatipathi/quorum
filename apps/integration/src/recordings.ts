import type { RecordedCompletion } from '@quorum/ai';

/**
 * Responses shaped exactly as Claude returns them, for running the pipeline without a key.
 *
 * These are not stand-ins for the model's judgement — they are fixed inputs that let the
 * *orchestration* be exercised deterministically: schema validation, the grounding gate,
 * persistence, the queue, the Critic's cross-claim pass and the workbook. What they cannot
 * tell you is whether Claude actually produces valid JSON for these schemas or whether its
 * confidence is calibrated. Only a live run answers that, which is why the harness prefers
 * a real key whenever one is present.
 *
 * The Expensify figure is deliberately read on the annual basis: it is the defect the
 * Critic exists to catch, so a recorded run still exercises that path.
 */
const matchesAgent = (marker: string) => (request: { system: string }) =>
  request.system.includes(marker);

export const RECORDED_COMPLETIONS: RecordedCompletion[] = [
  {
    match: matchesAgent('You are the PLANNER'),
    respond: {
      kind: 'text',
      text: JSON.stringify({
        summary: 'Read the published pricing page and record each tier on a monthly basis.',
        steps: [
          {
            index: 0,
            objective: 'Extract pricing tiers from the vendor pricing page',
            targetUrl: 'http://127.0.0.1:4321/pricing.html',
            agentPath: ['browser', 'reasoning'],
            outputSchema: { plan: 'string', price_usd: 'number|null', period: 'string' },
            riskLevel: 'LOW',
            notes: 'The billing toggle may default to annual; confirm the period before reading.',
            estimatedSeconds: 20,
            estimatedUsd: 0.05,
          },
        ],
        allowedHosts: ['127.0.0.1'],
        totalEstimatedSeconds: 20,
        totalEstimatedUsd: 0.05,
        confidence: 0.92,
        refusal: null,
      }),
      usage: { inputTokens: 2_980, outputTokens: 1_140 },
    },
  },
  {
    // First browser turn: the toggle reads annual, so switch it before extracting.
    match: matchesAgent('You are the BROWSER agent'),
    times: 1,
    respond: {
      kind: 'text',
      text: JSON.stringify({
        reasoning:
          'The Annual option is pressed, so these figures are annual-billing rates. I will select Monthly before extraction so the numbers are comparable.',
        action: { type: 'click', ref: 5 },
        confidence: 0.93,
        injectionDetected: false,
        injectionExcerpt: null,
      }),
      usage: { inputTokens: 1_850, outputTokens: 140 },
    },
  },
  {
    match: matchesAgent('You are the BROWSER agent'),
    respond: {
      kind: 'text',
      text: JSON.stringify({
        reasoning: 'Monthly is now selected and the pricing grid is visible.',
        action: { type: 'extract_ready', note: 'monthly pricing visible' },
        confidence: 0.95,
        injectionDetected: false,
        injectionExcerpt: null,
      }),
      usage: { inputTokens: 1_910, outputTokens: 96 },
    },
  },
  {
    match: matchesAgent('You are the REASONING agent'),
    respond: {
      kind: 'text',
      text: JSON.stringify({
        claims: [
          {
            entity: 'Brex',
            field: 'price_per_user_monthly.essentials',
            value: 0,
            unit: 'USD/user/month',
            sourceText: '$0',
            confidence: 0.97,
            ambiguity: null,
            nullReason: null,
          },
          {
            entity: 'Brex',
            field: 'price_per_user_monthly.premium',
            value: 15,
            unit: 'USD/user/month',
            sourceText: '$15 /user/month',
            confidence: 0.96,
            ambiguity: null,
            nullReason: null,
          },
          {
            entity: 'Brex',
            field: 'price_per_user_monthly.enterprise',
            value: null,
            unit: null,
            sourceText: null,
            confidence: 0.62,
            ambiguity: 'The page says "Custom" rather than a figure.',
            nullReason: 'not_present',
          },
          {
            // Deliberately ungrounded: this quote is nowhere on the page, so the
            // grounding gate must quarantine it before it is ever stored.
            entity: 'Brex',
            field: 'price_per_user_monthly.platinum',
            value: 99,
            unit: 'USD/user/month',
            sourceText: '$99 /user/month Platinum',
            confidence: 0.88,
            ambiguity: null,
            nullReason: null,
          },
        ],
        note: null,
        injectionDetected: false,
        injectionExcerpt: null,
      }),
      usage: { inputTokens: 3_400, outputTokens: 620 },
    },
  },
  {
    match: matchesAgent('You are the VERIFICATION agent'),
    respond: {
      kind: 'text',
      text: JSON.stringify({
        independentReading: 15,
        verdict: 'CONFIRMED',
        rationale: 'The Premium tier shows $15 /user/month with Monthly selected.',
        confidence: 0.97,
      }),
      usage: { inputTokens: 900, outputTokens: 120 },
    },
  },
  {
    match: matchesAgent('You are the CRITIC'),
    respond: {
      kind: 'text',
      text: JSON.stringify({
        critiques: [
          {
            kind: 'COVERAGE_GAP',
            severity: 'WARNING',
            message:
              'Only Brex was extracted. The goal named a single vendor, so this is complete for the stated scope, but a comparison would need the other four.',
            claimIds: ['__FIRST_CLAIM__'],
            remedy: { action: 'accept', params: null },
          },
        ],
      }),
      usage: { inputTokens: 2_100, outputTokens: 260 },
    },
  },
];
