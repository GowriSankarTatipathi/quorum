# QUORUM deployment and operations

Source: docs/DEPLOYMENT.md, docs/TROUBLESHOOTING.md

QUORUM uses a Next.js web application, a Fastify API, and a worker process. PostgreSQL
stores runs, claims, and events; Redis supports queues and live event delivery. Model
calls are made by the worker using the configured Anthropic provider.

For local development, the repository documents Node.js, pnpm, Docker, PostgreSQL, Redis,
and Chromium setup in README.md. The end-to-end harness can replay recorded model
responses when no provider key is configured.

Model call records include prompt versions, latency, token usage, and cost. This helps
compare behavior across prompt changes and diagnose cost or quality regressions.
