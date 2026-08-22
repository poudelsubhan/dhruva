"""WebSocket surface. Phase 0 stub: accept, greet, hold open until the client leaves."""

from __future__ import annotations

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter()


@router.websocket("/ws/runs/{run_id}")
async def run_events_socket(websocket: WebSocket, run_id: str) -> None:
    """Per-run event channel. Streams RunEvents from Phase 2 onward."""
    await websocket.accept()
    await websocket.send_json({"type": "hello", "run_id": run_id, "note": "stub"})
    try:
        while True:
            # Nothing is broadcast yet; drain client frames until it disconnects.
            await websocket.receive_text()
    except WebSocketDisconnect:
        return
