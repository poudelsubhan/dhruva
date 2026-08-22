# Dhruva

**Dhruva** is a framework-agnostic supervisor for long-horizon agents. It wraps an agent loop,
checkpoints goal-state, watches for semantic drift, and — when the agent's behaviour stops matching
its own objective — rolls it back to the last verified checkpoint, re-injects the intent, forces a
pre-flight re-verification, and resumes. Every action, observation, memory op, verification,
checkpoint, breach, rollback, resume, and injection is emitted as a schema-valid event, and the whole
run is rendered in a web-based flight recorder: a live timeline with a streaming coherence score, a
temporal provenance graph, side-by-side supervised/unsupervised twins with a decay curve and computed
coherence half-life, and scrubbable replay. Three adapter seams — the wrapped agent, the model
provider, and the demo task — keep it bindable to whatever the day demands.

## Quickstart

```bash
make install     # uv sync --all-groups + npm ci in frontend/
cp .env.example .env   # then fill in your key (see Configuration)
make dev         # boots both servers; Ctrl-C stops both
```

- Frontend: <http://localhost:5173>
- Backend: <http://localhost:8000> (health: `/api/health`)

The Vite dev server proxies `/api` and `/ws` to the backend on port 8000, so the frontend talks to
one origin.

Other entrypoints: `make dev-backend`, `make dev-frontend`, `make test`, `make lint`,
`make typecheck`, `make check`, `make build`, `make clean`, `make demo-mock`. `make help` lists them.

## Layout

```
dhruva/
├── backend/          FastAPI app — harness, checkpointer, verifier, injector, providers, transport
├── frontend/         Vite + React + TypeScript + Tailwind — the flight recorder UI
├── shared/schema/    JSON Schemas for the event/checkpoint contracts (source of the generated types)
├── fixtures/         Demo task repo, corruption scenario fixtures, canned run logs
├── config/           Tunable surfaces — thresholds and run configuration
├── scripts/          Developer tooling — mock run generator, WS replayer, codegen
├── docs/             Submission draft, ownership map, traceability, acceptance checklist
├── runs/             Per-run event logs (JSONL) and snapshots — gitignored
└── Makefile          Every developer entrypoint
```

## Configuration

Copy `.env.example` to `.env` and fill it in. `.env` is gitignored and must never be committed.

| Key | Purpose |
| --- | --- |
| `DHRUVA_PROVIDER` | Selects the model-provider implementation. `openai_compat` uses the OpenAI-compatible client below. |
| `OPENAI_BASE_URL` | Base URL of the OpenAI-compatible endpoint. Defaults to OpenRouter; point it anywhere that speaks the same API. |
| `OPENAI_API_KEY` | Credential for `OPENAI_BASE_URL`. |
| `OPENROUTER_API_KEY` | OpenRouter credential, when the endpoint is OpenRouter specifically. |

Models are pinned in code, not in env: agent `anthropic/claude-sonnet-5`, judge `openai/gpt-5-mini`,
compressor `openai/gpt-5-mini`. Running the judge on a different provider than the wrapped agent is
by design.

No secret is required to run the test suite or CI — everything exercised there is mocked or stubbed.

## Architecture

A run controller drives the wrapped agent through three seams: `AgentAdapter` (step, inject
messages, get/set context), `ModelProvider` (one OpenAI-compatible `complete` call), and `TaskPack`
(spec, tools, snapshot/restore, progress). Every N steps the verifier scores the action window
against the checkpointed intent digest; a passing score mints a hash-chained checkpoint, a breaching
one triggers rollback. Events are append-only JSONL on disk and are broadcast over
`/ws/runs/{id}` — the disk log and the socket carry identical objects, so live view and replay share
one render path. Phase 7 expands this section.

## Status

**Phase 0 — scaffold.** Repo, CI, and dev stack only; the mechanisms above land in Phases 1–4.
