# Quickstart

Five minutes from clone to a complete agent run.

## 1. Prerequisites

- **Node 22** (`.nvmrc` — `nvm use`)
- **pnpm 9** — `corepack enable && corepack prepare pnpm@9.15.9 --activate`
- **Docker** — for PostgreSQL and Redis

## 2. Install

```bash
pnpm install
cp .env.example .env.local
```

Generate the two secrets and put them in `.env.local`. They are deliberately different
keys — one encrypts the session cookie, the other signs API tokens, and compromising one
should not imply the other:

```bash
openssl rand -base64 48   # -> AUTH_SECRET
openssl rand -base64 48   # -> JWT_SECRET
```

## 3. The end-to-end run

```bash
pnpm e2e
```

That single command brings up PostgreSQL and Redis, installs Chromium if needed, applies
the migrations, builds the packages, and drives the whole pipeline: plan → browse →
extract → ground → verify → critique → workbook.

Without a model key it replays recorded responses and says so — the browser, database,
queue and storage are still real. To run against Claude:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
pnpm e2e
```

The switch is automatic. Nothing else changes.

**What to watch for on your first live run:**

- Does the browser agent notice the billing toggle defaults to *annual* and switch it to
  monthly before extracting? That behaviour is the product's whole thesis.
- Does anything get `QUARANTINED`? That is the grounding check rejecting a value whose
  quoted text is not on the page — it runs with no model involved.
- The metrics block at the end prints real per-agent latency, tokens and cost.

## 4. The application

```bash
docker compose up -d          # postgres, redis, minio, mailpit
pnpm db:generate              # generate the Prisma client
pnpm db:deploy                # apply migrations
pnpm db:seed                  # optional: a finished demo run to look at
pnpm dev
```

| | |
| --- | --- |
| App | http://localhost:3000 |
| API docs | http://localhost:3001/docs |
| Mailpit (sign-in links land here) | http://localhost:8025 |
| Fixture site | http://localhost:3002 |

Sign in with **Email me a sign-in link**, then open http://localhost:8025 and click it.
The first person to sign up owns a new workspace.

The worker deliberately refuses to start without a model key — a worker that claims jobs it
cannot run is worse than one that never joined the pool. Export `ANTHROPIC_API_KEY` before
`pnpm dev` if you want a live run through the interface.

## 5. Narrower probes

When something fails, these isolate which layer:

```bash
pnpm e2e:browser   # real Chromium: snapshot, refs, DOM facts, screenshot
pnpm e2e:actions   # Trust Ladder on live elements, no-op detection, gating
pnpm e2e:db        # migrations against a real PostgreSQL, cascade deletes
pnpm e2e:queue     # BullMQ round-trip, pub/sub, the BLPOP approval barrier, storage
```

## 6. Verify the repository

```bash
pnpm typecheck && pnpm lint && pnpm test:unit && pnpm build
```

509 tests. All four should be clean.

---

Stuck? [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) is ordered by how often each
problem actually happens. Presenting this? [docs/DEMO.md](docs/DEMO.md).
