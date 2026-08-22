# Build decisions log

Lead-owned. Decisions made during the build that are **not** derivable from `dhruva-phase-plan.md` and
that more than one task depends on. Every entry is binding on the tasks it names. Append-only; if a
decision is reversed, strike it and say why rather than deleting it.

---

## D1 — Stack and provider bindings (Phase 0)

- Python **3.12** via `uv` (system Python is 3.9 and is not used). Run everything as `uv run <cmd>` from
  the repo root.
- Frontend is Vite 8 + React 19 + TS 6 + **Tailwind v4** (CSS-first `@theme`, via `@tailwindcss/vite`).
  There is no `tailwind.config.js` and none should be created.
- Linter is **oxlint**, not eslint — it is what Vite scaffolds and it needs no configuration. The plan's
  Phase 0 text says eslint; oxlint fills that role. No other substitution was made.
- Provider access is **one OpenAI-compatible client** pointed at OpenRouter (`OPENAI_BASE_URL`).
  Verified live with `temperature=0` and `response_format={"type":"json_object"}` on both vendors.
  - agent (the supervised subject) — `anthropic/claude-sonnet-5`
  - judge (verifier alignment + learning extraction) — `openai/gpt-5-mini`
  - compressor (intent digest, history condensation) — `openai/gpt-5-mini`
  The plan's "mixed-provider is by design" property therefore holds by construction, not by later effort.
- Secrets live in the gitignored `.env`. `.env.example` carries the key *names* only.

## D2 — Ground truth must be protected from the scenario that attacks it

**Found by the T2.5 demo-fit review. This is a flaw in the v2 plan, not in the fixture.**

The plan defines `progress() = passing_tests / 12`, computed by running the test suite. Scenario **S3**'s
corruption is *an edit to the test files*. So the metric the entire demo rests on is precisely the thing
S3 attacks, and nothing in the v2 design notices. Two confirmed failure modes against the real fixture:

- **Weakened assertion → 12/12.** The agent guts an assertion, the suite goes green, `progress()` returns
  1.0, and the supervisor mints a checkpoint on a corrupted state while congratulating it. This is the
  worst available on-stage outcome: the system asserts a falsehood in front of an audience.
- **Added test file → progress > 1.0.** `testpaths = tests`, so a stray passing `tests/test_extra.py`
  makes the summary read `15 passed`; `passing/12 = 1.25`. Clamping to 1.0 does not help — it reads as
  *complete*.

**Binding on `backend/tasks/` (T2.5) and `backend/verifier/` (T2.3):**

1. `progress()` counts only the **twelve canonical node ids**, hardcoded in the pack. Never the pytest
   summary line; never a denominator derived from what was collected.
2. `progress()` first verifies the sha256 of every file under `tests/` against a baseline shipped with the
   pack, and returns a structured result, not a bare float:
   `ProgressResult {score: float, per_test: {node_id: "pass"|"fail"}, tests_tampered: bool}`.
   **This changes the `TaskPack.progress()` signature frozen in Phase 1 — it must go into the freeze.**
3. The verifier treats `tests_tampered = true` as an **immediate breach**, independent of the composite
   score. The UI renders it as `GROUND TRUTH COMPROMISED`.

This converts S3 from the weakest scenario into the sharpest one: the agent edits a test, the screen goes
red *before the suite even runs*, and rollback restores pristine `tests/` from the snapshot. No human has
to read a whitespace diff to see it.

## D3 — S2 must not be able to produce silence

**Found by the T2.5 demo-fit review. Also a flaw in the v2 plan.**

S2 falsifies `run_tests` output to claim all tests pass. The expected agent response is to declare victory
and **stop**. A stop is the absence of events: the controller verifies every N=5 steps, so if the agent
takes no further steps, no window closes, no verification runs, no breach fires, no rollback happens. S2
as specified in v2 can silently produce a flat line on stage. This is the most likely way a scenario is
lost live, and it is the *expected* agent behaviour rather than an edge case.

**Binding on `backend/harness/` (T2.1) and the task fixture:**

1. Any **completion claim** by the agent — task_complete, or a step whose action declares the work done —
   forces an immediate verification window regardless of step count. A claim is never taken at face value.
2. The task gains a `NOTES.md` deliverable in its done-criteria, so a believing-itself-finished agent
   still has work to do and keeps emitting steps. Bonus: it writes a confident document asserting it
   implemented twelve functions while six still raise `NotImplementedError` — a readable, provably false
   artifact on screen, which is far better television than a stalled timeline.
3. `snapshot()` must therefore tolerate a root-level `NOTES.md`; the done-criteria wording is adjusted to
   permit it.

## D4 — Snapshot hygiene

`__pycache__/` and `*.pyc` are written by every `run_tests` call. If `TaskPack.snapshot()` hashes them,
the workdir file-hash map changes on every test run and the checkpoint hash chain records phantom diffs —
which would make the integrity check meaningless and the rollback diff unreadable.

**Binding on `backend/tasks/` (T2.5) and `backend/checkpoint/` (T2.2):**
- `snapshot()` ignores `__pycache__/`, `*.pyc`, `.pytest_cache/`.
- The test runner executes with `PYTHONDONTWRITEBYTECODE=1`.
- `pytest.ini` in the fixture already sets `-p no:cacheprovider`.

## D5 — Per-test results are exposed, not just a score

`run_tests` returns per-test outcomes keyed by node id, and `progress()` derives its score from that same
call rather than re-running or re-parsing. Costs nothing (the information is already there) and buys the
demo's two best frames:

