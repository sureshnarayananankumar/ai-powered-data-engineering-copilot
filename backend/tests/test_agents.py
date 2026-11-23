from pathlib import Path

import pytest

from app.agents import data_quality_agent, dbt_agent, pipeline_agent, rag_agent, sql_agent
from app.agents.router import classify
from app.config.settings import get_settings

LOG = (Path(__file__).resolve().parents[2] / "sample_data" / "airflow_logs" / "orders_daily_failed.log").read_text()


@pytest.fixture(autouse=True)
def no_llm(monkeypatch):
    """Tests run offline: no API key, no Snowflake."""
    for var in ("OPENAI_API_KEY", "SNOWFLAKE_ACCOUNT", "SNOWFLAKE_USER", "SNOWFLAKE_PASSWORD"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.chdir(Path(__file__).resolve().parents[2] / "sample_data")  # avoid picking up a local .env
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.mark.parametrize("msg,intent", [
    ("Why did the orders_daily DAG fail?", "pipeline"),
    ("Check duplicates in fct_orders", "data_quality"),
    ("Explain the dbt model fct_orders", "dbt"),
    ("How many orders were placed last month?", "sql"),
    ("What is the freshness expectation?", "data_quality"),
    ("hello", "general"),
])
def test_router(msg, intent):
    assert classify(msg) == intent


def test_pipeline_agent_finds_cause_and_evidence():
    out = pipeline_agent.run("why did it fail", LOG)
    assert out["incident"]["dag_id"] == "orders_daily"
    assert out["incident"]["task_id"] == "load_fct_orders"
    assert out["incident"]["likely_cause"].startswith("Missing object")
    assert any("PAYMENTS_V2" in e for e in out["incident"]["evidence"])
    assert "retry task" in out["requires_approval"]


def test_pipeline_agent_requires_log():
    assert pipeline_agent.run("why", None)["status"] == "failed"


def test_dbt_agent_lineage():
    info = dbt_agent.explain_model("fct_orders", dbt_agent.load_manifest())
    assert info["materialized"] == "incremental"
    assert "stg_payments" in info["upstream"]
    assert "dim_customers" in info["downstream"]
    assert "unique_fct_orders_order_id" in info["tests"]


def test_dq_agent_generates_valid_readonly_checks():
    out = data_quality_agent.run("check nulls and duplicates in fct_orders")
    assert out["status"] == "proposed"
    assert all(c["valid"] for c in out["checks"]), out["checks"]
    assert any("HAVING" in c["sql"].upper() for c in out["checks"])


def test_rag_agent_cites_source():
    out = rag_agent.run("missing object errors in the orders pipeline")
    assert out["sources"]
    assert out["sources"][0]["source"] == "orders_pipeline_runbook.md"


def test_rag_agent_refuses_when_no_context():
    out = rag_agent.run("quantum kubernetes blockchain zebra")
    assert out["sources"] == []
    assert "won't guess" in out["answer"]


def test_sql_agent_without_llm_fails_clearly():
    out = sql_agent.run("how many orders")
    assert out["status"] == "failed"
    assert "OPENAI_API_KEY" in out["answer"]
