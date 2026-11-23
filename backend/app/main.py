"""FastAPI backend for the AI-Powered Data Engineering Copilot.

Run:  uvicorn app.main:app --reload --port 8000   (from the backend/ folder)
"""
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from app.agents.graph import ask
from app.config.settings import get_settings
from app.integrations.snowflake_client import SnowflakeNotConfigured, get_schema_metadata, run_query
from app.security.sql_guard import validate_sql

settings = get_settings()
app = FastAPI(title="AI-Powered Data Engineering Copilot", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",")],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

SAMPLE_LOGS = Path(__file__).resolve().parents[2] / "sample_data" / "airflow_logs"


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    intent: str | None = None
    log: str | None = Field(default=None, max_length=200_000)


class SqlRequest(BaseModel):
    sql: str = Field(min_length=1, max_length=20_000)


@app.get("/api/health")
def health() -> dict:
    return {
        "status": "ok",
        "llm_configured": settings.llm_configured,
        "snowflake_configured": settings.snowflake_configured,
    }


@app.post("/api/chat")
def chat(req: ChatRequest) -> dict:
    return ask(req.message, log=req.log, intent=req.intent)


@app.get("/api/schema")
def schema() -> dict:
    return get_schema_metadata()


@app.post("/api/sql/validate")
def sql_validate(req: SqlRequest) -> dict:
    v = validate_sql(req.sql, settings.allowed_schemas, set(get_schema_metadata()), settings.sql_max_rows)
    return {"is_valid": v.is_valid, "sql": v.sql, "errors": v.errors, "tables": v.tables}


@app.post("/api/sql/run")
def sql_run(req: SqlRequest) -> dict:
    """Executed only when the user presses Run in the UI."""
    try:
        return {"status": "succeeded", **run_query(req.sql)}
    except SnowflakeNotConfigured as e:
        raise HTTPException(status_code=503, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/samples/logs")
def sample_logs() -> dict:
    return {p.name: p.read_text() for p in sorted(SAMPLE_LOGS.glob("*.log"))}
