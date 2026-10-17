# QUORUM

**An autonomous browser agent that never acts alone.**

**Live:** https://quorum-gowri.duckdns.org · **Demo site the agent browses:** https://quorum-fixtures.vercel.app/pricing

QUORUM turns a plain-English goal into a plan, executes it in a real browser through
seven specialised agents, and hands back results you can trace to the exact pixel on
the exact page. Anything irreversible stops and asks a human first.

Three ideas carry the product:

1. **Claims, not answers.** Every extracted value is stored with its source URL, the
   verbatim text it was read from, a screenshot, the model that produced it and a
   confidence score — or an explicit "not reported" when the model declined to give one.
   A number you cannot trace back to a pixel is not a result, it is a rumour.
2. **The Trust Ladder.** Actions are classified by _reversibility_ by a pure,
   fully-tested function no model output can influence. Reading and paginating are free;
   submitting a form is gated in every autonomy mode. The autonomy dial controls
   friction, never authority.
3. **Recovery is a subsystem, not a `try/catch`.** A typed error taxonomy maps each
   failure class to an ordered ladder of strategies with known costs, and the terminal
   rung is always a human — not a failure.

Every non-obvious decision in this repository carries an inline comment explaining the
_why_, so the code is readable without a design document open beside it.

---

## Status

Deployed and verified end to end in production against live Claude, a real Chromium, a
managed PostgreSQL, Redis and S3-compatible object storage.

| | |
| --- | --- |
| Live | Web, API and worker on a single AWS EC2 instance behind Caddy; fixtures on Vercel |
| Data | Neon PostgreSQL, Upstash Redis, Supabase S3-compatible storage |
| Models | Claude Opus 4.5 (planner, critic), Sonnet 4.5 (browser, reasoning), Haiku 4.5 (verification) |
| Verified journey | sign in → goal → plan → **approval gate** → browse → extract → ground → verify → critique → export |
| Typecheck / lint / build | clean across 15 packages and apps |

A representative production run against the fixture site: 8–15 claims, all plan names
verified at 1.00 confidence, grounding discarding fabricated values, the verifier
contradicting an over-claimed value with its own independent reading, and the critic
raising a **blocking** unit mismatch that paused the run for a human. About 30 seconds
of model time and roughly $0.20.

**Known gaps.** Browserbase has never been connected — the managed-browser driver exists
behind the same `BrowserDriver` port but is untested. Confidence calibration is asserted,
not measured; there is no ECE test. The verifier's catch rate has not been measured
against planted errors.

Documentation: [architecture](docs/ARCHITECTURE.md) · [deployment](docs/DEPLOYMENT.md) ·
[demo](docs/DEMO.md) · [troubleshooting](docs/TROUBLESHOOTING.md) · [RAG prototype](docs/RAG.md)

---

## How a run actually works

