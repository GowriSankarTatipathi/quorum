# Five-minute demo

The point of this script is not to show that a browser can be automated. It is to show the
three things a script cannot do: **refuse to guess, catch its own mistakes, and hand back
something a professional can sign.**

## Before you start

```bash
export ANTHROPIC_API_KEY=sk-ant-...
pnpm e2e            # confirm a full run succeeds ~2 minutes before you present
docker compose up -d && pnpm dev
```

Open two windows: the app, and a terminal with the worker logs visible. Have a completed
run from `pnpm db:seed` already in the history — you will fall back to it if the network
misbehaves.

---

## 0:00 — The problem (25s)

> "Every accountant I've spoken to has the same hidden four hours: pulling numbers out of
> websites. Not hard work. Not fast work. And nobody wants to sign their name to a number a
> robot found."
>
> "So the interesting question isn't 'can a browser be automated.' It's 'can the output be
> trusted.' That's what this is built around."

## 0:25 — Instruct (20s)

Type:

> _Get the pricing tiers for Ramp, Brex, Expensify, Navan and Airbase — plan name, monthly
> price per user, and what's in the free tier._

Pause on the cost estimate before pressing anything.

> "It tells me what this will cost before I commit. About thirty cents. Agent products feel
> financially unbounded, and that feeling stops people using them more than the price does."

`⌘↵`.

## 0:45 — The plan (45s)

Steps stream in one at a time.

> "First thing it does is not browse. It plans, and shows me the plan before spending
> anything. Each step has a target, the data shape it expects back, and a risk level."

Hover the note on the Airbase step.

> "It already knows Airbase usually hides pricing behind a demo request. It's telling me
> that _now_, not discovering it in ninety seconds."

Point at the summary line.

> "And this sentence is the one that matters: which steps could do something irreversible.
> One does. It will stop and ask before it does."

Edit a target URL inline, then `⌘↵`.

> "Correcting it here costs three seconds. Correcting it after costs a run."

## 1:30 — Watch (75s)

> "Left is what it's thinking. Right is what it's actually doing. Same screen, always —
> because the whole question is whether those two match."

When the highlight appears before a click:

> "It outlines what it's about to click _before_ clicking. So I can hit space and stop it
> before, not after."

Open the reasoning drawer on the Enterprise tier.

> "Watch this. Enterprise says 'Custom.' It's writing: _that's not a number — I'll record
> null with a reason rather than invent a figure._"
>
> "That's the behaviour I'd want you to remember. An agent that guesses here is worse than
> no agent, because you'd never know which number was invented."

Point at the results table filling.

> "Results land as they're found. If I stop now, I keep everything found so far."

## 2:45 — The catch (60s)

The Critic card appears with two screenshots side by side.

> "Here's the part that justifies the architecture."
>
> "Five sites. Every extraction individually correct, and each one independently verified.
> But the Critic sees all of them _together_ — and Expensify's $5 was read off the annual
> toggle. The other four are monthly."
>
> "Any single-agent system passes this. Every claim checks out. You only catch it if
> something is looking _across_ claims, which is why the Critic is a separate agent with a
> separate job and no memory of how the numbers were produced."

Click **Re-extract at monthly**.

> "Eleven seconds. And the old value doesn't disappear — it's marked superseded, with who
> changed it and why. That's an audit trail."

## 3:45 — The deliverable (60s)

Export, open the file, go to the **Provenance** sheet.

> "Nineteen values. Mean confidence 0.94."
>
> "Every row: the page it came from, the exact text it was read from, a screenshot, the
> model, and the prompt version."
>
> "Three weeks from now, in a meeting, when a partner asks where a number came from — the
> answer isn't 'the AI found it.' It's a URL and a picture."

Scroll to **About this export**.

> "And it tells you what it _excluded_. Four values were dropped because the quoted text
> wasn't actually on the page. That's the fabrication check, and it runs with no model in
> the loop at all."

## 4:45 — Close (15s)

> "Three things I'd want to be judged on."
>
> "The verifier never sees the reasoning that produced a claim — an agent shown the argument
> agrees with it. Every number traces to a pixel. And the human is a participant, not a
> fallback: pause, approve, take over, hand back, all on the same message bus as the agents,
> with their messages winning."
>
> "About forty cents a run. It's deployed. Here's the URL."

---

## If something breaks

Let it. A recovery on camera demonstrates the reliability claim better than the happy path.

| Failure                | Say this                                                                               |
| ---------------------- | -------------------------------------------------------------------------------------- |
| Site down / redesigned | "That's what the recovery ladder is for" — then open the seeded replay.                |
| Model provider 429     | It retries and falls back automatically; narrate it.                                   |
| CAPTCHA                | Perfect — it asks you instead of burning ninety seconds failing.                       |
| Anything unexplained   | `/runs/:id/replay` on the seeded run. Replay is the backup, which is itself a feature. |

## Questions you will be asked

**"How is this different from Playwright plus GPT?"** Three things a script has no place to
put: a gate that classifies actions by reversibility before executing them, a verifier with
a deliberately isolated context, and claim-level provenance. The browsing is the easy part.

**"What does it cost?"** ~$0.40 per five-site run, ~$0.26 with cache hits. The Critic is
seven cents of that and it's the seven cents that caught the error.

**"What happens when it's wrong?"** Three layers: grounding rejects fabrication with no
model involved, verification re-derives a sample from source, the Critic looks across
claims. What survives all three still ships with a confidence score and a link to the pixel.

**"Why seven agents?"** Cost shaping and self-audit. An agent cannot check its own work —
the context that produced the error contains the reasoning that justified it.
