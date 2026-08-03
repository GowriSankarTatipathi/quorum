# QUORUM

**An autonomous browser agent that never acts alone.**

QUORUM turns a plain-English goal into a plan, executes it in a real browser through
seven specialised agents, and hands back results you can trace to the exact pixel on
the exact page. Anything irreversible stops and asks a human first.

Three ideas carry the product:

1. **Claims, not answers.** Every extracted value is stored with its source URL, the
   verbatim text it was read from, a screenshot, the model that produced it and a
   calibrated confidence score. A number you cannot trace back to a pixel is not a
   result, it is a rumour.
2. **The Trust Ladder.** Actions are classified by _reversibility_ by a pure,
   fully-tested function. Reading and paginating are free; submitting a form is gated
   in every autonomy mode. The autonomy dial controls friction, never authority.
3. **Recovery is a subsystem, not a `try/catch`.** A typed error taxonomy maps each
   failure class to an ordered ladder of strategies with known costs, and the terminal
   rung is always a human — not a failure.

Full rationale lives in the QUORUM Software Design Document (v1.0, approved).
Every non-obvious decision in this repository carries an inline comment explaining the
_why_, so the code is readable without the document open beside it.

---

## Status

Validated end to end on 2026-08-03 against a real Chromium 151, PostgreSQL 18.4, Redis 6.2
and artifact storage. One command reproduces it:

```bash
pnpm e2e
```

|                          |                                                                 |
| ------------------------ | --------------------------------------------------------------- |
| Tests                    | 509 passing                                                     |
| Typecheck / lint / build | clean across 14 packages and apps                               |
| End-to-end run           | plan → browse → extract → ground → verify → critique → workbook |
| Live model               | switches on automatically when `ANTHROPIC_API_KEY` is present   |

Not yet done: a run against the live model (the pipeline is wired and the HTTP client is
tested against a local API replica, but prompt calibration is unproven), Browserbase has
never been connected, and the API and worker processes have not been integration-tested as
processes — the agents were driven directly.

Documentation: [architecture](docs/ARCHITECTURE.md) · [deployment](docs/DEPLOYMENT.md) ·
[demo](docs/DEMO.md) · [troubleshooting](docs/TROUBLESHOOTING.md)

---

## Requirements

- Node.js 22 (`.nvmrc`)
- pnpm 9.15+ (`corepack enable && corepack prepare pnpm@9.15.9 --activate`)
- Docker (for Postgres, Redis, MinIO and Mailpit)
- A Chromium build for local browser runs: `pnpm exec playwright install chromium`
  (not needed for tests, which use the fixture driver)

## Install

```bash
git clone <repo> quorum && cd quorum
corepack enable
pnpm install
cp .env.example .env.local
```

Then set the two secrets in `.env.local` — they are deliberately different keys, so
compromising the session cookie does not also let an attacker mint API credentials:

```bash
openssl rand -base64 48   # AUTH_SECRET — encrypts the NextAuth session cookie
openssl rand -base64 48   # JWT_SECRET  — signs API access tokens
```

At least one sign-in method must be configured or the web app refuses to start, rather
than rendering a sign-in page whose buttons cannot work. Magic links work out of the box
against the local Mailpit container; Google OAuth needs credentials with the redirect URI
`http://localhost:3000/api/auth/callback/google`.

## Run

```bash
docker compose up -d           # postgres, redis, minio, mailpit
pnpm db:generate               # generate the Prisma client
pnpm db:deploy                 # apply migrations
pnpm db:seed                   # optional: a completed demo run to look at
pnpm dev                       # all apps, in parallel
```

`pnpm db:seed` creates a demo workspace containing a finished five-site pricing sweep —
including the deliberate defect the product exists to catch: one price read from an
annual-billing toggle while the others are monthly, and the blocking critique that flags
it. Re-running the seed replaces the demo workspace rather than accumulating copies.

| Target        | URL                        | What it is                                                      |
| ------------- | -------------------------- | --------------------------------------------------------------- |
| Web           | http://localhost:3000      | The product                                                     |
| API           | http://localhost:3001      | Fastify gateway                                                 |
| API docs      | http://localhost:3001/docs | OpenAPI UI, generated from the Zod route schemas                |
| Fixtures      | http://localhost:3002      | Deterministic pages reproducing the failures real sites exhibit |
| Worker        | —                          | BullMQ consumer; logs to stdout                                 |
| MinIO console | http://localhost:9001      | `quorum` / `quorumquorum`                                       |

Individual targets:

```bash
pnpm --filter @quorum/web dev
pnpm --filter @quorum/api dev
pnpm --filter @quorum/worker dev
```

## End-to-end run

One command stands up the dependencies and drives the entire pipeline — planner, browser,
extraction, grounding, verification, critic, workbook — against a real Chromium, a real
PostgreSQL, a real Redis and real artifact storage:

```bash
pnpm e2e
```

Without a key it replays recorded model responses and says so. To run against Claude,
export a key first — it is read from the environment and from nowhere else:

```bash
export ANTHROPIC_API_KEY=sk-ant-...   # never commit this; use .env.local or your shell
pnpm e2e
```

