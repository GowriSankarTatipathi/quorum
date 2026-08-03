# Architecture

Everything below has been executed. Latencies are measured from a real run on 2026-08-03
against Chromium 151, PostgreSQL 18.4, Redis 6.2 and filesystem storage.

## Runtime

```
                    ┌──────────────────────────────────────────────┐
   browser ────────▶│  Next.js 15 (Vercel)                         │
                    │  RSC shell + one client island               │
                    │  Zustand store = projection of the event log │
                    └───────┬──────────────────────────┬───────────┘
                       REST │                          │ WebSocket (cursor replay)
                            ▼                          ▼
                    ┌──────────────────────────────────────────────┐
                    │  Fastify gateway (Fly, 2+ stateless)         │
                    │  Zod → runtime validation + types + OpenAPI  │
                    │  jose bearer verify · denylist · RBAC        │
                    └───────┬──────────────────────────┬───────────┘
                   enqueue  │                          │ subscribe
                            ▼                          ▼
              ┌─────────────────────────┐   ┌────────────────────────┐
              │ Redis (Upstash)         │   │ PostgreSQL (Neon)      │
              │ BullMQ · pub/sub ·      │◀─▶│ runs · claims · events │
              │ approval barriers       │   │ llm_calls · approvals  │
              └───────────┬─────────────┘   └────────────────────────┘
                          │ run.plan / run.execute
                          ▼
   ┌───────────────────────────────────────────────────────────────────┐
   │  Worker (Fly, scale-to-zero)                                      │
   │                                                                   │
   │   XState machine ── pause/takeover/approval are transitions       │
   │        │                                                          │
   │   Planner ─▶ Browser ─▶ Reasoning ─▶ Verification ─▶ Critic       │
   │                 │            │             │                      │
   │                 │            │             └─ isolated context    │
   │                 │            └─ assertGrounded() ── no model      │
   │                 └─ Trust Ladder gate ── pure function             │
   │                                                                   │
   │   LlmRouter          BrowserDriver          ArtifactStore         │
   │   ├ Anthropic        ├ Playwright (local)   ├ Filesystem (dev)    │
   │   ├ OpenAI           ├ Browserbase (prod)   └ R2 / S3 (prod)      │
   │   └ Fixture (CI)     └ Fixture (CI)                               │
   └───────────────────────────────────────────────────────────────────┘
```

## The three load-bearing ideas

**Claims, not answers.** A `Claim` row carries the source URL, the verbatim text it was
read from, a screenshot key, the model, the prompt version and a calibrated confidence.
`assertGrounded()` requires that quoted text to appear in the captured page — a
deterministic check with no model in the loop, which is why it catches fabrication with
certainty. In the validated run it quarantined a claim of `$99` whose quote was nowhere on
the page.

**The Trust Ladder.** Actions are classified by _reversibility_ by a pure, 100%-covered
function that no page content and no model output can influence. L0 read and L1 navigate
are free; L3 commit is gated in **every** autonomy mode. Verified against live elements: a
billing toggle classifies L2 (free), a form submit L3 (gated).

**Recovery is a subsystem.** A typed taxonomy of 33 error classes maps each failure to an
ordered ladder of strategies with costs. Already-tried and unaffordable rungs are filtered
before the Recovery agent sees them, and the injection response is executed by the runtime
rather than offered to the component an injection targets. The terminal rung is always a
human.

## Request lifecycle

```
POST /v1/runs
  └─ Zod validate · clamp budget to workspace ceiling · INSERT run
  └─ BullMQ enqueue jobId=plan-{runId}          idempotent, 4ms round trip
       └─ Planner ── Opus ── Zod PlanSchema ── steps INSERTed ── planHash
            └─ status AWAITING_APPROVAL          no browser has started
POST /v1/runs/:id/plan/approve  { planHash }
  └─ hash must match what was rendered           closes the TOCTOU gap
  └─ enqueue run.execute
       └─ session from pool (cap 4/worker, ~400 MB each)
       └─ per step: Browser proposes → gate → execute → snapshot diff
            └─ extract_ready ⇒ Reasoning ⇒ grounding ⇒ Verification (sampled)
       └─ Critic over every claim at once
       └─ COMPLETED, or PAUSED if a blocking finding is open
```

Every step: **INSERT into Postgres, then PUBLISH to Redis.** A Redis failure costs live
latency and never loses history; the database is the replay source of truth.

## Measured

|                                   |                                                               |
| --------------------------------- | ------------------------------------------------------------- |
| Queue round trip                  | 4 ms                                                          |
| Chromium launch                   | 153 ms warm · 1 455 ms cold                                   |
| Page snapshot (CDP + DOM resolve) | 16–36 ms                                                      |
| Compressed tree                   | 16 nodes, **492 chars** (~125 tokens vs 50–200k for raw HTML) |
| Approval barrier wake (BLPOP)     | 7 ms after the decision                                       |
| Workbook build                    | 32 ms                                                         |
| Modelled run cost                 | ~$0.40 for a five-site sweep; ~$0.26 with cache hits          |

## Why the seams are where they are

| Seam                      | Reason                                                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Gateway ≠ worker          | I/O-bound on connections vs memory-bound on Chromium. Genuinely different scaling axes; that is what justifies two deployables rather than four. |
| `BrowserDriver` interface | Free local development, vendor-switching insurance, and a fixture driver that makes the pipeline testable in CI with no browser.                 |
| `LlmProvider` port        | Cross-provider fallback survives both a vendor outage and a model confused by one page. Recorded mode means CI never depends on a vendor.        |
| `ArtifactStore` port      | Filesystem locally with no credentials; R2 in production for zero egress.                                                                        |
| Repositories over Prisma  | Application code never touches the generated client, so `Decimal` and `Date` are normalised at one boundary.                                     |
| Verification isolated     | An agent shown the reasoning evaluates an argument and agrees. The isolation _is_ the mechanism.                                                 |

## Where it breaks first

1. **~50 concurrent runs** — provider rate limits. Fix: keyed routing pool, fair scheduling per org.
2. **~500 concurrent** — Postgres write throughput on `Event`. Fix: batch inserts, then partition by month, then ClickHouse for events only.
3. **~5 000 runs/day** — screenshot storage. Fix: the 30-day thumbnail policy plus perceptual dedup of near-identical frames.

Each is 1–3 days _when needed_ and two weeks of speculative complexity today. Knowing the
order is the deliverable.