1. **You state a goal in English.** No form, no schema, no scripting.
2. **The planner drafts steps** and attaches its own uncertainty to each one ("may be
   gated or require a demo request"), plus a cost estimate and a `planHash`.
3. **The run stops.** Status becomes `AWAITING_APPROVAL` and nothing touches the network
   until a human approves the plan. The gap between those two timestamps is visible in
   the event log — that pause is the product's central claim.
4. **A real Chromium opens.** The browser agent decides from a compressed accessibility
   snapshot, not raw HTML, and addresses elements by numeric ref rather than by a
   model-generated selector.
5. **Every action is classified before it happens.** A click on a billing toggle is L2 and
   proceeds; anything irreversible is gated regardless of autonomy mode. A click that
   changes nothing is an error, detected by comparing content hashes around the action.
6. **Extraction produces claims, not values.** Each carries the verbatim source text.
7. **Grounding runs with no model in the loop.** If the quoted text is not in the captured
   page, the value is discarded — deterministic, zero tokens, and it fires on most runs.
8. **Verification re-reads the page blind.** The verifier never sees the extractor's
   reasoning, and declares its `independentReading` before its `verdict`.
9. **The critic reviews the whole result set** and can block: duplicate extractions, unit
   mismatches across tiers, coverage gaps against the stated goal.
10. **Export carries the evidence.** An `.xlsx` with Results, **Provenance** (source URL,
    verbatim text, screenshot key, model, prompt version per claim), Findings, and a
    description of the run.

Throughout, the interface is a pure projection of the event log — the same `applyEvent`
reducer drives live streaming and replay, so the audit trail cannot drift from what you
watched.

---

## Requirements

- Node.js 22 (`.nvmrc`)
- pnpm 9.15+ (`corepack enable && corepack prepare pnpm@9.15.9 --activate`)
- Docker (for Postgres, Redis, MinIO and Mailpit)
- Chromium for local browser runs:
  `pnpm --filter @quorum/browser exec playwright-core install chromium`
  (not needed for unit tests, which use the fixture driver)

## Install

```bash
git clone <repo> quorum && cd quorum
corepack enable
pnpm install
cp .env.example .env.local
```

Then generate the three secrets in `.env.local`. They are deliberately distinct, so
compromising one does not imply the others:

```bash
openssl rand -base64 48   # AUTH_SECRET             — encrypts the session cookie
openssl rand -base64 48   # JWT_SECRET              — signs API access tokens
openssl rand -base64 48   # ARTIFACT_SIGNING_SECRET — signs artifact URLs
```

At least one sign-in method must be configured or the web app refuses to start, rather
than rendering a sign-in page whose buttons cannot work. Magic links work out of the box
against the local Mailpit container; Google OAuth needs credentials with the redirect URI
`http://localhost:3000/api/auth/callback/google`.

Note `DATABASE_URL` defaults to port **5433**, not 5432 — macOS developers commonly have a
local PostgreSQL on 5432 and the container would be silently shadowed by it.

## Run

```bash
docker compose up -d           # postgres, redis, minio, mailpit
pnpm db:generate               # generate the Prisma client
pnpm db:deploy                 # apply migrations
pnpm db:seed                   # optional: a completed demo run to look at
pnpm dev                       # all apps, in parallel
```

| Target | URL | What it is |
| --- | --- | --- |
| Web | http://localhost:3000 | The product |
| API | http://localhost:3001 | Fastify gateway |
| API docs | http://localhost:3001/docs | OpenAPI UI, generated from the Zod route schemas |
| Fixtures | http://localhost:3002/pricing | Deterministic page reproducing failures real sites exhibit |
| Mailpit | http://localhost:8025 | Sign-in links land here |
| Worker | — | BullMQ consumer; logs to stdout |

A goal to try:

```
Go to http://localhost:3002/pricing and extract the plan name and the monthly price per user for every tier.
```

The fixture defaults its billing toggle to **annual**. Watching the agent notice that and
switch it to monthly before extracting is the behaviour the product exists to demonstrate.

The signed-in app includes a documentation assistant at `/knowledge`. It retrieves from
curated QUORUM product docs, uses allowlisted read-only search tools, validates source
citations, and abstains when it cannot support an answer; see [the RAG guide](docs/RAG.md).

## End-to-end run

One command stands up the dependencies and drives the entire pipeline against a real
Chromium, PostgreSQL, Redis and artifact storage:

```bash
pnpm e2e
```

Without a key it replays recorded model responses and says so. `loadLlmConfig()` reports
`live` the moment `ANTHROPIC_API_KEY` is present and `recorded` when it is not, and prints
which at startup along with the provenance of every setting — whether it came from the
environment, the file, or a schema default. `QUORUM_LLM_MODE=recorded` forces replay even
with a key, which is what CI uses so a pull request never depends on a vendor being up or
spends money.

Narrower probes, for isolating a failure:

```bash
pnpm e2e:browser   # real Chromium: snapshot, refs, DOM facts, screenshot
pnpm e2e:actions   # Trust Ladder on live elements, no-op detection, gating
pnpm e2e:db        # migrations against a real PostgreSQL, cascade deletes
pnpm e2e:queue     # BullMQ round-trip, pub/sub, the BLPOP approval barrier, storage
```

## Verify

```bash
pnpm typecheck      # tsc across every package and app
pnpm lint           # eslint 9 flat config, type-aware rules
pnpm test           # vitest
pnpm build          # tsc -b for services, next build for apps
pnpm format:check   # prettier
```

Health probes, once the API is running:

```bash
curl -s localhost:3001/healthz | jq   # liveness  — must not touch dependencies
curl -s localhost:3001/readyz  | jq   # readiness — checks Postgres and Redis
```

`/healthz` deliberately does not check dependencies: if it did, a brief database blip
would make the orchestrator kill healthy processes and turn a partial outage into a total
one. `/readyz` does check them, so a degraded instance is drained instead.

## Layout

```
apps/
  web/        Next.js 15 App Router — the product surface
  api/        Fastify gateway: REST + WebSocket, stateless, scales on connections
  worker/     BullMQ consumer: owns the agent runtime and browsers, scales on RAM
  fixtures/   Deterministic test website (annual-default pricing toggle, consent wall)
  integration/ Headless harness that drives the whole pipeline without the UI
packages/
  core/       Domain: enums, branded ids, action vocabulary, Trust Ladder, disposition
  events/     The event taxonomy — the contract between worker, gateway, DB and UI
  ai/         Model registry, prompts, BM25 retrieval, and exact cost accounting
  browser/    The BrowserDriver port every backend implements
  db/         Prisma schema, migrations, typed repositories
  storage/    Artifact store resolution: S3-compatible or filesystem
  export/     Workbook and CSV generation with provenance
  env/        The shared environment schema every service extends
  ui/         Design tokens and owned shadcn-derived components
  config/     Shared tsconfig and ESLint presets
```

Two deployables, not microservices: the gateway is I/O-bound on connections and the
worker is memory-bound on Chromium (~400 MB per context). Those are genuinely different
scaling profiles, which is what justifies a split. Splitting further would add network
hops to solve a problem we do not have.

## Deployment

Live topology:

| Service | Where | Notes |
| --- | --- | --- |
| Web | AWS EC2 (Docker) | Next.js standalone. Chosen over serverless because the app is WebSocket-heavy and the Prisma query engine is a native binary that serverless bundlers do not trace reliably. |
| API | AWS EC2 (Docker) | Fastify + WebSocket; needs long-lived connections |
| Worker | AWS EC2 (Docker) | Chromium OOMs below ~2 GB, and `shm_size` must be raised or the renderer dies mid-page |
| TLS + routing | Caddy | Automatic Let's Encrypt for both hostnames; the API proxy holds the WebSocket open for an hour, since the run stream is idle between agent steps |
| Fixtures | Vercel | Static demo site |
| PostgreSQL | Neon | Pooled connection needs `?pgbouncer=true` for Prisma |
| Redis | Upstash | `rediss://` (TLS); eviction must be `noeviction` for BullMQ |
| Artifacts | Supabase S3 | Any S3-compatible endpoint; `R2_REGION` must be the real region, `auto` only works for Cloudflare R2 |

The whole application is three containers plus Caddy on one box, defined in
[`deploy/aws/docker-compose.prod.yml`](deploy/aws/docker-compose.prod.yml). It holds no
state — Postgres, Redis and object storage are all managed elsewhere — so the instance is
disposable and rebuildable from the repo:

```bash
bash deploy/aws/bootstrap.sh                        # Docker + swap, once
cp deploy/aws/env.example deploy/aws/.env           # then fill it in
docker compose -f deploy/aws/docker-compose.prod.yml --env-file deploy/aws/.env up -d --build
```

Full runbook in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Three things worth knowing before
you try it:

- `ARTIFACT_SIGNING_SECRET` and `JWT_SECRET` must be **identical** across services that sign
  and verify.
- `NEXT_PUBLIC_*` are inlined by Next at build time, so they must be passed as Docker build
  args and not only as runtime environment — otherwise the browser bundle ships with empty
  strings and every request goes to the wrong origin.
- Every deployment target needs its own Prisma `binaryTargets` entry —
  `debian-openssl-3.0.x` for the Playwright image, `linux-musl-openssl-3.0.x` for Alpine,
  `rhel-openssl-3.0.x` for serverless targets.

`.dockerignore` patterns need a leading `**/`, because Docker matches them against the full
path and does not recurse. A bare `dist` excluded only the repo root, so the host's built
output was being copied into the build context — which in turn masked that `tsc -b` was
skipping emit entirely on the strength of stale `.tsbuildinfo` files. The build looked
reproducible and was not.

## Notable decisions

- **Grounding is checked with no model in the loop.** Every non-null claim quotes the text
  it was read from, and that text must appear in the captured page. Deterministic, zero
  tokens, and it catches outright fabrication with certainty. Any hallucination-detection
  system should start with the check that needs no model.
- **The verifier never sees the extractor's reasoning.** An agent shown the argument
  evaluates the argument and agrees; an agent shown only the page reads the page. The
  schema declares `independentReading` before `verdict`, because models emit JSON in field
  order — so a reading must exist before a judgement does.
- **Numeric refs, never model-generated selectors.** The snapshot mints refs and resolves
  them through our own map, so a stale one throws `StaleRefError` instead of acting on
  whatever now occupies those coordinates. A hallucinated selector that _happens_ to match
  is the worst outcome available: a confident wrong click.
- **A click that changes nothing is an error.** Content hashes are compared around every
  mutating action. The model usually cannot notice — the screenshot looks the same because
  it is the same — so the check is structural rather than cognitive.
- **A missing confidence is recorded as missing.** When a model declines to report one, the
  claim carries `null` and routes to human review; it never becomes a default number.
  Inventing a confidence score is the same failure as inventing a price.
- **Every model response is parsed by Zod before anything downstream sees it.** An LLM is
  the one input source that can return a well-formed-looking object that is structurally
  wrong. A violation is a logged, recoverable event that triggers a retry — not a
  `TypeError` five frames deep.
- **Known model deviations are normalised, not just rejected.** Models reliably write
  `extraction` where the domain says `reasoning`, and JSON Schema where a flat map is
  expected. Both are mapped through an explicit lookup and the normalisation is logged, so
  the gap between our vocabulary and the model's stays measurable instead of silently
  failing runs.
- **The cache is exact-match, never semantic.** A semantic cache can return a _nearly_
  right answer for a _slightly_ different page, which is the exact class of silent error
  this product exists to prevent. Sampled calls are not cached at all, because caching a
  sample freezes one draw.
- **The plan is hashed and the hash is approved.** `planHash` covers objectives, URLs and
  risk but not estimates, so a re-estimate does not invalidate consent while an edited
  target URL does.
- **`robots.txt` is honoured, and an override is a logged human decision.** We sell into a
  regulated profession where "the agent ignored robots.txt" is a headline the customer
  cannot afford.
- **The Recovery agent chooses from filtered rungs.** Already-tried and unaffordable
  strategies are removed before the prompt is built, and classes that require a human never
  reach it. Asking a model whether to attempt a CAPTCHA is a question with an obviously
  wrong answer available.
- **Pause and takeover are state transitions, not booleans.** Implemented as flags checked
  at ad-hoc points in a loop, they produce the bug that destroys trust in this product —
  "it paused, but then did one more click". A test asserts the machine ignores execution
  events while gated.
- **Approvals block on `BLPOP`, not on a poll.** A blocked pop wakes in milliseconds and
  costs nothing while waiting. An approval that times out _parks_ the run — the person went
  for coffee, and destroying three minutes of browser work over it is user-hostile.
- **The budget pauses the run and asks.** Hard-failing at 80% completion destroys work the
  user already paid for to enforce a limit they would gladly have raised.
- **A run that fails must say so.** Any terminal agent failure transitions the run and
  emits a human-readable reason. A run that stops emitting events while still claiming to
  be `EXECUTING` is the worst failure mode available, because nothing tells the user
  anything is wrong.
- **The interface is a projection of the event log.** One `applyEvent` reducer, so live
  streaming and replay run through identical code. Building replay separately would
  guarantee it drifts, and the whole value of an audit trail is that the replay is faithful.
- **Screenshot frames are transient, not events.** They stream over pub/sub to the viewport
  and are never written to the event log. A 2 fps capture would otherwise bury the six
  events a human cares about under 150 rows of image URLs.
- **Events are flushed on an animation frame, not per message.** A fast agent emits 20–40
  events a second; committing each one is 40 renders a second of a large tree.
- **The element highlight is drawn before the click, not after.** Predicting intent is the
  precondition for trusting an agent — and it is what makes the pause key useful, because
  you can stop it before rather than after.
- **Provenance ships inside the deliverable, not as a separate log.** The question — where
  did this number come from? — arrives weeks later, in a meeting, without our product open.
  If the answer only lives in our app, we did not solve the customer's problem.
- **CSV cells are formula-neutralised, but only strings.** Values come from third-party
  pages, so `=HYPERLINK(...)` would otherwise become a live formula in an accountant's
  spreadsheet. Numbers are left alone: prefixing `-500` would corrupt exactly the data they
  care about.
- **`Decimal` for money, never `Float`.** Costs are computed in integer micro-dollars and
  converted only at the edge. Selling floating-point currency to accountants is
  disqualifying.
- **Approval authority is not a permission.** It is resolved separately, scoped by Trust
  Ladder level, and can be revoked without demoting someone's read access. Folding it into
  the role matrix would make it something an admin toggles beside "can edit recipes" — and
  it is the one capability whose misuse is legally material.
- **Refresh tokens are opaque and single-use.** 256 bits of CSPRNG output stored as a
  SHA-256 hash, not JWTs, so they cannot be forged by anyone who learns the signing secret.
  Presenting an already-rotated token revokes the whole family: at that moment the
  legitimate holder and an attacker are indistinguishable, so both must re-authenticate.
- **Access tokens are Zod-parsed after signature verification.** Verifying a signature and
  then trusting the payload's shape is the most common auth bug there is; a signature-valid
  token with a missing claim is rejected rather than yielding `undefined` to callers.
- **Environment is validated at boot and the process refuses to start if it is wrong.** A
  service that boots with a missing secret and fails on the first request that needs it
  converts a config error into a production incident. Every service also logs the
  _provenance_ of each resolved value at startup.
- **One shared environment schema.** Services extend it rather than each declaring their
  own, because a variable that exists for one service and not another fails silently and
  is very hard to see.
- **The build requires no secrets.** Auth.js is configured through a factory and validation
  is deferred to first access, so `next build` runs in a clean container with no
  environment at all. A build that needs production credentials cannot run in CI.
- **Repositories, not the raw Prisma client.** Application code imports typed repository
  functions from `@quorum/db`; the generated client never leaves that package.
- **Tailwind v4, CSS-first.** Design tokens live in `packages/ui/src/styles/globals.css`
  under `@theme`. There is no `tailwind.config.ts` — one file is the design system.
- **shadcn/ui as owned source, not a dependency.** For a product whose differentiation is a
  bespoke interface, editing a component beats fighting a theme API.
- **Self-hosted fonts (Fontsource), not `next/font/google`.** Removes a build-time
  dependency on Google, makes offline builds work, and removes a third-party font request
  from a product sold to European accounting firms.

## License

Proprietary. All rights reserved.
