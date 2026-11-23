"""Intent router. Deterministic keyword rules first (cheap, testable);
an LLM classifier can be layered on later for ambiguous requests."""
from typing import Literal

Intent = Literal["sql", "rag", "dbt", "data_quality", "pipeline", "general"]

RULES: list[tuple[Intent, tuple[str, ...]]] = [
    ("pipeline", ("airflow", "dag", "task failed", "pipeline", "retry", "log")),
    ("data_quality", ("null", "duplicate", "freshness", "row count", "data quality", "dq ", "referential")),
    ("dbt", ("dbt", "model", "materialization", "ref(", "source(", "manifest")),
    ("sql", ("sql", "query", "how many", "top ", "total", "revenue", "count", "average", "sum of", "list ")),
    ("rag", ("what is", "explain", "document", "runbook", "how does", "why")),
]


def classify(message: str) -> Intent:
    text = f" {message.lower()} "
    for intent, keywords in RULES:
        if any(k in text for k in keywords):
            return intent
    return "general"
