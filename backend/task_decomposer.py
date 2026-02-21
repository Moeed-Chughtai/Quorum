"""
Task decomposition and agent routing engine.

Takes a natural language task, breaks it into subtasks with dependency ordering,
and routes each subtask to the best specialized Ollama model.

Two-phase approach:
  Phase 1 — Decompose: The orchestrator model analyzes the task and produces
            structured subtasks with categories and dependencies.
  Phase 2 — Route:     Each subtask is matched to the best available model
            based on category, description, and model specialization data.
"""

import json
import re
from pathlib import Path

from ollama_client import get_ollama_client

_SPECIALIZATIONS_PATH = Path(__file__).resolve().parent / "model_specialization.json"


def _load_specializations() -> list[dict]:
    with open(_SPECIALIZATIONS_PATH) as f:
        return json.load(f)["models"]


# ---------------------------------------------------------------------------
# Phase 1: Decomposition prompt
# ---------------------------------------------------------------------------

_DECOMPOSE_SYSTEM = """\
You are an expert task decomposition engine. Your job is to break a high-level \
task into concrete, actionable subtasks that can each be handled by a \
specialized AI agent.

Rules:
- Each subtask must be self-contained enough for one agent to execute.
- Identify dependencies between subtasks (which must finish before others start).
- Assign a category to each subtask from this list:
  coding, reasoning, research, writing, vision, math, data, general
- Order subtasks so dependencies come first (topological order).
- Be specific. "Set up database" is better than "backend stuff".
- Aim for 3–8 subtasks. Fewer for simple tasks, more for complex ones.

Respond with ONLY valid JSON matching this schema (no markdown fences, no commentary):
{
  "subtasks": [
    {
      "id": 1,
      "title": "short title",
      "description": "what this subtask involves in 1-2 sentences",
      "category": "coding",
      "depends_on": []
    }
  ]
}"""

_DECOMPOSE_USER = "Decompose this task into subtasks:\n\n{prompt}"


# ---------------------------------------------------------------------------
# Phase 2: Routing prompt
# ---------------------------------------------------------------------------

_ROUTE_SYSTEM = """\
You are a model routing engine. Given a list of subtasks and a catalog of \
available AI models with their specializations, assign the single best model \
to each subtask.

Pick the model whose specialization most closely matches the subtask's \
category and description. Provide a short reason for each assignment.

Respond with ONLY valid JSON (no markdown fences, no commentary):
{{
  "assignments": [
    {{
      "subtask_id": 1,
      "assigned_model": "model-name",
      "routing_reason": "one sentence why this model fits"
    }}
  ]
}}"""

_ROUTE_USER = """Subtasks:
{subtasks_json}

Available models:
{models_json}

Assign the best model to each subtask."""


# ---------------------------------------------------------------------------
# JSON extraction helper
# ---------------------------------------------------------------------------

def _extract_json(text: str) -> dict:
    """Pull the first JSON object out of an LLM response, tolerating markdown fences."""
    text = re.sub(r"^```(?:json)?\s*", "", text.strip())
    text = re.sub(r"\s*```$", "", text.strip())

    start = text.find("{")
    if start == -1:
        raise ValueError("No JSON object found in LLM response")

    depth = 0
    for i in range(start, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                return json.loads(text[start : i + 1])

    raise ValueError("Malformed JSON in LLM response")


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def decompose_and_route(prompt: str, orchestrator_model: str = "gemma3:12b") -> dict:
    """
    Decompose a task and route subtasks to specialized models.

    Returns dict matching the frontend DecomposeResult type:
    {
      original_prompt, orchestrator_model,
      subtasks: [{ id, title, description, category, depends_on, assigned_model, routing_reason }]
    }
    """
    client = get_ollama_client()
    models_catalog = _load_specializations()

    # --- Phase 1: Decompose ---
    decompose_resp = client.chat(
        model=orchestrator_model,
        messages=[
            {"role": "system", "content": _DECOMPOSE_SYSTEM},
            {"role": "user", "content": _DECOMPOSE_USER.format(prompt=prompt)},
        ],
        stream=False,
    )
    decompose_text = decompose_resp.get("message", {}).get("content", "")
    decompose_data = _extract_json(decompose_text)
    subtasks = decompose_data.get("subtasks", [])

    if not subtasks:
        raise ValueError("Orchestrator returned no subtasks")

    # --- Phase 2: Route ---
    route_resp = client.chat(
        model=orchestrator_model,
        messages=[
            {"role": "system", "content": _ROUTE_SYSTEM},
            {
                "role": "user",
                "content": _ROUTE_USER.format(
                    subtasks_json=json.dumps(subtasks, indent=2),
                    models_json=json.dumps(models_catalog, indent=2),
                ),
            },
        ],
        stream=False,
    )
    route_text = route_resp.get("message", {}).get("content", "")
    route_data = _extract_json(route_text)
    assignments = {a["subtask_id"]: a for a in route_data.get("assignments", [])}

    # --- Merge ---
    merged = []
    for st in subtasks:
        assignment = assignments.get(st["id"], {})
        merged.append({
            "id": st["id"],
            "title": st["title"],
            "description": st["description"],
            "category": st.get("category", "general"),
            "depends_on": st.get("depends_on", []),
            "assigned_model": assignment.get("assigned_model", orchestrator_model),
            "routing_reason": assignment.get("routing_reason", "Fallback to orchestrator"),
        })

    return {
        "original_prompt": prompt,
        "orchestrator_model": orchestrator_model,
        "subtasks": merged,
    }
