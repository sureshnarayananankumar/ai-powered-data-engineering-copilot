"""LangGraph workflow: classify intent -> route to one specialist agent."""
from typing import Any, TypedDict

from langgraph.graph import END, StateGraph

from app.agents import data_quality_agent, dbt_agent, pipeline_agent, rag_agent, sql_agent
from app.agents.router import classify


class CopilotState(TypedDict, total=False):
    message: str
    log: str | None
    intent: str
    result: dict[str, Any]


def _route(state: CopilotState) -> CopilotState:
    return {"intent": classify(state["message"])}


def _general(state: CopilotState) -> CopilotState:
    return {"result": {"agent": "general", "status": "succeeded", "answer":
            "I can help with: SQL generation, documentation questions, dbt models, data quality checks, "
            "and Airflow incident diagnosis. Try: 'Explain the fct_orders model'."}}


NODES = {
    "sql": lambda s: {"result": sql_agent.run(s["message"])},
    "rag": lambda s: {"result": rag_agent.run(s["message"])},
    "dbt": lambda s: {"result": dbt_agent.run(s["message"])},
    "data_quality": lambda s: {"result": data_quality_agent.run(s["message"])},
    "pipeline": lambda s: {"result": pipeline_agent.run(s["message"], s.get("log"))},
    "general": _general,
}


def build_graph():
    g = StateGraph(CopilotState)
    g.add_node("router", _route)
    for name, fn in NODES.items():
        g.add_node(name, fn)
        g.add_edge(name, END)
    g.set_entry_point("router")
    g.add_conditional_edges("router", lambda s: s["intent"], {n: n for n in NODES})
    return g.compile()


copilot_graph = build_graph()


def ask(message: str, log: str | None = None, intent: str | None = None) -> dict:
    if intent and intent in NODES:  # user explicitly picked a mode in the UI
        state = NODES[intent]({"message": message, "log": log})
        return {"intent": intent, **state["result"]}
    out = copilot_graph.invoke({"message": message, "log": log})
    return {"intent": out["intent"], **out["result"]}
