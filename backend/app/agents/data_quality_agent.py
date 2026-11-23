"""Data Quality Agent: generates read-only diagnostic SQL for a known table."""
import re

from app.config.settings import get_settings
from app.integrations.snowflake_client import get_schema_metadata
from app.security.sql_guard import validate_sql


def build_checks(table: str, columns: list[str], key: str | None) -> list[dict]:
    checks = []
    null_exprs = ",\n  ".join(f"COUNT_IF({c} IS NULL) AS {c}_nulls" for c in columns)
    checks.append({"check": "null counts", "sql": f"SELECT COUNT(*) AS total_rows,\n  {null_exprs}\nFROM {table}"})
    if key:
        checks.append({
            "check": f"duplicate {key}",
            "sql": f"SELECT {key}, COUNT(*) AS n FROM {table} GROUP BY {key} HAVING COUNT(*) > 1 ORDER BY n DESC",
        })
    return checks


def run(message: str) -> dict:
    settings = get_settings()
    schema = get_schema_metadata()
    text = message.upper()
    table = next((t for t in schema if t in text or t.split(".")[-1] in re.findall(r"[A-Z_]+", text)), None)
    if not table:
        return {"agent": "data_quality", "status": "failed",
                "answer": f"Which table should I check? Known tables: {', '.join(sorted(schema))}"}
    cols = list(schema[table]["columns"])
    key = next((c for c in cols if c.upper().endswith("_ID")), None)
    checks = []
    for chk in build_checks(table, cols, key):
        v = validate_sql(chk["sql"], settings.allowed_schemas, set(schema), settings.sql_max_rows)
        checks.append({**chk, "sql": v.sql, "valid": v.is_valid, "errors": v.errors})
    return {
        "agent": "data_quality",
        "status": "proposed",
        "answer": f"Proposed {len(checks)} read-only checks for {table}. Findings are hypotheses until you run them.",
        "checks": checks,
        "sql": checks[0]["sql"],
    }
