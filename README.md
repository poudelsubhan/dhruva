# Dhruva

**A supervisor that catches an agent losing the plot, rolls it back — and keeps what it learned.**

Long-running AI agents don't fail by crashing. They *drift*: a tool returns something false, a
constraint gets summarised away when the context is compacted, an instruction contradicts the
original goal — and the agent keeps working, confidently, on the wrong thing. Nothing throws. The
logs look busy.

The obvious fix is to snapshot progress and roll back when things go wrong. But rollback as normally
built is **lossy**: reverting the files also destroys everything the agent legitimately figured out
along the way, so it re-derives the same facts and re-walks the same dead ends.

> **What if you could revert the damage without reverting the understanding?**

That is the whole of Dhruva. It watches an agent work, scores whether each stretch of work still
serves the original goal, snapshots known-good states, and when it detects drift it restores the
files **while keeping the knowledge** — minus whatever can be traced back to the corruption.

---

## In plain English

Imagine hiring a contractor to renovate a room, and you can only check on them every hour.

Most of the time that's fine. But suppose that partway through, someone walks in and tells them
"actually, the client changed their mind, knock out that wall instead" — and it isn't true. Or their
tape measure is faulty and every measurement they take is wrong. Or they lose the page of notes with
the one instruction that mattered. The contractor isn't lazy or malicious. They keep working hard,
confidently, on the wrong thing, and you don't find out until you next walk in.

AI agents that run for hours have exactly this problem, and today there's essentially nothing
watching. The agent is its own judge of whether it's on track — which is a bit like asking the
contractor whether the room looks right.

**So the first thing Dhruva does is take photographs.** Every so often it writes down what the goal
actually was, in a compressed form, and takes a snapshot of the work so far. It only takes a
photograph when it has independently confirmed the work is still on track, so every snapshot is a
state you'd be happy to return to.

**The second thing is checking the work — but not by asking the agent.** Three signals, combined:

- A *second AI, from a different vendor*, reads what the agent just did and rates how well it serves
  the stated goal. Deliberately a different vendor, so it isn't grading its own homework.
- A plain arithmetic check for whether the agent is repeating itself, which is what going in circles
  looks like from outside.
- A hard external fact: in the demo, how many of the twelve tests actually pass. Not an opinion.

Two of those three are arithmetic rather than judgement, which matters — it means the system's
verdict doesn't swing on one AI's mood.

**The third thing is what happens when it detects drift**, and this is the part that's genuinely
different. It restores the files from the last confirmed-good snapshot. But it does *not* wipe the
agent's memory. Along the way the agent has learned real things — this function behaves unexpectedly,
that approach doesn't work. Those are worth keeping. What isn't worth keeping is anything the agent
concluded *because of the corruption*.

So Dhruva tracks where every belief came from. When it rolls back, it walks that record and asks of
each one: does this trace back to the bad information? If yes, it's thrown out. If the agent
established it before the corruption arrived, it survives — and gets handed back to the agent, along
with an explicit note that it was wrong about the specific thing it was fooled on. Being told "you
believed the tests passed; they didn't" is itself useful information.

**Why the distinction matters.** Consider the three things you could do with the agent's beliefs
after a rollback:

- **Keep everything.** The agent still believes the lie that caused the problem. It'll walk straight
  back into it.
- **Throw away everything from the affected period.** Safe, but you've destroyed real understanding —
  this is the amnesia, and it's what "rollback" means if you don't track where beliefs came from.
- **Throw away only what traces to the corruption.** Requires knowing the provenance of every belief.

Measured on a real run, the middle option destroys a genuine piece of knowledge the agent had
earned, and the first carries the false belief forward. Only the third gets both right.

**Does the supervision actually help?** The honest way to answer is to run the same job twice, with
the identical sabotage at the identical moment, and let the supervisor intervene in only one of them.
Supervised finished the job completely. Unsupervised finished with **nothing** working — it had been
talked into rewriting the wrong thing and never recovered. Notably the unsupervised run *detected*
the problem too; it simply wasn't allowed to act. That's what makes it a fair comparison rather than
a rigged one.

---

## The result

