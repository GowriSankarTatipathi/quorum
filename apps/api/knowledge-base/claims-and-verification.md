# Claims, evidence, and verification

Source: docs/ARCHITECTURE.md

A QUORUM claim represents one extracted fact. It records the value, source URL, quoted
source text, prompt version, model, and a confidence score when available.

Grounding is a deterministic check: quoted text must appear in the captured page. A claim
that fails grounding is quarantined rather than exported as a supported result.

Verification independently re-reads the source. The verifier records its own reading
before judging the original claim, reducing the chance that it simply repeats the first
agent's conclusion. A separate critic checks relationships across claims, such as
inconsistent units or missing coverage.

These mechanisms support traceability for website extraction. They do not certify medical
or clinical answers.
