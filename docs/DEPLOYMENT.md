# Deployment

Six components. Each is placed where its workload actually belongs rather than where it
would be convenient to put everything.

| Component      | Where         | Why there                                                                                     | Cost  |
| -------------- | ------------- | --------------------------------------------------------------------------------------------- | ----- |
| Frontend       | Vercel        | Native App Router support, edge network, per-PR previews.                                     | $0–20 |
| API gateway    | Fly.io        | Needs long-lived WebSockets and a stateful process — the one thing serverless cannot do.      | ~$6   |
| Worker         | Fly.io        | Memory-bound on Chromium (~400 MB/context). Scales to zero.                                   | ~$6   |
| PostgreSQL     | Neon          | Serverless, and database branching gives every PR an isolated copy.                           | $0–19 |
| Redis          | Upstash       | Per-request pricing; our usage is bursty and would leave a provisioned instance ~90% idle.    | $0–10 |
| Browser        | Browserbase   | Managed Chromium with live-view URLs and session replay.                                      | $0–39 |
| Object storage | Cloudflare R2 | Zero egress. We stream screenshots continuously; on S3, egress would exceed the compute bill. | ~$1   |

Total at demo scale: **$25–100/month**.

## Order matters

Deploy data before compute, and compute before the frontend. Each step below assumes the
previous one succeeded.

### 1. PostgreSQL

```bash
neonctl projects create --name quorum
# Two URLs: the pooled one for services, the direct one for migrations.
# A pooler cannot run DDL, which is why DIRECT_URL exists.
neonctl connection-string --pooled   # -> DATABASE_URL
neonctl connection-string            # -> DIRECT_URL
```

Apply the schema:

```bash
DIRECT_URL=... pnpm db:deploy
```

### 2. Redis

```bash
upstash redis create --name quorum --region us-east-1
# -> REDIS_URL (rediss://, TLS)
```

Redis holds queues, the event bus and approval barriers. It is not a cache here: losing it
mid-run strands a run waiting on a human, so enable persistence.

### 3. Object storage

```bash
wrangler r2 bucket create quorum-artifacts
```

Keep the bucket **private**. Artifacts are screenshots of a customer's client data and are
served only through expiring signed URLs.

### 4. API gateway

```bash
fly apps create quorum-api
fly secrets set --app quorum-api \
  DATABASE_URL=... REDIS_URL=... JWT_SECRET="$(openssl rand -base64 48)" \
  R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... \
  WEB_ORIGIN=https://quorum.app
fly deploy --config fly.api.toml
```

Two machines minimum. The gateway is stateless — any instance serves any run, because
events arrive over Redis pub/sub — so rolling deploys are zero-downtime and need no sticky
routing.

### 5. Worker

```bash
fly apps create quorum-worker
fly secrets set --app quorum-worker \
  DATABASE_URL=... REDIS_URL=... \
  ANTHROPIC_API_KEY=... OPENAI_API_KEY=... \
  BROWSERBASE_API_KEY=... BROWSERBASE_PROJECT_ID=... \
  R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=...
fly deploy --config fly.worker.toml
```

Scales to zero. A ~2s cold start is imperceptible against a three-minute run, and browser
work is the expensive line — this turns it from always-on into per-run.

The worker **refuses to start without a model key**. That is deliberate: a worker that
claims jobs it cannot run is worse than one that never joined the pool.

### 6. Frontend

```bash
vercel link
vercel env add AUTH_SECRET production        # openssl rand -base64 48
vercel env add JWT_SECRET production         # must match the API's
vercel env add DATABASE_URL production
vercel env add NEXT_PUBLIC_API_URL production   # https://quorum-api.fly.dev
vercel env add NEXT_PUBLIC_WS_URL production    # wss://quorum-api.fly.dev/v1/ws
vercel env add GOOGLE_CLIENT_ID production
vercel env add GOOGLE_CLIENT_SECRET production
vercel --prod
```

`JWT_SECRET` **must be identical** on the web app and the API: the web app mints access
tokens and the API verifies them. `AUTH_SECRET` is deliberately different — it encrypts the
session cookie, and compromising one should not imply the other.

## Verifying a deploy

```bash
curl -s https://quorum-api.fly.dev/healthz | jq   # must not touch dependencies
curl -s https://quorum-api.fly.dev/readyz  | jq   # must check Postgres and Redis
```

`/healthz` deliberately ignores dependencies. If it checked them, a brief database blip
would make the orchestrator kill healthy processes and turn a partial outage into a total
one. `/readyz` does check them, so a degraded instance is drained rather than restarted.

## Rollback

```bash
fly releases rollback --app quorum-api      # < 30s
vercel rollback                             # instant
```

Prompt regressions do not need a deploy at all — prompt versions are recorded on every
`LlmCall` row, so a bad version is identified with one `GROUP BY` and switched by flag.

## What is not yet wired

Honest list, so nobody discovers these during a demo:

- **Migrations run manually.** `pnpm db:deploy` is not in the deploy pipeline; automating
  it needs an expand-only check first, because rolling deploys run old and new code
  together for ~60 seconds.
- **No Sentry/Axiom DSNs.** The env vars exist and are read; nothing is wired to them.
- **No autoscaling policy** beyond Fly's defaults.
- **Browserbase has never been connected** — the driver is written against the documented
  API but has not made a live session.
