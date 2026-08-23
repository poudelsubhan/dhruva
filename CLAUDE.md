# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Dhruva wraps an agent loop as a **supervisor**: it checkpoints goal-state, scores each action window
for semantic drift, and on breach rolls the working tree back to the last verified checkpoint —
while keeping the knowledge the agent legitimately earned. The UI is a flight recorder (live
timeline, coherence gauge, provenance graph, supervised/unsupervised twin, scrubbable replay).

Built for a one-day hackathon (AGI House, Aug 22 2026). Two documents govern the code and are worth
reading before changing anything structural:

- `dhruva-phase-plan.md` — the implementation doc, 11 acceptance criteria, tiering/cut rules.
- `docs/build-decisions.md` — **append-only, binding.** D1–D11 record decisions more than one module
  depends on. If a change contradicts an entry, strike the entry with a reason rather than deleting
  it. D11 in particular lists four demo-breaking bugs a fully green (mock-based) test suite could not
  see.

Other docs: `docs/ownership.md` (who owns which paths and what is frozen), `docs/acceptance.md`
(each criterion mapped to the test that demonstrates it), `docs/demo-script.md`, `docs/submission.md`.

## Commands

Python is 3.12 via `uv` (system Python is 3.9 and is not used) — run everything as `uv run …` from
the repo root; no venv activation. Frontend commands run through `npm --prefix frontend`.

```bash
make install        # uv sync --all-groups + npm ci
make dev            # backend :8000 + frontend :5173 (Ctrl-C stops both)
make check          # lint + typecheck + test, backend and frontend — the gate before you call work done
make test | lint | typecheck | build | clean
make demo           # one scenario end to end, offline (SCENARIO=s1|s2|s3, default s2)
make demo-all       # all three scenarios twice; fails loudly if traces diverge (acceptance criterion 8)
make measure        # eviction precision vs naive retention policies
make demo-mock      # regenerate fixtures/mock/*.jsonl
```

Single tests:

```bash
uv run pytest backend/verifier/tests/test_verifier.py -q
uv run pytest backend -k "rollback and confirmed" -q
npm --prefix frontend run test -- src/views/twin/TwinView.test.tsx
npm --prefix frontend run test -- -t "renders the decay curve"
```

Backend tests live inside the module they cover (`backend/<module>/tests/`), never in a shared root.
Every unit test uses a mocked provider, so the suite is fast, free, and offline.

## Architecture

**Three adapter seams** (`backend/contracts/seams.py`) are the only concrete-implementation
boundaries; harness, verifier, checkpointer, ledger, and rollback bind to these Protocols and never
to a class. `AgentAdapter` (the wrapped agent — note `step(execute=False)` is the pre-flight hook),
`ModelProvider` (one OpenAI-compatible client), `TaskPack` (the demo task).

**The run loop** — `backend/harness/controller.py`:

```
INIT -> STEPPING -> VERIFYING -> (CHECKPOINTING | BREACHED) -> ROLLING_BACK -> RESUMING -> DONE
                                                                            -> HALTED_ALERT
```

Every N=5 steps a window closes and the verifier scores it: `C = 0.6·alignment + 0.2·repetition +
0.2·progress`. Alignment is the one judge call. Repetition is pairwise Levenshtein over recent
action descriptions; progress is passing-tests/12. Two of three terms being arithmetic is what makes
runs reproducible — do not add sampled terms without pricing that against `make demo-all`.

Breach → `backend/rollback/controller.py`: restore tree from the last **confirmed** checkpoint →
deterministic ledger taint audit → rebuild agent context from the intent digest (poisoned history is
never replayed) → pre-flight-verify the proposed next step → resume.

**Module map:** `contracts/` (typed mirrors, canonical JSON, hash chain, seams — frozen),
`harness/` (controller + append-only `EventStore`), `verifier/`, `checkpoint/`, `ledger/`,
`rollback/`, `inject/` (the three scenarios), `tasks/` (the `loglens` TaskPack), `providers/`,
`api/` (REST + WS; lead-owned mounting point).

