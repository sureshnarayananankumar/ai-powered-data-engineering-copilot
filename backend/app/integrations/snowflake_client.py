"""Snowflake access: read-only, least-privilege, validated queries only.

Until Snowflake credentials are configured, `get_schema_metadata` returns the
synthetic sample schema in `sample_data/schema.json` so the app can be developed
and tested offline. `run_query` refuses to run without credentials.
"""
import json
from pathlib import Path

from app.config.settings import get_settings
from app.security.sql_guard import validate_sql

SAMPLE_SCHEMA = Path(__file__).resolve().parents[3] / "sample_data" / "schema.json"


class SnowflakeNotConfigured(RuntimeError):
    pass


def get_schema_metadata() -> dict:
    """Return {"TABLE_FQN": {"description": str, "columns": {name: type}}}."""
    settings = get_settings()
    if not settings.snowflake_configured:
        return json.loads(SAMPLE_SCHEMA.read_text())
    import snowflake.connector  # imported lazily; optional dependency

    with _connect() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT table_schema, table_name, column_name, data_type "
            "FROM information_schema.columns ORDER BY 1, 2, ordinal_position"
        )
        meta: dict = {}
        for schema, table, col, dtype in cur.fetchall():
            if schema.upper() not in settings.allowed_schemas:
                continue
            key = f"{schema}.{table}".upper()
            meta.setdefault(key, {"description": "", "columns": {}})["columns"][col] = dtype
        return meta


def run_query(sql: str) -> dict:
    settings = get_settings()
    if not settings.snowflake_configured:
        raise SnowflakeNotConfigured("Snowflake credentials are not configured; query was not executed.")
    result = validate_sql(sql, settings.allowed_schemas, set(get_schema_metadata()), settings.sql_max_rows)
    if not result.is_valid:
        raise ValueError("; ".join(result.errors))
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(f"ALTER SESSION SET STATEMENT_TIMEOUT_IN_SECONDS = {int(settings.sql_timeout_seconds)}")
        cur.execute(result.sql)
        cols = [c[0] for c in cur.description]
        rows = [dict(zip(cols, r)) for r in cur.fetchmany(settings.sql_max_rows)]
    return {"columns": cols, "rows": rows, "sql": result.sql}


def _connect():
    import snowflake.connector

    s = get_settings()
    return snowflake.connector.connect(
        account=s.snowflake_account,
        user=s.snowflake_user,
        password=s.snowflake_password,
        role=s.snowflake_role,
        warehouse=s.snowflake_warehouse,
        database=s.snowflake_database,
        schema=s.snowflake_schema,
    )