Same task, same sabotage, same schedule. The only variable is whether the supervisor may intervene:

| | outcome | drift detected | rollbacks |
|---|---|---|---|
| **supervised** | **12/12 tests passing** | 1 | 1 |
| unsupervised | **0/12** | 2 | 0 |

And the precision of the knowledge audit, scored three ways over the same run — ground truth taken
from the fixture's own record of what was poisoned, so this is measured rather than asserted:

| policy | beliefs kept | genuine knowledge lost | false belief retained |
|---|---|---|---|
| keep everything | 3 | 0 | **1** |
| discard the whole affected range | 1 | **1** | 0 |
| **discard by provenance** | 2 | **0** | **0** |

Reproduce both with `make demo-all` and `make measure`.

---

## How it works

Every five steps, the supervisor closes a **window** and scores it:

```
coherence = 0.6 × alignment + 0.2 × non-repetition + 0.2 × progress
```

`alignment` is the cross-vendor judge call. `non-repetition` is pairwise string distance over recent
actions — loop detection with no model call. `progress` is the external signal (passing tests over
total). Thresholds are **calibrated**, not guessed: `scripts/calibrate.py` runs clean, sabotage-free
runs, records where coherence actually bottoms out, and sets the alarm a margin below that. Before
calibration the warning line sat 0.008 under the clean floor — a correct run was one unlucky sample
from a false alarm.

On a passing window it mints a **checkpoint**: the compressed goal plus a snapshot, hash-chained to
its predecessor so tampering is detectable. A checkpoint only becomes a valid *rollback target* once
the window after it also passes — otherwise you can restore a snapshot taken *during* the corruption.

On a breach: halt, restore from the last confirmed checkpoint, audit the knowledge ledger, rebuild
the agent's context from the compressed goal (the corrupted history is never replayed), then require
the agent to *propose* its next step and verify that proposal **before** letting it act.

The knowledge audit is deliberately pure arithmetic — no model call on the rollback path, because
that path must not stall and because model randomness there would make runs unreproducible.

---

## Architecture

```
shared/schema/     canonical JSON Schemas — Python and TypeScript both derive from these
backend/
  contracts/       typed mirrors, canonical JSON, hash chain, the three adapter seams
  harness/         run controller state machine; append-only event log
  verifier/        composite coherence, judge call, verdict and escalation
  checkpoint/      goal compression, hash-chained minting, integrity walk
  ledger/          knowledge admission, provenance-based eviction, cross-run carryover
  rollback/        restore → audit → context rebuild → pre-flight → resume
  inject/          the three sabotage scenarios
  tasks/           the demo task, and protection of its own ground truth
frontend/src/      design tokens, core components, flight-recorder views
```

Three **adapter seams** — `AgentAdapter`, `ModelProvider`, `TaskPack` — are the only places that know
about a specific agent framework, model vendor, or task. Nothing above them does, which is why the
entire test suite runs with no network access.

The event log is the single source of truth: the line written to disk and the frame sent to the
browser are the same object, so replay renders through the identical code path as live rather than a
second implementation that can drift from it.

---

## Running it

```bash
make install                     # Python 3.12 via uv, plus npm
cp .env.example .env             # add OPENAI_API_KEY (any OpenAI-compatible endpoint)
make dev                         # backend :8000, frontend :5173
```

Open http://localhost:5173, pick a scenario, press **run with scenario**.

No API key? Everything still runs — the model provider falls back to a mock and the canned replays
work unchanged.

```bash
make demo-all     # all three sabotage scenarios, twice each, proving identical traces
make measure      # the knowledge-audit precision table
make check        # 109 backend tests, 90 frontend tests, linters, type checkers
```

**For a presentation:** `http://localhost:5173/?demo=1` boots straight into a one-minute replay of a
real run, paused on the first event. Space plays and pauses, `R` restarts, and a label names the beat
on screen. Slides are `docs/slides.html` (`?s=N` jumps to a slide) with `docs/dhruva.pptx` as a
fallback; the run of show is `docs/demo-script.md`.

---

## How to use it for your company

Everything here runs against a small demo task so there is something to show. Pointing it at real
work means implementing three interfaces, and only the third takes real thought.

