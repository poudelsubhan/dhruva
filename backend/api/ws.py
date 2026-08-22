"""WebSocket transport.

Pushes RunEvents in seq order. The frames are the same objects appended to the JSONL log, so a
replay of the log renders identically to the live stream — which is what lets the replay view reuse
the live render path rather than reimplementing it.
"""

from __future__ import annotations

import asyncio
import contextlib

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from backend.api.runs import REGISTRY

router = APIRouter()


@router.websocket("/ws/runs/{run_id}")
async def stream_run(websocket: WebSocket, run_id: str) -> None:
    await websocket.accept()
    record = REGISTRY.get(run_id)

    if record is None:
        await websocket.send_json({"type": "hello", "run_id": run_id, "note": "unknown run"})
        with contextlib.suppress(WebSocketDisconnect):
            await websocket.receive_text()
        return

    store = record.controller.store
    queue = store.subscribe()
    try:
        await websocket.send_json({"type": "hello", "run_id": run_id, "note": "attached"})
        # Replay what already happened, then stream. A late subscriber must still see a complete,
        # gapless prefix or the UI's seq-ordering buffer will stall forever.
        seen = 0
        for event in list(store.events):
            await websocket.send_json(event.model_dump(mode="json"))
            seen = event.seq + 1

        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=1.0)
            except TimeoutError:
                if record.thread is not None and not record.thread.is_alive():
                    await websocket.send_json({"type": "bye", "run_id": run_id})
                    return
                continue
            if event.seq < seen:
                continue  # already sent in the backfill
            seen = event.seq + 1
            await websocket.send_json(event.model_dump(mode="json"))
    except WebSocketDisconnect:
        pass
    finally:
        store.unsubscribe(queue)