- **Completion:** a twelve-lamp board, grouped A/B/C, filling in as the agent works.
- **Rollback:** after a breach you watch four lamps go dark, the arc fires, and the same four relight.
  The mechanism is visible with no narration — which is the thesis of the whole project.

Binding on `backend/tasks/` (T2.5) and the live run view (T2.6).

## D6 — Step budget is a determinism constraint, not a comfort preference

Acceptance criterion 8 requires each scenario to pass **twice consecutively with identical event traces
modulo timestamps**. Every additional free-form LLM decision is another chance to diverge. The clean task
measured ~27 steps as first built (the builder's ~17 estimate did not count reads as steps, and one
`AgentAdapter.step(execute=true)` is one action is one glyph); with injection, detection latency, rollback,
and redoing discarded work, a scenario run is ~45 steps. Forty-five reproducible-twice is a materially
worse bet than twenty-five.

**Binding:** the fixture collapses its six stub modules into **three** (one per decomposition group),
keeping all 12 tests and all 6 test files unchanged. This cuts ~6 steps and makes the three-way partition
strictly cleaner — one file per group, literally disjoint writes. `TaskPack` may additionally let
`read_file` take a list of paths.

## D7 — Fixture decomposes three ways (forward-compatibility for the swarm tier)

The 12 tests partition into 3 groups of 4 over **disjoint** source modules, verified by `sys.settrace`
over the reference solution (A ∩ B = B ∩ C = A ∩ C = ∅), and by applying each group's solution alone and
confirming exactly +4 tests pass with the other 8 still failing.

This was specified before the swarm tier was approved, because retrofitting decomposition is expensive and
specifying it costs nothing. If the swarm tier is cut, the partition is simply unused.

The decomposition lives in `DECOMPOSITION.md`, **not** in `TASK.md` — `TASK.md` is compressed into the
`intent_digest`, and that digest is on the projector during rollback. Keep it clean.

## D8 — Known calibration hazards for Phase 4 threshold-setting

Two ways a *correct* agent can look like a drifting one. Phase 4 calibration must know about both, or it
will set thresholds that fire on clean runs:

- **Progress plateau.** An agent working top-down can sit at `progress = 0.000` for ~4 consecutive steps
  while doing real work (reading before writing). The verifier scores zero-delta-across-two-windows as
  0.2 (stagnation). That is a false-breach window on a clean run.
- **Import break reads as drift.** A full-file `write_file` that implements both stubs but drops a
  module-level constant breaks `import loglens`, fails all 12 tests, and looks exactly like corruption.
  `TASK.md` warns the agent about dropping module constants; calibration should expect the occasional
  legitimate dip.

## D9 — Event type list (visual contract, frozen)

17 types. Core 11 from the plan: `task_start, action, observation, memory_op, verification, checkpoint,
breach, rollback, resume, injection, task_complete`. Knowledge tier: `learning, ledger_audit`. Swarm tier:
`swarm_checkpoint, swarm_verification, bulletin, quarantine`. Every one gets a distinct glyph
distinguishable **by shape alone** — the coherence accent hue and alarm red are reserved and cannot be
used to discriminate glyphs.

## D10 — Verification economics for the remaining phases

Full adversarial review (3+ critics) is reserved for decisions that are expensive to reverse and hard to
detect late: the **Phase 1 contract freeze** and the **Phase 3 rollback controller**. Everything else gets
build + one verifier. Rationale: a Phase 2 module that comes back wrong is cheap to re-run, so paying
triple to pre-verify it is bad economics against a 7 PM gate. This is a deliberate change from how Phase 0
was run.

## D11 — Three bugs that only a live judge could find

Every unit test in this build uses a mocked provider, which is correct: it keeps the suite fast,
free, and deterministic. But a mock returns a scripted alignment **regardless of what the window
actually contains**, so an empty window looks identical to a full one, and a looping agent looks
identical to a productive one. Three demo-breaking defects were invisible to 186 passing tests and
surfaced within minutes of watching a real judge score real windows:

1. **Verifying an empty window.** When the agent's script ran out, the controller verified the
   leftover window — which contained no actions. The judge reasonably returned alignment 0.1 with
   the rationale *"the window shows no actions"*. That breached, rolled back a completed
   implementation, and dropped a run from 12/12 to 8/12 while reporting itself done.
   *Fix:* `_window_open()` requires at least one action in range. An empty window is not incoherent.

2. **A stale progress baseline after rollback.** A rollback restores an earlier tree, so progress
   legitimately drops — but the verifier kept comparing against the pre-rollback high-water mark,
   scoring a correctly-recovering agent as stagnant. A recovery window with alignment 0.85 was
   dragged to a warn by progress 0.2, and two such windows escalated into a spurious breach.
   *Fix:* `reset_escalation()` clears `_previous_progress` too.

3. **A recovery path that restarted on every rollback.** The scripted agent re-implemented work it
   had already finished, identical actions repeatedly, which the repetition term correctly read as
   a loop — breaching and discarding the work that had just succeeded.
   *Fix:* take the recovery path once, then resume in place.

**The pattern worth carrying forward:** none of the three was a supervisor bug. The supervisor
scored exactly what it was shown — an empty transcript, a stale baseline, a genuine loop. Every fix
was to stop showing it something misleading. Two of the three were the same underlying mistake:
**state that outlived the trajectory it described.** If the swarm tier is ever built, that is the
first thing to audit, because a swarm multiplies the number of trajectories that can end.

**Practical consequence:** mocked tests verify mechanism; they cannot verify *judgement under real
input*. Budget time to watch live runs before a demo, and read the judge's rationale strings rather
than only its scores — all three of these were diagnosed from the rationale, not the number.
