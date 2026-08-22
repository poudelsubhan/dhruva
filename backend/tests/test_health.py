"""Phase 0 gate tests: the skeleton boots and every stub answers as specified."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.main import create_app


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app())


def test_health_ok(client: TestClient) -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "dhruva", "version": "0.1.0"}


def test_list_runs_empty(client: TestClient) -> None:
    response = client.get("/api/runs")
    assert response.status_code == 200
    assert response.json() == []


def test_create_run_not_implemented(client: TestClient) -> None:
    response = client.post("/api/runs", json={"mode": "supervised", "task": "demo"})
    assert response.status_code == 501
    assert "Phase 2/3" in response.json()["detail"]


def test_get_run_events_not_implemented(client: TestClient) -> None:
    response = client.get("/api/runs/abc123/events")
    assert response.status_code == 501
    assert "Phase 2/3" in response.json()["detail"]


def test_inject_not_implemented(client: TestClient) -> None:
    response = client.post("/api/runs/abc123/inject", json={"scenario": "s1", "now": True})
    assert response.status_code == 501
    assert "Phase 2/3" in response.json()["detail"]


def test_websocket_hello_frame(client: TestClient) -> None:
    with client.websocket_connect("/ws/runs/abc123") as websocket:
        assert websocket.receive_json() == {
            "type": "hello",
            "run_id": "abc123",
            "note": "stub",
        }
