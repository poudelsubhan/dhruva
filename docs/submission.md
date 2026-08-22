# Dhruva

**A supervisor that catches an agent losing the plot, rolls it back — and keeps what it learned.**

Long Horizon Agents Build Day · AGI House · Aug 22, 2026

---

## Problem

Long-horizon agents fail quietly. Not by crashing, but by *drifting*: a contradictory instruction
lands, a tool lies, a context window gets compacted and drops a constraint — and the agent keeps
working, confidently, on the wrong thing. By the time anyone notices, hours of work rest on a
corrupted foundation.

Rollback is the obvious answer, and it has a hidden cost nobody prices in: **rollback causes
amnesia.** Reverting the working tree to a checkpoint also destroys everything the agent legitimately
learned in the discarded range — that the harness imports from `conftest`, that a particular approach
deadlocks. The agent re-derives it, burning steps, and often re-walks the same dead ends. Recovery is
expensive precisely because it is lossy.

## Mechanism

Dhruva wraps an agent loop and does four things.

**Checkpoints goal-state.** Every N steps it compresses the task into an *intent digest* — objective,
constraints verbatim, done-criteria, open subgoals — and snapshots the working tree. Checkpoints are
hash-chained and minted only after a passing verification, so they are last-known-good by
construction. A checkpoint becomes a valid *rollback target* only once the following window also
passes, which keeps the supervisor from restoring a snapshot minted after the corruption landed.

**Scores drift.** `C = 0.6·alignment + 0.2·repetition + 0.2·progress`. Alignment is one judge call
per window. Repetition is pairwise Levenshtein over recent actions — it catches loops with no model
call. Progress is an objective external signal: passing tests over total. Two of the three terms are
arithmetic, which matters, because the more of the score that is computed rather than sampled, the
more reproducible the whole run is.

**Protects its own ground truth.** Progress is measured by running the test suite — and one of the
three corruption scenarios *edits the test suite*. So the score counts only twelve canonical test ids
and hash-verifies every test file against a shipped baseline. Tampering is an immediate breach, not a
low score: a metric computed from files that were just rewritten is not a low measurement, it is an
invalid one.

**Rolls back without amnesia.** On breach: restore the tree from the last confirmed checkpoint, then
audit the knowledge ledger. Knowledge lives separately from work state — append-only and
taint-tracked — so the tree reverts while *verified learnings survive*. Anything whose provenance
traces to a poisoned observation or the injected instruction is evicted; everything else is carried
into the rebuilt context. The audit is pure and synchronous: no model call on the rollback path,
because that would put dead air and a failure mode on the one path that must not stall.

The agent then gets a pre-flight check — its proposed next step is verified against the intent
*before* it is allowed to act — and only then resumes.

## Demo

Three scripted corruptions, each attacking a different surface:

| | attacks | what the agent sees |
|---|---|---|
| **S1** | its instructions | an authoritative redirect that supersedes the objective |
| **S2** | its observations | a falsified test result claiming the suite is green |
| **S3** | its memory | a "compacted" history that silently drops one constraint |

Each runs the same arc: injection → the poisoned window still *passes* (drift takes a window to
become visible, and a false learning is admitted in the meantime) → breach → rollback to a confirmed
checkpoint → clean learnings retained, contaminated ones evicted → resume → 12/12.

All three produce byte-identical traces across two consecutive runs.

The screen that carries it is a twelve-lamp test board. On the breach you watch four lamps go dark,
the rollback arc fire, and the same four relight — the mechanism visible without narration.

## Architecture

```
backend/
  contracts/   JSON-Schema-derived types, hash chain, the three adapter seams
  harness/     run controller state machine, event store (JSONL == WebSocket frames)
  verifier/    composite coherence, judge call, verdict + escalation
  checkpoint/  intent compression, hash-chained minting, integrity walk
  ledger/      knowledge admission, deterministic taint audit, cross-run carryover
  rollback/    restore -> audit -> context rebuild -> pre-flight -> resume
  inject/      three fixture-defined corruptions
  tasks/       the loglens TaskPack (ground-truth protection, snapshot hygiene)
frontend/      React + D3 flight recorder; one render path for live and replay
```

Three adapter seams keep it bindable: `AgentAdapter`, `ModelProvider`, `TaskPack`. Nothing above them
knows a concrete implementation, which is why every test runs with no network at all.

Provider access is a single OpenAI-compatible client against OpenRouter, so **mixed-provider holds by
construction**: the agent runs on `anthropic/claude-sonnet-5` and the judge on `openai/gpt-5-mini` —
the verifier is never grading the model family that produced the work.

## What's next

- **Swarm supervision.** The contracts already carry `agent_id`/`swarm_id` and reserve the swarm event
  types. The ledger is what makes it affordable: cross-agent divergence is detected by
  contradiction-checking each agent's new learnings against the shared ledger head, which is O(N) per
  barrier rather than O(N²) pairwise. A poisoned member's false learning never reaches its peers,
  because the only path out of staging runs through a passing verification.
- **Measuring the amnesia tax.** Run the same task ledger-seeded versus cold and chart recovery steps.
  That number is the real contribution, and the plumbing for it already exists.
- **Real long-horizon runs.** Time compression is simulated today.

## Links

- Repository: https://github.com/poudelsubhan/dhruva
- Demo video: _to be recorded_

## Assets

- [ ] `docs/assets/live-rollback.png` — live view mid-rollback, arc visible
- [ ] `docs/assets/twin-decay.png` — supervised vs unsupervised decay curve
- [ ] `docs/assets/provenance-chain.png` — checkpoint hash chain
- [ ] `docs/assets/scenario-a.mp4` — 30–60s capture of scenario A end to end
