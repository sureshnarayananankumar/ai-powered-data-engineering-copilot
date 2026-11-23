"""Pipeline Incident Agent: summarises Airflow task logs.

Rule-based signature matching gives a CONFIRMED evidence line; the LLM (if
configured) only adds a narrative. It never retries or clears tasks.
"""
import re

from app.llm.client import LLMNotConfigured, complete

SIGNATURES = [
    (r"(?i)object .* does not exist or not authorized", "Missing object or insufficient privileges in Snowflake"),
    (r"(?i)timeout|timed out", "Task or query timeout"),
    (r"(?i)connection (refused|reset)|could not connect", "Network / connection failure to an upstream system"),
    (r"(?i)compilation error", "dbt / SQL compilation error"),
    (r"(?i)duplicate key|unique constraint", "Uniqueness violation in loaded data"),
    (r"(?i)out of memory|oom|killed", "Worker ran out of memory"),
]

ERROR_LINE = re.compile(r"(?i)\b(error|exception|failed|traceback)\b")


def analyse_log(log: str) -> dict:
    lines = log.splitlines()
    evidence = [ln.strip() for ln in lines if ERROR_LINE.search(ln)][:8]
    causes = [label for pattern, label in SIGNATURES if re.search(pattern, log)]
    dag = re.search(r"dag_id=([\w\-.]+)", log)
    task = re.search(r"task_id=([\w\-.]+)", log)
    return {
        "dag_id": dag.group(1) if dag else None,
        "task_id": task.group(1) if task else None,
        "evidence": evidence,
        "likely_cause": causes[0] if causes else None,
        "cause_status": "confirmed-by-signature" if causes else "unknown",
    }


def run(message: str, log: str | None = None) -> dict:
    if not log:
        return {
            "agent": "pipeline",
            "answer": "Paste the failing task's log (or select a sample) so I can diagnose it from evidence.",
            "status": "failed",
        }
    facts = analyse_log(log)
    summary = (
        f"DAG `{facts['dag_id']}` task `{facts['task_id']}` failed. "
        f"Likely cause: {facts['likely_cause'] or 'not identified from known signatures'} "
        f"({facts['cause_status']})."
    )
    try:
        summary += "\n\n" + complete(
            "You are an on-call data engineer. Using ONLY the facts and log lines given, propose safe, "
            "read-only next checks and recovery steps. Label anything not proven as 'suspected'. "
            "Never instruct to clear/retry tasks without human approval.",
            f"Facts: {facts}\n\nUser question: {message}",
        )
    except LLMNotConfigured:
        summary += "\n\nRecommended checks: confirm upstream object/permissions, re-run the failing query manually " \
                   "with the read-only role, then request approval before retrying the task."
    return {"agent": "pipeline", "answer": summary, "incident": facts, "status": "succeeded",
            "requires_approval": ["retry task", "clear task"]}