The switch is automatic: `loadLlmConfig()` reports `live` the moment a key is present and
`recorded` when it is not, and prints which at startup. `QUORUM_LLM_MODE=recorded` forces
replay even with a key, which is what CI uses so a pull request never depends on a vendor
being up or spends money.

Individual probes, for narrowing a failure:

```bash
pnpm e2e:browser   # real Chromium: snapshot, refs, DOM facts, screenshot
pnpm e2e:actions   # Trust Ladder on live elements, no-op detection, gating
pnpm e2e:db        # apply migrations to a real PostgreSQL, verify cascades
pnpm e2e:queue     # BullMQ round-trip, pub/sub, the BLPOP approval barrier, storage
```

## Verify

```bash
pnpm typecheck      # tsc across every package and app
pnpm lint           # eslint 9 flat config, type-aware rules
pnpm test:unit      # vitest
pnpm build          # tsc -b for services, next build for apps
pnpm format:check   # prettier
```

### Trying the auth flow

1. Open http://localhost:3000 and choose **Email me a sign-in link**.
2. Open http://localhost:8025 and click the link in the message.
3. You land on `/account`, which shows your role, your permission list, and your
   approval ceiling level by level — including the ones you are _not_ allowed to
   approve and the reason why.
4. Sign in from a second browser and watch both sessions appear. Revoking one leaves
   the other working; "sign out everywhere" ends both immediately, because it bumps a
   token version rather than waiting out the 15-minute access-token TTL.

The first person to sign up owns a new workspace. Joining an existing workspace by
shared email domain is deliberately not implemented: it would let anyone controlling a
lookalike mailbox into a firm's data. Invitations arrive with member management.

Health probes, once the API is running:

```bash
curl -s localhost:3001/healthz | jq   # liveness  — must not touch dependencies
curl -s localhost:3001/readyz  | jq   # readiness — checks Postgres and Redis
```

`/healthz` deliberately does not check dependencies: if it did, a brief database blip
would make the orchestrator kill healthy processes and turn a partial outage into a
total one. `/readyz` does check them, so a degraded instance is drained instead.

## Layout

```
apps/
  web/        Next.js 15 App Router — the product surface
  api/        Fastify gateway: REST + WebSocket, stateless, scales on connections
  worker/     BullMQ consumer: owns the agent runtime and browsers, scales on RAM
  fixtures/   Deterministic test website (annual-default pricing toggle, consent wall)
packages/
  core/       Domain: enums, branded ids, action vocabulary, Trust Ladder, estimates
  events/     The event taxonomy — the contract between worker, gateway, DB and UI
  ai/         Model registry, per-agent routing policy, exact cost accounting
  browser/    The BrowserDriver interface every backend implements
  db/         Prisma schema and client
  ui/         Design tokens and owned shadcn-derived components
  config/     Shared tsconfig and ESLint presets
```

Two deployables, not microservices: the gateway is I/O-bound on connections and the
worker is memory-bound on Chromium (~400 MB per context). Those are genuinely
different scaling profiles, which is what justifies a split. Splitting further would
add network hops to solve a problem we do not have.

## Notable decisions

- **Tailwind v4, CSS-first.** Design tokens live in `packages/ui/src/styles/globals.css`
  under `@theme`. There is no `tailwind.config.ts` — one file is the design system.
- **shadcn/ui as owned source, not a dependency.** For a product whose differentiation
  is a bespoke interface, editing a component beats fighting a theme API.
- **Self-hosted fonts (Fontsource), not `next/font/google`.** Removes a build-time
  dependency on Google, makes offline builds work, and removes a third-party font
  request from a product sold to European accounting firms.
- **Separate `tsconfig.json` and `tsconfig.build.json` per package.** The first
  includes tests so the editor and ESLint's type-aware rules see them; the second
  excludes tests and drives project-reference builds.
- **Environment validated at boot with Zod, and the process refuses to start if it is
  wrong.** A service that boots with a missing secret and fails on the first request
  that needs it converts a config error into a production incident.
- **`Decimal` for money, never `Float`.** Costs are computed in integer micro-dollars
  and converted only at the edge. Selling floating-point currency to accountants is
  disqualifying.
- **Approval authority is not a permission.** It is resolved separately, scoped by Trust
  Ladder level, and can be revoked without demoting someone's read access. Folding it
  into the role matrix would make it something an admin toggles beside "can edit
  recipes" — and it is the one capability whose misuse is legally material.
- **Refresh tokens are opaque and single-use.** 256 bits of CSPRNG output stored as a
  SHA-256 hash, not JWTs, so they cannot be forged by anyone who learns the signing
  secret. Presenting an already-rotated token revokes the whole family: at that moment
  the legitimate holder and an attacker are indistinguishable, so both must
  re-authenticate.
- **The build requires no secrets.** Auth.js is configured through a factory and
  environment validation is deferred to first access, so `next build` runs in a clean
  container with no environment at all. A build that needs production credentials cannot
  run in CI or a preview.