**1. Wrap your agent** (`AgentAdapter`). Five methods: start a task, take one step, add messages to
its context, read its context, replace its context. The one that matters is
`step(execute=False)` — return what the agent *would* do next without doing it. That's the pre-flight
hook, and it's what lets the supervisor check a proposal before it becomes an action. If your
framework has no context API, wrap at the model-call layer instead; the sabotage scenarios then
mutate the message buffer one level down, with the same observable effect.

**2. Point at your models** (`ModelProvider`). One method. Any OpenAI-compatible endpoint works. Run
the judge on a different vendor than the agent — it costs nothing and removes an obvious objection.

**3. Describe your task** (`TaskPack`). This is the real work, and it's where the honesty of the whole
system lives:

- **`progress()` must be an external fact, not a model's opinion.** Tests passing, records
  reconciled, rows validated, a build succeeding. The moment progress becomes something an AI judges,
  a drifting agent can talk its way into looking productive.
- **`snapshot()` / `restore()`** — whatever "the work so far" means for you. Files are the easy case;
  a database needs a transaction boundary or a copied schema.
- **Protect your ground truth.** In the demo, progress is measured by running a test suite — and one
  of the three sabotage scenarios *edits the test suite*. So the pack counts only a fixed list of
  known test IDs and hash-checks the test files against a baseline. Tampering is treated as an
  immediate alarm, not a low score, because a number computed from files that were just rewritten
  isn't a low measurement — it's an invalid one. **Whatever your progress signal is, ask what happens
  if the agent can edit it.**

**Then calibrate.** Run `scripts/calibrate.py` against a few clean runs of *your* task and let it set
the thresholds. Inherited numbers from someone else's task are how you get false alarms on correct
work.

What this does not do yet: run more than one agent at a time (the data model reserves the fields, but
it isn't built), persist across restarts, or handle multiple users. Those are integrations. The part
described above — turning "the agent seems busy" into "it drifted at step 12, here is the state
before that, and here is what it correctly learned" — is what's built.

---

### Verifying it rather than trusting it

```bash
make check        # 199 tests, no network calls anywhere in the suite
make demo-all     # each scenario twice; fails loudly if any trace differs
make measure      # knowledge-audit precision, scored against the fixture's own record
```

`make demo-all` is the one that matters. Reproducibility is not decoration here: if the same sabotage
at the same moment produces a different outcome each run, none of the numbers above mean anything.
Two of the three coherence terms are arithmetic and the knowledge audit involves no model call, which
is *why* it reproduces.

One honest note on the test suite: it mocks the AI judge, which keeps it fast and free — and made it
blind to five real defects that only appeared when a live model was scoring live windows. Each is
written up in [`docs/build-decisions.md`](docs/build-decisions.md) (D11). Four shared a single cause:
state that outlived the situation it described. Mocked tests verify mechanism; they cannot verify
judgement under real input.

---

## Keywords

`ai-agents` · `agent-supervision` · `long-horizon-agents` · `goal-drift` ·
`semantic-drift-detection` · `agent-observability` · `checkpointing` · `rollback` ·
`state-restoration` · `hash-chain` · `provenance-tracking` · `taint-analysis` ·
`contamination-eviction` · `agent-memory` · `knowledge-ledger` · `prompt-injection` ·
`tool-output-poisoning` · `context-compaction` · `llm-as-judge` · `mixed-provider-verification` ·
`ground-truth-protection` · `threshold-calibration` · `determinism` · `event-sourcing` ·
`append-only-log` · `replay` · `flight-recorder` · `ab-testing` · `control-arm` ·
`adapter-pattern` · `python` · `fastapi` · `websockets` · `pydantic` · `json-schema` ·
`react` · `typescript` · `vite` · `tailwindcss` · `d3` · `openrouter` · `anthropic` · `openai`

*Topics: agent supervision · goal drift detection · rollback without amnesia · provenance-based
contamination eviction · knowledge ledgers · hash-chained checkpoints · prompt injection and tool
poisoning · LLM-as-judge with cross-vendor verification · ground-truth protection · deterministic
replay · event sourcing · FastAPI · React · D3*
