# Dhruva — submission draft

> **DRAFT.** Skeleton written in Phase 0; filled with day-of facts in Phase 6 (T6.1).
> Hard gate: platform draft saved before 7:00 PM.

## Problem

Long-horizon agents don't fail loudly — they drift. A contradictory instruction, a poisoned tool
result, or a lossy context compaction quietly rewrites what the agent thinks it is doing, and the
loop keeps running confidently against the wrong objective. Nothing in a standard agent stack
notices, because nothing is holding the original goal-state to compare against.

## Mechanism

Dhruva wraps the agent loop as a supervisor. It compresses the objective into an intent digest and
mints hash-chained checkpoints only on verified-coherent states; every N steps a judge scores the
action window against that digest on three axes — alignment, repetition, progress — into a composite
coherence score. When coherence breaches threshold, Dhruva halts stepping, restores the workdir from
the last checkpoint whose chain passes integrity, rebuilds the agent's context from the digest
instead of replaying the poisoned history, gates the resume behind a pre-flight re-verification of
the agent's *proposed* next step, and continues. The poisoned span is never replayed.

## Demo

Three scripted corruptions — contradictory instruction, poisoned tool output, simulated compaction
loss — are armed from the UI against a real coding task (make 12 failing tests pass without touching
the test files). Twin mode runs supervised and unsupervised agents on the identical task and
injection schedule side by side: the supervised run breaches, rolls back, and completes; the
unsupervised run's coherence decays, and the UI marks its computed half-life.

<!-- DRAFT: replace with the actual scenario, run ID, and timings captured in Phase 6. -->

## Architecture

FastAPI + asyncio backend, React + TypeScript + D3 frontend, one append-only JSONL event log per run
that is broadcast verbatim over `/ws/runs/{id}` — live view and replay render from the same source of
truth. Three adapter seams keep it framework-agnostic: `AgentAdapter` (the wrapped agent),
`ModelProvider` (any OpenAI-compatible endpoint), and `TaskPack` (the demo task). The judge can run
on a different provider than the agent; mixed-provider is by design.

<!-- DRAFT: note which agent framework / provider / task the day-of mandate bound us to (Phase 5). -->

## What's next

Drift detection beyond scripted scenarios: learned thresholds instead of calibrated ones, checkpoint
minting driven by semantic novelty rather than a fixed step interval, and durable run history so the
provenance graph spans sessions rather than a single demo.

## Assets

Captured in Phase 6 (T6.1), stored under `docs/assets/`.

- [ ] Live view mid-rollback screenshot — `docs/assets/live-rollback.png`
- [ ] Twin decay curve with half-life marker screenshot — `docs/assets/twin-decay-curve.png`
- [ ] Provenance chain screenshot — `docs/assets/provenance-chain.png`
- [ ] 30–60 s screen capture of scenario A end to end — `docs/assets/scenario-a.mp4`

## Links

- Repo: <https://github.com/poudelsubhan/dhruva>
- Demo video: _DRAFT — URL pending Phase 6 capture._
