"""REST surface. Phase 0 ships health + deliberate stubs; later phases fill them in."""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from backend import __version__

router = APIRouter(prefix="/api", tags=["dhruva"])

_NOT_YET = "Not implemented in Phase 0 (scaffold)."


class HealthResponse(BaseModel):
    """Liveness payload."""

    status: str
    service: str
    version: str


class CreateRunRequest(BaseModel):
    """Shape of ``POST /api/runs``. Documented now, honoured in Phase 2/3."""

    mode: Literal["supervised", "unsupervised", "twin"]
    task: str
    scenario: Literal["s1", "s2", "s3"] | None = None
    at_step: int | None = Field(default=None, ge=0)


class InjectRequest(BaseModel):
    """Shape of ``POST /api/runs/{run_id}/inject``. Honoured in Phase 2/3."""

    scenario: Literal["s1", "s2", "s3"]
    at_step: int | None = Field(default=None, ge=0)
    now: bool = False


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    """Liveness probe — the Phase 0 gate check."""
    return HealthResponse(status="ok", service="dhruva", version=__version__)


@router.get("/runs")
async def list_runs() -> list[dict[str, Any]]:
    """Known runs. Empty until the run store lands in Phase 2."""
    return []


@router.post("/runs", status_code=status.HTTP_501_NOT_IMPLEMENTED)
async def create_run(request: CreateRunRequest) -> None:
    """Start a run. Stub — the harness and orchestrator land in Phase 2/3."""
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail=f"POST /api/runs: {_NOT_YET} Run creation lands with the harness in Phase 2/3.",
    )


@router.get("/runs/{run_id}/events", status_code=status.HTTP_501_NOT_IMPLEMENTED)
async def get_run_events(run_id: str) -> None:
    """Replay source (JSONL). Stub — the event log lands in Phase 2/3."""
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail=(
            f"GET /api/runs/{run_id}/events: {_NOT_YET} "
            "The JSONL event log lands with the harness in Phase 2/3."
        ),
    )


@router.post("/runs/{run_id}/inject", status_code=status.HTTP_501_NOT_IMPLEMENTED)
async def inject(run_id: str, request: InjectRequest) -> None:
    """Arm a corruption scenario. Stub — the injector lands in Phase 2/3."""
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail=(
            f"POST /api/runs/{run_id}/inject: {_NOT_YET} "
            "The corruption injector lands in Phase 2/3."
        ),
    )
