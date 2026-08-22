# Ownership map — Phase 2/3

One task = one owner = one file set. Tasks in the same phase touch **disjoint** sets, which is what
makes the phase coordination-free. Everything shared is frozen in Phase 1 and read-only thereafter.

If you need a file outside your set, that is an interface change: stop and renegotiate rather than
reaching across. Per the plan's rules in force, an interface change mid-phase stops the phase.

## Frozen, read-only for every Phase 2/3 task

| Path | Frozen by | Notes |
|---|---|---|
| `shared/schema/*.json` | T1.1 | Canonical contracts. Changing one stops the phase. |
| `backend/contracts/` | T1.1 | Python types, hash chain, seam Protocols. Import, never edit. |
| `frontend/src/contracts/` | T1.1 | Generated TS types + discriminated payload union. |
| `frontend/src/tokens.ts`, `frontend/src/index.css` | T1.2 | Design tokens. No task hardcodes a color. |
| `frontend/src/components/core/` | T1.2 | The five core components. Props are a frozen contract. |
| `fixtures/mock/*.jsonl` | T1.1 | Mock runs every UI lane builds against. |
| `config/thresholds.yaml` | T1.1 authors; Phase 4 phase-open calibrates then freezes | The single tuning surface. Tasks tune fixtures, never thresholds. |
| `pyproject.toml`, `.gitignore`, `.env` | lead | Ask; do not edit. |

## Phase 2

| Task | Builds | Owns |
|---|---|---|
| T2.1 | Harness core, run controller, stub adapter | `backend/harness/` |
| T2.2 | Checkpointer | `backend/checkpoint/` |
| T2.3 | Verifier | `backend/verifier/` |
| T2.4 | Corruption injector | `backend/inject/`, `fixtures/scenarios/` |
| T2.5 | Demo task pack | `backend/tasks/`, `fixtures/task_repo/`, `fixtures/task_repo_solution/` |
| T2.6 | UI: live run view | `frontend/src/views/live/` |
| T2.7 | UI: provenance graph | `frontend/src/views/graph/` |
| T2.8 | UI: twin view | `frontend/src/views/twin/` |
| T2.9 | UI: replay | `frontend/src/views/replay/` |
| T2.10 | UI: injection panel | `frontend/src/views/inject/` |
| T2.11 | Knowledge ledger | `backend/ledger/` |
| T2.12 | Swarm projection (Tier B) | `scripts/mock_swarm.py`, `frontend/src/views/swarm/` |

## Phase 3

| Task | Builds | Owns |
|---|---|---|
| T3.1 | Rollback controller (+ ledger audit, confirmed-checkpoint rule) | `backend/rollback/` |
| T3.2 | Twin orchestrator | `backend/orchestrator/` |
| T3.3 | Live wiring | `backend/providers/`, `frontend/src/data/` |

## The two shared surfaces, and how they are kept unshared

**View registration.** Each UI lane exports a default component at a fixed path —
`frontend/src/views/<lane>/<Name>View.tsx`. No lane edits a shared router. The lead wires
`frontend/src/routes.tsx` once, at the phase gate. This is deliberate: a shared registry file edited
by six concurrent lanes is a guaranteed merge conflict on the critical path.

**REST/WS route registration.** `backend/api/` stays owned by the lead. Phase 2/3 tasks expose
functions; the lead mounts them at the gate. Same reasoning.

## Conventions

- Tests live inside the owning directory (`backend/<module>/tests/`), never in a shared test root.
- Python: `uv run <cmd>` from the repo root. Never edit `pyproject.toml` — report a missing dependency.
- Frontend: do not `npm install`. Everything needed is installed.
- No task runs a git write command. The lead commits at each gate.
