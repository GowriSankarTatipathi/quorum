import { PrismaClient, Prisma } from '@prisma/client';

/**
 * Deterministic development seed.
 *
 * Reproduces the flagship benchmark from the design document — a five-site competitor
 * pricing sweep — including the failure it is built to catch: Expensify's price read
 * from the annual toggle while the others are monthly. Seeding the *interesting* state
 * rather than empty tables means the Critic surface, the provenance columns and the
 * approval gate can all be exercised before a single agent exists.
 *
 * Idempotent: re-running replaces the demo workspace rather than accumulating copies.
 */
const prisma = new PrismaClient();

const ORG_SLUG = 'chen-cpa-demo';
const OWNER_EMAIL = 'maya@chen-cpa.demo';

interface SeedTier {
  entity: string;
  plan: string;
  price: number | null;
  confidence: number;
  sourceUrl: string;
  sourceText: string;
  /** True for the claim deliberately read on the wrong billing basis. */
  annualBasis?: boolean;
  nullReason?: string;
}

const TIERS: SeedTier[] = [
  {
    entity: 'Ramp',
    plan: 'Free',
    price: 0,
    confidence: 0.98,
    sourceUrl: 'https://ramp.com/pricing',
    sourceText: '$0 /user/month',
  },
  {
    entity: 'Ramp',
    plan: 'Plus',
    price: 15,
    confidence: 0.96,
    sourceUrl: 'https://ramp.com/pricing',
    sourceText: '$15 /user/month',
  },
  {
    entity: 'Ramp',
    plan: 'Enterprise',
    price: null,
    confidence: 0.61,
    sourceUrl: 'https://ramp.com/pricing',
    sourceText: 'Custom',
    nullReason: 'not_present',
  },
  {
    entity: 'Brex',
    plan: 'Essentials',
    price: 0,
    confidence: 0.97,
    sourceUrl: 'https://brex.com/pricing',
    sourceText: '$0',
  },
  {
    entity: 'Brex',
    plan: 'Premium',
    price: 12,
    confidence: 0.95,
    sourceUrl: 'https://brex.com/pricing',
    sourceText: '$12 /user/month',
  },
  {
    entity: 'Navan',
    plan: 'Standard',
    price: 15,
    confidence: 0.93,
    sourceUrl: 'https://navan.com/pricing',
    sourceText: '$15 per user per month',
  },
  {
    entity: 'Airbase',
    plan: 'Growth',
    price: 25,
    confidence: 0.88,
    sourceUrl: 'https://airbase.com/pricing',
    sourceText: '$25/user/mo',
  },
  {
    entity: 'Expensify',
    plan: 'Collect',
    price: 5,
    confidence: 0.94,
    sourceUrl: 'https://expensify.com/pricing',
    sourceText: '$5 /user/month',
    annualBasis: true,
  },
];

