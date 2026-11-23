"""dbt Agent: explains models from a dbt manifest.json (no project changes)."""
import json
import re
from pathlib import Path

SAMPLE_MANIFEST = Path(__file__).resolve().parents[3] / "sample_data" / "dbt_manifest.json"


def load_manifest(path: Path = SAMPLE_MANIFEST) -> dict:
    return json.loads(path.read_text())


def explain_model(name: str, manifest: dict) -> dict | None:
    node = next((n for n in manifest["nodes"].values() if n["name"] == name), None)
    if not node:
        return None
    parents = [manifest["nodes"].get(p, manifest.get("sources", {}).get(p, {})).get("name", p)
               for p in node["depends_on"]["nodes"]]
    children = [n["name"] for n in manifest["nodes"].values() if node["unique_id"] in n["depends_on"]["nodes"]]
    return {
        "model": name,
        "description": node.get("description", ""),
        "materialized": node["config"].get("materialized"),
        "upstream": parents,
        "downstream": children,
        "tests": [t["name"] for t in manifest["nodes"].values()
                  if t["resource_type"] == "test" and node["unique_id"] in t["depends_on"]["nodes"]],
    }


def run(message: str) -> dict:
    manifest = load_manifest()
    models = [n["name"] for n in manifest["nodes"].values() if n["resource_type"] == "model"]
    words = set(re.findall(r"[a-z0-9_]+", message.lower()))
    name = next((m for m in models if m in words), None)
    if not name:
        return {"agent": "dbt", "status": "failed",
                "answer": f"Which model? Available in the manifest: {', '.join(models)}"}
    info = explain_model(name, manifest)
    answer = (
        f"**{name}** ({info['materialized']}): {info['description']}\n"
        f"Upstream: {', '.join(info['upstream']) or '—'} · Downstream: {', '.join(info['downstream']) or '—'}\n"
        f"Tests: {', '.join(info['tests']) or 'none'}"
    )
    return {"agent": "dbt", "status": "succeeded", "answer": answer, "model": info,
            "sources": [{"source": "manifest.json", "section": name}]}
