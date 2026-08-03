#!/usr/bin/env bash
#
# One command: stand up the dependencies and run the whole agent pipeline.
#
#   pnpm e2e
#
# With ANTHROPIC_API_KEY exported it calls the real model. Without one it replays recorded
# responses and says so. Either way the browser, database, queue and storage are real.
#
# No secret is read from anywhere but the environment.
set -euo pipefail

cd "$(dirname "$0")/.."

blue()  { printf "\033[34m%s\033[0m\n" "$1"; }
green() { printf "\033[32m%s\033[0m\n" "$1"; }
warn()  { printf "\033[33m%s\033[0m\n" "$1"; }

DATABASE_URL="${DATABASE_URL:-postgresql://quorum:quorum@127.0.0.1:5433/quorum}"
REDIS_URL="${REDIS_URL:-redis://127.0.0.1:6379}"
ARTIFACT_ROOT="${ARTIFACT_ROOT:-$PWD/.artifacts}"
export DATABASE_URL REDIS_URL ARTIFACT_ROOT

blue "==> dependencies"
if command -v docker >/dev/null 2>&1; then
  docker compose up -d postgres redis >/dev/null
  # Wait for Postgres rather than sleeping a guessed number of seconds.
  for _ in $(seq 1 30); do
    docker compose exec -T postgres pg_isready -U quorum -d quorum >/dev/null 2>&1 && break
    sleep 1
  done
  green "    postgres and redis are up (docker compose)"
else
  warn "    docker not found — expecting Postgres at \$DATABASE_URL and Redis at \$REDIS_URL"
fi

blue "==> browser"
if [ ! -d "${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}" ]; then
  pnpm --filter @quorum/browser exec playwright-core install chromium
else
  green "    chromium already installed"
fi

blue "==> schema"
# The migrations are applied with plain SQL so the run does not depend on Prisma's engine
# download, which is exactly the sort of external dependency an integration test should
# not have. `prisma migrate deploy` produces the same result where it is available.
pnpm --filter @quorum/integration exec tsx src/apply-migrations.ts

blue "==> build"
pnpm --filter '@quorum/core' --filter '@quorum/events' --filter '@quorum/ai' \
     --filter '@quorum/browser' --filter '@quorum/storage' --filter '@quorum/export' build >/dev/null

blue "==> run"
pnpm --filter @quorum/integration exec tsx src/run-e2e.ts
