"""FastAPI application factory. Run with ``uvicorn backend.main:app``."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend import __version__
from backend.api.routes import router as api_router
from backend.api.ws import router as ws_router

FRONTEND_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]


def create_app() -> FastAPI:
    """Build the Dhruva app: CORS for the Vite dev server, REST under /api, WS at /ws."""
    app = FastAPI(
        title="Dhruva",
        version=__version__,
        description="Agent supervisor: goal-state checkpointing, drift detection, rollback.",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=FRONTEND_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(api_router)
    app.include_router(ws_router)
    return app


app = create_app()
