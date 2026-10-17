# QUORUM documentation assistant

The protected `/knowledge` page answers questions about QUORUM using a curated documentation
corpus. It uses BM25 lexical retrieval, with no embeddings or vector database. The assistant
has internal, read-only knowledge tools; it does not expose an MCP server or operate the
browser, change runs, or approve actions.

## Request flow

1. The signed-in web page calls the `askKnowledge` server action, which forwards the user's
   access token to `POST /v1/knowledge/ask`.
2. The API requires `run:read` permission and validates a trimmed question of 3–1,000 characters.
   The ask endpoint is limited to 10 requests per client per minute.
3. Deterministic checks reject recognized prompt-injection requests and medical-advice
   questions before retrieval or a model call.
4. The internal `search_knowledge` tool ranks corpus chunks using BM25. The answer pipeline
   selects at most four chunks, bounded to 10,000 content characters in total. Empty retrieval
   produces an abstention without a model call.
5. The configured live model receives answer-format instructions plus JSON containing the
   question and retrieved excerpts. It must treat those values as data, use only the excerpts,
   and return an answer with source labels.
6. The API validates the response shape and citations before returning it. The UI displays the
   answer and expandable source titles, repository paths, and excerpts.

The conversation shown in the page is held in client state. Each request contains one question;
previous turns are not included in the model prompt.

## Corpus and tools

The corpus is `apps/api/knowledge-base/*.md`, covering the product, run lifecycle, approvals,
claims and verification, and deployment. These are curated excerpts rather than an automatic
crawl of the repository or external websites.

Each file must include a top-level title and a `Source:` line naming its supporting repository
path. Second-level headings split documents into chunks. Review excerpts against their cited
source when editing them, then restart the API: the corpus is cached in the process.

The allowlist contains only:

- `search_knowledge`: accepts a validated query and a result limit of 1–6; the answer pipeline
  requests four.
- `list_knowledge_sources`: accepts no arguments and lists corpus titles and source paths.

`GET /v1/knowledge/sources` also requires `run:read`. Unknown tool names and extra arguments
are rejected by strict schemas. Tool selection is performed by application code, not by an
unrestricted model tool loop.

## Citations and abstention

The model returns an answer of at most 2,000 characters and at most four citation labels.
Inline labels such as `[S1]` or `[S1, S2]` must refer to retrieved sources and agree with the
structured citation list. Every nonempty sentence or line segment must contain a citation.
Missing citations, unknown labels, mismatches, and uncited segments produce an abstention with
an empty source list. Returned source excerpts are limited to 500 characters each.

The standard no-evidence response is:

> I could not find a supported answer in the available QUORUM documentation.

Citation checks establish format and traceability, not semantic proof that a source supports
every claim. Lexical retrieval can miss paraphrases, and pattern-based injection and scope
checks cannot recognize every adversarial request. Review answer quality against the corpus;
these checks do not make the model a general-purpose factual authority.

## Provider configuration

Use the local configuration described in the [README](../README.md). Configure
`ANTHROPIC_API_KEY` only in a local or deployed secret environment. `QUORUM_LLM_MODE=live`
requires a provider key; `auto` selects live mode when a key is present. The documentation
assistant refuses to generate answers in recorded mode.

The pipeline uses the `formatter` model policy, whose default is
`claude-haiku-4-5-20251001`. `QUORUM_MODEL_FORMATTER` can select another model supported by the
repository. `LLM_TIMEOUT_MS` and `LLM_RETRIES_PER_MODEL` control provider requests. Restart the
API after changing provider settings because its router is cached.

Live requests send the question and retrieved documentation excerpts to the configured
provider. Do not include confidential information in questions or the curated corpus.

Provider failures return safe HTTP 503 errors:

- `E_RAG_NOT_CONFIGURED`: no live configuration, or a provider authentication/configuration
  failure.
- `E_RAG_PROVIDER_UNAVAILABLE`: other exhausted provider failures, such as timeouts.

The answer pipeline logs operational fields such as model, prompt version, retrieval count,
latency, cost, and citation failure reason. It avoids logging questions and raw provider errors.

## Local verification

With the API, web app, PostgreSQL, Redis, and local Mailpit running:

1. Open `http://localhost:3000/signin`, submit a local test email, and retrieve the magic link
   at `http://localhost:8025/`. Follow it and open `http://localhost:3000/knowledge`.
2. Ask: “How does QUORUM prevent an agent from submitting a form without approval?” Verify
   that the answer cites the approval documentation and that the source excerpts support it.
3. Ask an out-of-scope question, such as “Can you diagnose this symptom?” Expect a refusal
   with no sources and no provider call.
4. Ask: “What is QUORUM’s SOC 2 audit completion date?” Expect abstention because the corpus
   does not contain that date. A lexical match can still trigger a model request before
   abstention.
5. Check that a signed-out request to `/knowledge` redirects to sign-in and that the API
   rejects unauthenticated knowledge requests.

The API probes are `http://localhost:3001/healthz` for liveness and
`http://localhost:3001/readyz` for database and Redis readiness.

Focused offline checks use mocked model responses:

```bash
pnpm --filter @quorum/ai exec vitest run src/rag
pnpm --filter @quorum/api exec vitest run src/services/knowledge.test.ts src/services/knowledge-answer.test.ts src/routes/routes.test.ts
pnpm --filter @quorum/web exec vitest run src/server/auth/route-policy.test.ts src/server/auth/email.test.ts
```

Run these after the repository setup and prerequisite package builds. The corpus evaluation
checks retrieval for representative questions; tool and guardrail tests cover input validation,
scope, injection patterns, citation consistency, bounded context, and provider failures.
Live-provider smoke checks are separate from these offline tests.

## Deployment

The API runtime must include `knowledge-base/` beside `dist/`. `Dockerfile.api` copies the
curated corpus into that location. Set provider secrets on the API service, and keep the web
app's API origin pointed at that service. See the [deployment guide](DEPLOYMENT.md) for the
rest of the application setup.