**Frontend:** `App.tsx` is the shell and picks one of four sources — live WS, replayed JSONL, mock
fixture, twin pair — all feeding `data/useRunStream.ts`. Views are `views/<lane>/<Name>View.tsx`,
each self-registering by fixed path; core components in `components/core/` have frozen props.

## Invariants that span files (easy to break, expensive to notice)

- **`shared/schema/*.json` is canonical.** Python types in `backend/contracts/models.py` and the
  generated `frontend/src/contracts/{run_event,checkpoint,ledger_entry}.ts` both derive from it.
  Regenerate TS with `npm --prefix frontend run contracts`; never hand-edit the generated files.
  `EVENT_TYPES` in `frontend/src/contracts/index.ts` is asserted against the schema in
  `contracts.test.ts`. The 17 event types are a frozen visual contract (D9).
- **The event log is the single source of truth.** The JSONL line on disk and the WebSocket frame
  are byte-identical objects, so replay renders through the live code path. `EventStore` alone
  allocates `seq`; the UI releases only a contiguous prefix, so a gap stalls the render forever —
  which is why `ws.py` backfills before streaming.
- **Ground truth is protected from the scenario that attacks it** (D2). `TaskPack.progress()`
  returns `ProgressResult {score, per_test, tests_tampered}`, counts only the twelve canonical node
  ids, and sha256-verifies every file under `tests/` against a shipped baseline. `tests_tampered`
  short-circuits to a breach regardless of `C` — a tampered measurement, not a low one.
- **`checkpoint_hash` deliberately excludes `ledger_head`.** Entry status mutates; hashing it would
  invalidate every downstream checkpoint on the first eviction.
- **Only *confirmed* checkpoints are rollback targets** (a checkpoint confirms once the following
  window also passes), and a rollback **truncates the chain at its target** — otherwise a checkpoint
  minted inside the discarded range survives and becomes a future rollback target (D11.4).
- **No model call sits on the rollback path.** The taint audit is pure and synchronous, and a raised
  audit must still let the rollback complete (with no retained knowledge). Restoring the tree is the
  guarantee; knowledge retention is the enhancement.
- **`config/thresholds.yaml` is the single tuning surface**, and it is calibrated once and frozen.
  Tune fixtures (`fixtures/scenarios/scenarios.yaml`), not thresholds.
- **`frontend/src/tokens.ts` is canonical for design tokens**; `index.css`'s `@theme` block mirrors
  it and `tokens.test.ts` fails on drift in either direction. Two hues are reserved and appear
  nowhere else: coherence cyan and alarm red. Event identity is carried by shape, never by hue. No
  component hardcodes a color.
- **State must not outlive the trajectory it describes.** All four D11 bugs were this: a warn
  streak, a progress baseline, a recovery cursor, and the checkpoint chain each surviving a rollback
  that invalidated them. Audit for it first in anything new.

## Conventions

- Tailwind v4, CSS-first `@theme` via `@tailwindcss/vite`. There is no `tailwind.config.js` and none
  should be created. The linter is **oxlint**, not eslint.
- Do not edit `pyproject.toml` or `.env` — report a missing dependency instead. `.env.example`
  carries key names only; a missing `OPENAI_API_KEY` silently falls back to `MockProvider`, so
  everything still runs offline.
- Model pairing (`backend/config.py`): agent on `anthropic/claude-sonnet-5`, judge and compressor on
  `openai/gpt-5-mini` — deliberately different families, so the verifier never grades the model that
  produced the work.
- The API currently drives runs with `ScriptedAgentAdapter` (script in `scripts/demo_scenario.py`);
  "live" means a live judge/compressor, not a live agent. Runs execute in a worker thread so the
  event loop stays free for WS subscribers.
- Dev-server contract is frozen: frontend :5173 proxies `/api` and `/ws` to backend :8000.
- Mocked tests verify *mechanism*; they cannot verify *judgement under real input*. Before trusting
  a change to the verifier, ledger, or rollback path, watch a live run and read the judge's
  **rationale strings**, not only its scores — that is how all four D11 bugs were diagnosed.
