"""API surface: health, run lifecycle, transport.

Phase 0 asserted these endpoints were honest 501 stubs. They are implemented now, so these assert
the real contract instead.
"""

from __future__ import annotations

import json

from fastapi.testclient import TestClient

from backend.main import create_app

client = TestClient(create_app())


def test_health_reports_the_service_and_version() -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["service"] == "dhruva"
    assert body["version"]


def test_listing_runs_returns_a_list() -> None:
    response = client.get("/api/runs")
    assert response.status_code == 200
    assert isinstance(response.json(), list)


def test_unknown_run_is_a_404_not_a_500() -> None:
    assert client.get("/api/runs/nope").status_code == 404
    assert client.get("/api/runs/nope/events").status_code == 404
    assert client.post("/api/runs/nope/inject", json={"scenario": "s1"}).status_code == 404


def test_create_run_rejects_an_unknown_mode() -> None:
    assert client.post("/api/runs", json={"mode": "sideways", "task": "loglens"}).status_code == 422


def test_config_exposes_thresholds_and_models() -> None:
    """The UI renders the dial's threshold marks from this, so it must not drift from the yaml."""
    from backend.verifier import load_thresholds

    body = client.get("/api/config").json()
    thresholds = load_thresholds()
    assert body["thresholds"]["breach"] == thresholds.breach
    assert body["thresholds"]["warn"] == thresholds.warn
    assert set(body["weights"]) == {"alignment", "repetition", "progress"}
    assert body["models"]["agent"] and body["models"]["judge"]
    assert body["models"]["agent"] != body["models"]["judge"], "mixed-provider by design"


def test_scenarios_lists_all_three() -> None:
    body = client.get("/api/scenarios").json()
    assert {s["key"] for s in body} == {"s1", "s2", "s3"}


def test_mock_runs_are_served_as_jsonl() -> None:
    """The UI's offline fixture and the on-stage fallback."""
    for name in ("happy", "breach"):
        text = client.get(f"/api/mock/{name}").text
        events = [json.loads(line) for line in text.splitlines() if line.strip()]
        assert len(events) > 20
        assert [e["seq"] for e in events] == list(range(len(events)))


def test_unknown_mock_is_a_422() -> None:
    assert client.get("/api/mock/nonsense").status_code == 422


def test_websocket_attaches_and_reports_an_unknown_run() -> None:
    with client.websocket_connect("/ws/runs/does-not-exist") as socket:
        hello = socket.receive_json()
        assert hello["type"] == "hello"
        assert hello["run_id"] == "does-not-exist"
        assert hello["note"] == "unknown run"


def test_a_finished_run_stays_replayable_after_a_restart(tmp_path) -> None:
    """The registry is in-memory; the event log is not.

    Observed live: after restarting the backend, every run id still held by an open UI returned 404
    forever, even though its log was sitting in runs/{id}/events.jsonl. Losing a finished run to a
    process restart is the wrong failure to have on a demo machine.
    """
    from backend.api.runs import REGISTRY
    from backend.config import get_settings

    run_id = "sup-restart-test"
    log = get_settings().runs_dir / run_id / "events.jsonl"
    log.parent.mkdir(parents=True, exist_ok=True)
    log.write_text(
        '{"run_id":"sup-restart-test","seq":0,"ts":"t","type":"task_start",'
        '"payload":{"task":"loglens","mode":"supervised","spec_hash":"a"}}\n'
    )
    try:
        assert REGISTRY.get(run_id) is None, "not in memory, exactly as after a restart"
        response = client.get(f"/api/runs/{run_id}/events")
        assert response.status_code == 200
        assert len([x for x in response.text.splitlines() if x.strip()]) == 1
    finally:
        log.unlink()
        log.parent.rmdir()


def test_path_traversal_on_the_disk_fallback_is_refused() -> None:
    assert client.get("/api/runs/..%2F..%2Fetc/events").status_code == 404
    assert client.get("/api/runs/nope/events").status_code == 404