- **Repositories, not the raw Prisma client.** Application code imports typed repository
  functions from `@quorum/db`; the generated client never leaves that package.
- **Every model response is parsed by Zod before anything downstream sees it.** An LLM is
  the one input source that can return a well-formed-looking object that is structurally
  wrong. A violation is a logged, recoverable event that triggers a provider switch — not
  a `TypeError` five frames deep.
- **The cache is exact-match, never semantic.** A semantic cache can return a _nearly_
  right answer for a _slightly_ different page, which is the exact class of silent error
  this product exists to prevent. Sampled calls (Critic, Recovery) are not cached at all,
  because caching a sample freezes one draw.
- **The plan is hashed and the hash is approved.** `planHash` covers objectives, URLs and
  risk but not estimates, so a re-estimate does not invalidate consent while an edited
  target URL does.
- **Numeric refs, never model-generated selectors.** The snapshot mints refs and resolves
  them through our own map, so a stale one throws `StaleRefError` instead of acting on
  whatever now occupies those coordinates. A hallucinated selector that _happens_ to match
  is the worst outcome available: a confident wrong click.
- **A click that changes nothing is an error.** Content hashes are compared around every
  mutating action. The model usually cannot notice — the screenshot looks the same because
  it is the same — so the check is structural rather than cognitive.
- **`robots.txt` is honoured, and an override is a logged human decision.** We sell into a
  regulated profession where "the agent ignored robots.txt" is a headline the customer
  cannot afford.
- **Grounding is checked with no model in the loop.** Every non-null claim quotes the text
  it was read from, and that text must appear in the captured page. It is deterministic,
  costs zero tokens, and catches outright fabrication with certainty — any
  hallucination-detection system should start with the check that needs no model.
- **The verifier never sees the extractor's reasoning.** An agent shown the argument
  evaluates the argument and agrees; an agent shown only the page reads the page. The
  schema also declares `independentReading` before `verdict`, because models emit JSON in
  field order — so a reading must exist before a judgement does.
- **The Recovery agent chooses from filtered rungs.** Already-tried and unaffordable
  strategies are removed before the prompt is built, and classes that require a human never
  reach it. Asking a model whether to attempt a CAPTCHA is a question with an obviously
  wrong answer available.
- **Pause and takeover are state transitions, not booleans.** Implemented as flags checked
  at ad-hoc points in a loop, they produce the bug that destroys trust in this product —
  "it paused, but then did one more click". A test asserts the machine ignores execution
  events while gated.
- **Approvals block on `BLPOP`, not on a poll.** Polling burns CPU and adds latency
  proportional to the interval; a blocked pop wakes in milliseconds and costs nothing while
  waiting. An approval that times out _parks_ the run — the person went for coffee, and
  destroying three minutes of browser work over it is user-hostile.
- **The budget pauses the run and asks.** Hard-failing at 80% completion destroys work the
  user already paid for to enforce a limit they would gladly have raised.
- **The interface is a projection of the event log.** One `applyEvent` reducer, so live
  streaming and replay run through identical code. Building replay separately would
  guarantee it drifts, and the whole value of an audit trail is that the replay is faithful.
- **Events are flushed on an animation frame, not per message.** A fast agent emits 20–40
  events a second; committing each one is 40 renders a second of a large tree. The
  difference between "premium" and "janky" is about twelve lines of batching.
- **The element highlight is drawn before the click, not after.** Predicting intent is the
  precondition for trusting an agent — and it is what makes the pause key useful, because
  you can stop it before rather than after.
- **Provenance ships inside the deliverable, not as a separate log.** The question — where
  did this number come from? — arrives weeks later, in a meeting, without our product open.
  If the answer only lives in our app, we did not solve the customer's problem.
- **CSV cells are formula-neutralised, but only strings.** Values come from third-party
  pages, so `=HYPERLINK(...)` would otherwise become a live formula in an accountant's
  spreadsheet. Numbers are left alone: prefixing `-500` would corrupt exactly the data
  they care about.
- **Replay runs the same reducer as the live stream.** Building it separately would
  guarantee drift, and a replay you cannot trust is not an audit trail.
- **Approval authority is not a permission.** It is resolved separately, scoped by Trust
  Ladder level, and can be revoked without demoting someone's read access. Folding it
  into the role matrix would make it something an admin toggles beside "can edit
  recipes" — and it is the one capability whose misuse is legally material.
- **Refresh tokens are opaque and single-use.** They are 256 bits of CSPRNG output
  stored as a SHA-256 hash, not JWTs, so they cannot be forged by anyone who learns the
  signing secret. Presenting an already-rotated token revokes the whole family: at that
  moment the legitimate holder and an attacker are indistinguishable, so both must
  re-authenticate.
- **The build requires no secrets.** Auth.js is configured through a factory and
  environment validation is deferred to first access, so `next build` runs in a clean
  container. A build that needs production credentials cannot run in CI or a preview.
- **Repositories, not the raw Prisma client.** Application code imports typed repository
  functions from `@quorum/db`; the generated client stays inside that package.

## License

Proprietary. All rights reserved.
