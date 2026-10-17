# How a QUORUM run works

Source: README.md

1. A user submits a goal in plain English.
2. The planner proposes steps, expected outputs, risks, and an estimated cost.
3. The run pauses for human approval before browser execution begins.
4. The browser agent reads pages and proposes actions from a constrained action set.
5. A deterministic policy classifies each action before it is executed.
6. The reasoning agent extracts claims together with the source text.
7. Grounding checks compare the quoted text with the captured page.
8. A verifier independently checks selected claims, and a critic looks for inconsistencies
   across the result set.
9. The user can inspect the evidence and export the results.

The event log is the source of truth for both live updates and replay.
