# Troubleshooting

Ordered by how often each actually happens.

## The worker refuses to start

```
No LLM provider key found. Export ANTHROPIC_API_KEY...
```

Deliberate. A worker with no model key would claim jobs from the queue and fail every one,
which is worse than never joining the pool. Export a key, or use `pnpm e2e` to exercise the
pipeline without a vendor.

## `pnpm e2e` says "recorded"

No `ANTHROPIC_API_KEY` in the environment. The run is still real — real browser, database,
queue and storage — but model responses are replayed. Export a key and rerun; the switch is
automatic and nothing else changes.

Check what it decided:

```bash
node -e "console.log(require('@quorum/ai').loadLlmConfig().reason)"
```

## `prisma generate` fails

```
Failed to fetch sha256 checksum at binaries.prisma.sh — 403
```

A network or proxy problem, not a code one. The integration path does not depend on it:
migrations are applied as plain SQL by `pnpm --filter @quorum/integration exec tsx
src/apply-migrations.ts`. For the services you do need the generated client.

## Chromium will not launch

```
error while loading shared libraries: libXdamage.so.1
```

Missing system libraries, not a Playwright problem.

```bash
# Debian/Ubuntu
pnpm exec playwright install-deps chromium
# macOS — nothing needed
pnpm exec playwright install chromium
```

## A run sits at AWAITING_APPROVAL forever

Working as designed: it is waiting for a human. Approve it in the interface, or check for a
pending gate:

```sql
SELECT id, "trustLevel", reason FROM "Approval" WHERE status = 'PENDING';
```

Approvals time out after `APPROVAL_TIMEOUT_S` (30 min) and **park** the run rather than
failing it — someone went for coffee, and destroying three minutes of browser work over
that would be user-hostile. Resume from the run page.

## Claims are being quarantined

```
QUARANTINED price.premium = 99 — source_text_not_in_dom
```

The grounding check is doing its job: the model quoted text that is not on the captured
page. A few is normal. A spike means a model or prompt change started inventing values:

```sql
SELECT "promptVersion", count(*) FROM "Claim"
WHERE status = 'UNVERIFIED' GROUP BY 1 ORDER BY 2 DESC;
```

Compare against the previous prompt version before blaming the site.

## The event stream stops updating

The UI reconnects on its own with exponential backoff and replays from its cursor, so a
brief drop is invisible. If it persists:

1. `curl localhost:3001/readyz` — is Redis reachable?
2. A "condensed — slow connection" chip means the socket fell behind and the gateway
   dropped verbose events deliberately. Meaning is preserved; fidelity is not.
3. Nothing is lost either way: events are written to Postgres before they are published,
   so a refresh replays the full history.

## Quality dropped after a deploy

Prompt versions are on every call. This is a one-query bisect:

```sql
SELECT "promptVersion", model,
       count(*) AS calls,
       sum(CASE WHEN "schemaViolation" THEN 1 ELSE 0 END) AS violations
FROM "LlmCall" WHERE agent = 'reasoning' AND "createdAt" > now() - interval '2 days'
GROUP BY 1, 2 ORDER BY 1;
```

Roll a prompt back by flag; it needs no deploy.

## A run cost more than expected

```sql
SELECT agent, count(*), sum("costUsd") FROM "LlmCall"
WHERE "runId" = '...' GROUP BY 1 ORDER BY 3 DESC;
```

Usually the browser agent looping. Check for `browser.noop_detected` events — a click that
changed nothing, retried. If the loop was not caught, that is a bug worth reporting.

## Everything is slow

| Symptom                         | Likely cause                                                                                        |
| ------------------------------- | --------------------------------------------------------------------------------------------------- |
| First run slow, later ones fast | Cold Chromium (~1.5s) vs warm (~150ms). Expected.                                                   |
| Every snapshot slow             | A very large page. Check `nodeCount`; compression caps the tree but the DOM resolve is per-element. |
| Long gaps between agents        | Model latency. `LlmCall.latencyMs` has the per-call truth.                                          |
| UI janky under load             | Should not happen — events are rAF-batched. File it with a run id.                                  |
