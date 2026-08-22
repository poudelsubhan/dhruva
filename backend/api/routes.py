"""REST surface."""

from __future__ import annotations

import asyncio
import json
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field

from backend import __version__
from backend.api.runs import REGISTRY

router = APIRouter(prefix="/api", tags=["dhruva"])


class HealthResponse(BaseModel):
    status: str
    service: str
    version: str


class CreateRunRequest(BaseModel):
    mode: Literal["supervised", "unsupervised", "twin"]
    task: str = "loglens"
    scenario: Literal["s1", "s2", "s3"] | None = None
    at_step: int | None = Field(default=None, ge=0)


class InjectRequest(BaseModel):
    scenario: Literal["s1", "s2", "s3"]
    at_step: int | None = Field(default=None, ge=0)
    now: bool = False


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(status="ok", service="dhruva", version=__version__)


@router.get("/runs")
async def list_runs() -> list[dict[str, Any]]:
    return REGISTRY.list()


@router.post("/runs", status_code=status.HTTP_201_CREATED)
async def create_run(request: CreateRunRequest, http: Request) -> dict[str, Any]:
    """Start a run. ``twin`` starts a supervised/unsupervised pair on an identical schedule."""
    loop = asyncio.get_running_loop()

    if request.mode == "twin":
        import uuid

        twin_id = f"twin-{uuid.uuid4().hex[:8]}"
        supervised = REGISTRY.create(
            "supervised", request.task, request.scenario, request.at_step, twin_id=twin_id
        )
        unsupervised = REGISTRY.create(
            "unsupervised", request.task, request.scenario, request.at_step, twin_id=twin_id
        )
        REGISTRY.start(supervised, loop)
        REGISTRY.start(unsupervised, loop)
        return {
            "twin_id": twin_id,
            "supervised": supervised.run_id,
            "unsupervised": unsupervised.run_id,
            "runs": [supervised.summary(), unsupervised.summary()],
        }

    record = REGISTRY.create(request.mode, request.task, request.scenario, request.at_step)
    REGISTRY.start(record, loop)
    return record.summary()


@router.get("/runs/{run_id}")
async def get_run(run_id: str) -> dict[str, Any]:
    record = REGISTRY.get(run_id)
    if record is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"unknown run: {run_id}")
    return record.summary()


@router.get("/runs/{run_id}/events", response_class=PlainTextResponse)
async def get_events(run_id: str) -> str:
    """JSONL — the replay source, byte-identical to what the WebSocket streamed.

    Falls back to the on-disk log for runs the registry no longer holds, so a finished run stays
    replayable across a backend restart.
    """
    from backend.contracts import canonical_json

    record = REGISTRY.get(run_id)
    if record is not None:
        return "".join(
            canonical_json(e.model_dump(mode="json")) + "\n" for e in record.controller.store.events
        )

    events = REGISTRY.events_on_disk(run_id)
    if events is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"unknown run: {run_id}")
    return "".join(canonical_json(e) + "\n" for e in events)


@router.get("/runs/{run_id}/ledger")
async def get_ledger(run_id: str) -> list[dict[str, Any]]:
    record = REGISTRY.get(run_id)
    if record is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"unknown run: {run_id}")
    ledger = record.controller.ledger
    return [ledger.entries[e].model_dump(mode="json") for e in ledger._order]


@router.post("/runs/{run_id}/inject")
async def inject(run_id: str, request: InjectRequest) -> dict[str, Any]:
    if not REGISTRY.inject(run_id, request.scenario, request.at_step, request.now):
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"unknown run: {run_id}")
    return {"armed": request.scenario, "run_id": run_id, "now": request.now}


@router.get("/canned")
async def list_canned() -> list[dict[str, Any]]:
    """Canned runs — the on-stage fallback and the demo's replay source.

    These are real logs from real runs, not synthetic. Replaying one renders through exactly the
    same path as live, because the log is the same object the WebSocket carried.
    """
    from backend.config import get_settings

    out: list[dict[str, Any]] = []
    for path in sorted((get_settings().fixtures_dir / "canned").glob("*.jsonl")):
        events = [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
        completes = [e for e in events if e["type"] == "task_complete"]
        out.append(
            {
                "name": path.stem,
                "events": len(events),
                "rollbacks": len([e for e in events if e["type"] == "rollback"]),
                "breaches": len([e for e in events if e["type"] == "breach"]),
                "score": completes[-1]["payload"]["progress"]["score"] if completes else None,
            }
        )
    return out


@router.get("/canned/{name}", response_class=PlainTextResponse)
async def get_canned(name: str) -> str:
    from backend.config import get_settings

    if "/" in name or ".." in name:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="bad name")
    path = get_settings().fixtures_dir / "canned" / f"{name}.jsonl"
    if not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"no canned run: {name}")
    return path.read_text()


@router.get("/mock/{name}", response_class=PlainTextResponse)
async def mock_run(name: Literal["happy", "breach"]) -> str:
    """The Phase 1 mock logs — the UI's offline fixture and the on-stage fallback."""
    from backend.config import get_settings

    path = get_settings().fixtures_dir / "mock" / f"{name}.jsonl"
    if not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"no mock: {name}")
    return path.read_text()


@router.get("/scenarios")
async def scenarios() -> list[dict[str, str]]:
    from backend.inject import load_scenarios

    return [{"key": s.key, "name": s.name, "mode": s.mode} for s in load_scenarios().values()]


@router.get("/config")
async def config() -> dict[str, Any]:
    """What the UI needs to render thresholds and label the provider."""
    from backend.config import get_settings
    from backend.verifier import load_thresholds

    settings = get_settings()
    thresholds = load_thresholds()
    return {
        "thresholds": {"breach": thresholds.breach, "warn": thresholds.warn},
        "weights": thresholds.weights,
        "models": {
            "agent": settings.agent_model,
            "judge": settings.judge_model,
            "compressor": settings.compressor_model,
        },
        "live_provider": bool(settings.openai_api_key.get_secret_value()),
    }