async function main(): Promise<void> {
  process.stdout.write('seeding demo workspace…\n');

  const existing = await prisma.org.findUnique({ where: { slug: ORG_SLUG } });
  if (existing) {
    // Cascades remove every run, step, claim and event beneath it.
    await prisma.org.delete({ where: { id: existing.id } });
    process.stdout.write('  removed previous demo workspace\n');
  }

  const org = await prisma.org.create({
    data: {
      name: 'Chen CPA (demo)',
      slug: ORG_SLUG,
      allowedDomains: ['ramp.com', 'brex.com', 'expensify.com', 'navan.com', 'airbase.com'],
      requireApprovalAbove: 3,
      maxApprovalTrustLevel: 4,
    },
  });

  const owner = await prisma.user.create({
    data: {
      orgId: org.id,
      email: OWNER_EMAIL,
      name: 'Maya Chen',
      role: 'OWNER',
      emailVerified: new Date(),
    },
  });

  // A second member with approval authority explicitly revoked — the contractor case
  // that motivates modelling approval separately from role.
  await prisma.user.create({
    data: {
      orgId: org.id,
      email: 'contractor@chen-cpa.demo',
      name: 'Sam Reed',
      role: 'MEMBER',
      approvalAuthority: 'REVOKED',
    },
  });

  const run = await prisma.run.create({
    data: {
      userId: owner.id,
      orgId: org.id,
      goal: 'Get the pricing tiers for Ramp, Brex, Expensify, Navan and Airbase — plan name, monthly price per user, and what is in the free tier.',
      mode: 'BALANCED',
      status: 'COMPLETED',
      planHash: 'seed-plan-hash',
      budgetUsd: '0.5000',
      spentUsd: '0.4021',
      inputTokens: 42_180,
      outputTokens: 6_940,
      startedAt: new Date(Date.now() - 240_000),
      endedAt: new Date(Date.now() - 60_000),
    },
  });

  const entities = [...new Set(TIERS.map((t) => t.entity))];
  const steps = await prisma.$transaction([
    prisma.step.create({
      data: {
        runId: run.id,
        index: 0,
        objective: 'Resolve pricing URLs for 5 companies',
        agentPath: ['planner'],
        riskLevel: 'LOW',
        status: 'DONE',
        actualMs: 3_100,
        estimatedUsd: '0.0100',
      },
    }),
    ...entities.map((entity, i) =>
      prisma.step.create({
        data: {
          runId: run.id,
          index: i + 1,
          objective: `Extract pricing tiers — ${entity.toLowerCase()}.com`,
          targetUrl: `https://${entity.toLowerCase()}.com/pricing`,
          agentPath: ['browser', 'reasoning'],
          outputSchema: { plan: 'string', price_usd: 'number|null', period: 'string' },
          riskLevel: entity === 'Airbase' ? 'MEDIUM' : 'LOW',
          notes: entity === 'Airbase' ? 'Pricing may be gated behind "Request a demo".' : null,
          status: 'DONE',
          actualMs: 18_000 + i * 900,
          estimatedUsd: '0.0500',
        },
      }),
    ),
  ]);

  const stepByEntity = new Map(entities.map((e, i) => [e, steps[i + 1]!]));

  for (const tier of TIERS) {
    const step = stepByEntity.get(tier.entity)!;
    await prisma.claim.create({
      data: {
        stepId: step.id,
        entity: tier.entity,
        field: `price_per_user_monthly.${tier.plan.toLowerCase()}`,
        value: tier.price as Prisma.InputJsonValue,
        unit: tier.annualBasis ? 'USD/user/month (billed annually)' : 'USD/user/month',
        sourceUrl: tier.sourceUrl,
        sourceText: tier.sourceText,
        screenshotKey: `seed/${tier.entity.toLowerCase()}-pricing.jpg`,
        extractedBy: 'claude-sonnet-4-5',
        promptVersion: 'reasoning.v4',
        confidence: tier.price === null ? '0.610' : tier.confidence.toFixed(3),
        status: tier.price === null ? 'AMBIGUOUS' : 'VERIFIED',
        nullReason: tier.nullReason ?? null,
      },
    });
  }

  // The demo's money moment: individually correct claims, collectively incomparable.
  await prisma.critique.create({
    data: {
      runId: run.id,
      kind: 'UNIT_MISMATCH',
      severity: 'BLOCKING',
      message:
        "Four sources report monthly per-seat pricing. Expensify's $5 appears to be the annual-billing rate. Comparing these directly would understate Expensify by ~40%.",
      claimIds: [],
      remedy: { action: 're_extract', params: { entity: 'Expensify', period: 'monthly' } },
    },
  });

  await prisma.llmCall.createMany({
    data: [
      {
        runId: run.id,
        agent: 'planner',
        model: 'claude-opus-4',
        promptVersion: 'planner.v3',
        inputTokens: 3_000,
        outputTokens: 1_200,
        costUsd: '0.135000',
        latencyMs: 3_100,
      },
      {
        runId: run.id,
        agent: 'browser',
        model: 'claude-sonnet-4-5',
        promptVersion: 'browser.v2',
        inputTokens: 22_000,
        outputTokens: 1_800,
        costUsd: '0.093000',
        latencyMs: 21_400,
      },
      {
        runId: run.id,
        agent: 'reasoning',
        model: 'claude-sonnet-4-5',
        promptVersion: 'reasoning.v4',
        inputTokens: 12_500,
        outputTokens: 2_600,
        costUsd: '0.076500',
        latencyMs: 14_200,
      },
      {
        runId: run.id,
        agent: 'verification',
        model: 'claude-haiku-4-5',
        promptVersion: 'verification.v2',
        inputTokens: 1_680,
        outputTokens: 340,
        costUsd: '0.003380',
        latencyMs: 2_900,
      },
      {
        runId: run.id,
        agent: 'critic',
        model: 'claude-opus-4',
        promptVersion: 'critic.v3',
        inputTokens: 3_000,
        outputTokens: 1_000,
        costUsd: '0.120000',
        latencyMs: 4_800,
      },
    ],
  });

  const claimCount = await prisma.claim.count({ where: { step: { runId: run.id } } });
  process.stdout.write(`  workspace ${org.slug}\n`);
  process.stdout.write(`  owner     ${owner.email}\n`);
  process.stdout.write(
    `  run       ${run.id} (${String(claimCount)} claims, 1 blocking critique)\n`,
  );
  process.stdout.write('seed complete.\n');
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`seed failed: ${String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
