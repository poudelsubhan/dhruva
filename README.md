# Dhruva

A framework-agnostic supervisor that wraps an agent loop, checkpoints goal-state, detects semantic
drift, and rolls the agent back to its last verified checkpoint — **without destroying what it
learned along the way.** Rendered as a web flight recorder: live timeline, streaming coherence score,
checkpoint chain, knowledge ledger, and scrubbable replay.

Built for Long Horizon Agents Build Day · AGI House · Aug 22, 2026.

## Quickstart

```bash
make install          # uv sync + npm ci
cp .env.example .env  # then add your OPENAI_API_KEY (any OpenAI-compatible endpoint)
make dev              # backend :8000, frontend :5173
```

Open http://localhost:5173, pick a scenario, and hit **run with scenario**.

No API key? Everything still runs — the provider falls back to a mock, and `make demo-mock` serves
pre-recorded logs through the same UI.

```bash
make check                                   # lint + typecheck + tests (backend and frontend)
uv run python scripts/demo_scenario.py --scenario s2   # one scenario end to end, offline
uv run python scripts/mock_run.py            # regenerate the mock logs
```

## What it does

Every N steps the supervisor compresses the task into an **intent digest** (objective, constraints
verbatim, done-criteria, open subgoals), snapshots the working tree, and hash-chains the pair into a
checkpoint. Each window is scored:

```
C = 0.6·alignment + 0.2·repetition + 0.2·progress
```

Alignment is one judge call. Repetition is pairwise Levenshtein over recent actions — loop detection
with no model call. Progress is an external objective signal (passing tests / total). Two of three
terms are arithmetic, which is what makes runs reproducible.

On breach the supervisor restores the tree from the last **confirmed** checkpoint, audits the
knowledge ledger, rebuilds the agent's context from the digest (the poisoned history is never
replayed), verifies the agent's *proposed* next step before letting it act, and resumes.

### The part that is actually novel

Work state and knowledge are separated. The tree reverts; **verified learnings do not.** Anything
whose provenance traces to a poisoned observation or an injected instruction is evicted, and
everything else is carried into the rebuilt context — along with an explicit note about what was
discarded and why, which is itself an anti-drift signal.

The audit is deterministic and synchronous. No model call sits on the rollback path.

## Layout

| path | what lives there |
|---|---|
| `shared/schema/` | canonical JSON Schemas — Python and TypeScript both derive from these |
| `backend/contracts/` | typed mirrors, canonical JSON, the hash chain, the three adapter seams |
| `backend/harness/` | run controller state machine, append-only event store |
| `backend/verifier/` | composite coherence, judge call, verdict and escalation |
| `backend/checkpoint/` | intent compression, hash-chained minting, integrity walk |
| `backend/ledger/` | knowledge admission, taint audit, cross-run carryover |
| `backend/rollback/` | restore → audit → context rebuild → pre-flight → resume |
| `backend/inject/` | the three corruption scenarios |
| `backend/tasks/` | the `loglens` TaskPack |
| `fixtures/task_repo/` | the demo task: 12 failing tests over 3 independent groups |
| `frontend/src/` | tokens, core components, data layer, flight-recorder views |
| `config/thresholds.yaml` | the single tuning surface |
| `docs/build-decisions.md` | decisions more than one task depends on, and why |

## Configuration

All in `.env` (gitignored; `.env.example` lists the names):

| key | meaning |
|---|---|
| `DHRUVA_PROVIDER` | provider strategy; `openai_compat` today |
| `OPENAI_BASE_URL` | any OpenAI-compatible endpoint (default: OpenRouter) |
| `OPENAI_API_KEY` | key for that endpoint |

Model ids live in `backend/config.py`. The default pairing runs the agent on
`anthropic/claude-sonnet-5` and the judge on `openai/gpt-5-mini` — deliberately different families,
so the verifier is never grading the model that produced the work.

## Design notes

Two properties are load-bearing and easy to lose:

**The event log is the single source of truth.** The JSONL line on disk and the WebSocket frame are
byte-identical objects, so replay renders through the same code path as live rather than through a
second renderer that can drift.

**Ground truth is protected from the scenario that attacks it.** Progress is measured by running the
test suite, and scenario S3's corruption *is* an edit to the test suite. So progress counts only
twelve canonical test ids and hash-verifies every test file against a shipped baseline. Tampering
breaches immediately — an invalid measurement, not a low one.

## Status

Phases 0–3 complete. Three scenarios run injection → breach → rollback → resume → 12/12, each
producing byte-identical traces across two consecutive runs. 104 backend tests, 67 frontend tests,
ruff/mypy/oxlint/tsc clean.
