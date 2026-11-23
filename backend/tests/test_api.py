from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config.settings import get_settings


@pytest.fixture
def client(monkeypatch):
    for var in ("OPENAI_API_KEY", "SNOWFLAKE_ACCOUNT", "SNOWFLAKE_USER", "SNOWFLAKE_PASSWORD"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.chdir(Path(__file__).resolve().parents[2] / "sample_data")
    get_settings.cache_clear()
    from app.main import app
    return TestClient(app)


def test_health(client):
    body = client.get("/api/health").json()
    assert body["status"] == "ok"
    assert body["snowflake_configured"] is False


def test_chat_routes_to_dbt(client):
    body = client.post("/api/chat", json={"message": "explain the fct_orders model"}).json()
    assert body["intent"] == "dbt"
    assert "incremental" in body["answer"]


def test_validate_blocks_drop(client):
    body = client.post("/api/sql/validate", json={"sql": "drop table analytics.fct_orders"}).json()
    assert body["is_valid"] is False


def test_run_without_snowflake_returns_503(client):
    r = client.post("/api/sql/run", json={"sql": "select * from analytics.fct_orders"})
    assert r.status_code == 503


def test_empty_message_rejected(client):
    assert client.post("/api/chat", json={"message": ""}).status_code == 422


def test_sample_logs(client):
    assert "orders_daily_failed.log" in client.get("/api/samples/logs").json()
