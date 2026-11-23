"""SQL Agent: natural language -> validated, read-only Snowflake SQL.

The agent only PROPOSES SQL. Execution happens via the explicit /api/sql/run
endpoint triggered by the user's Run button.
"""
import json
import re

from app.config.settings import get_settings
from app.integrations.snowflake_client import get_schema_metadata
from app.llm.client import LLMNotConfigured, complete
from app.security.sql_guard import validate_sql

SYSTEM = """You are a Snowflake SQL assistant for data engineers.
Rules:
- Use ONLY the tables and columns in the provided schema. Never invent objects.
- Produce exactly one read-only SELECT statement with fully qualified names.
- If the schema cannot answer the question, reply with SQL: NONE and explain why.
Respond in this format:
ASSUMPTIONS: <bullets>
SQL:
```sql
<query>
```
EXPLANATION: <plain language>"""

SQL_BLOCK = re.compile(r"```sql\s*(.*?)```", re.S | re.I)


def _section(text: str, name: str) -> str:
    m = re.search(rf"{name}:\s*(.*?)(?:\n[A-Z]+:|\Z)", text, re.S)
    return m.group(1).strip() if m else ""


def run(message: str) -> dict:
    settings = get_settings()
    schema = get_schema_metadata()
    try:
        raw = complete(SYSTEM, f"Schema:\n{json.dumps(schema, indent=2)}\n\nQuestion: {message}")
    except LLMNotConfigured as e:
        return {"agent": "sql", "answer": str(e), "sql": None, "status": "failed", "evidence": []}

    m = SQL_BLOCK.search(raw)
    if not m:
        return {"agent": "sql", "answer": raw, "sql": None, "status": "failed", "evidence": []}

    v = validate_sql(m.group(1), settings.allowed_schemas, set(schema), settings.sql_max_rows)
    return {
        "agent": "sql",
        "answer": _section(raw, "EXPLANATION") or raw,
        "assumptions": _section(raw, "ASSUMPTIONS"),
        "sql": v.sql,
        "validation": {"is_valid": v.is_valid, "errors": v.errors, "tables": v.tables},
        "status": "proposed" if v.is_valid else "failed",
        "evidence": [f"schema:{t}" for t in v.tables],
    }
