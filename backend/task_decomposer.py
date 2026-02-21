"""
Task decomposition and agent routing engine.

1. Decomposition: Single LLM call with Ollama structured output (grammar-constrained).
2. Routing: Keyword-scored category matching — no external model, sub-millisecond.
"""

import json
import re
from enum import Enum
from pathlib import Path

from pydantic import BaseModel

from ollama_client import get_ollama_client

_SPECIALIZATIONS_PATH = Path(__file__).resolve().parent / "model_specialization.json"


def _load_specializations() -> list[dict]:
    with open(_SPECIALIZATIONS_PATH) as f:
        return json.load(f)["models"]


# ---------------------------------------------------------------------------
# Pydantic schemas for structured output
# ---------------------------------------------------------------------------

class Category(str, Enum):
    coding = "coding"
    reasoning = "reasoning"
    research = "research"
    writing = "writing"
    vision = "vision"
    math = "math"
    data = "data"
    general = "general"


class DecomposedSubtask(BaseModel):
    id: int
    title: str
    description: str
    category: Category
    depends_on: list[int]


class DecompositionOutput(BaseModel):
    subtasks: list[DecomposedSubtask]


# ---------------------------------------------------------------------------
# Keyword router — maps categories to signal words, scores models
# ---------------------------------------------------------------------------

# Words that signal a category. Matched against model specialization strings.
_CATEGORY_SIGNALS: dict[str, list[str]] = {
    "coding":    ["code", "coding", "coder", "dev", "programming", "agentic", "multi-file", "edits", "tool", "tools", "local dev", "languages"],
    "reasoning": ["reasoning", "thinking", "chain-of-thought", "complex", "long-horizon", "systems"],
    "research":  ["research", "long-context", "docs", "technical", "exploration", "codebase"],
    "writing":   ["multilingual", "general", "productivity", "instruction", "chat"],
    "vision":    ["vision", "visual", "image", "images", "diagram", "diagrams", "multimodal", "multi-image", "q&a"],
    "math":      ["math", "stem", "reasoning", "efficient"],
    "data":      ["data", "analysis", "engineering", "efficient", "large context"],
    "general":   ["general", "purpose", "all-rounder", "chat", "balanced"],
}


class KeywordRouter:
    """Routes subtasks to the best model by scoring specialization strings against category keywords."""

    def __init__(self):
        self._models: list[dict] = []
        self._scores: dict[str, dict[str, float]] = {}  # category -> {model: score}

    def warmup(self, models_catalog: list[dict]):
        if self._scores:
            return

        self._models = models_catalog

        # Pre-score every model for every category
        for cat, signals in _CATEGORY_SIGNALS.items():
            self._scores[cat] = {}
            for m in models_catalog:
                spec_lower = m["specialization"].lower()
                score = sum(1 for s in signals if s in spec_lower)
                self._scores[cat][m["model"]] = score

    def route(self, category: str, description: str) -> tuple[str, str, float]:
        cat_scores = self._scores.get(category, self._scores["general"])

        # Boost: check if any words from the description appear in specialization
        desc_words = set(re.findall(r"[a-z]{3,}", description.lower()))
        boosted: dict[str, float] = {}
        for m in self._models:
            spec_lower = m["specialization"].lower()
            base = cat_scores.get(m["model"], 0)
            bonus = sum(0.3 for w in desc_words if w in spec_lower)
            boosted[m["model"]] = base + bonus

        best_model = max(boosted, key=boosted.get)
        best_spec = next(m["specialization"] for m in self._models if m["model"] == best_model)
        return best_model, best_spec, boosted[best_model]


_router = KeywordRouter()


# ---------------------------------------------------------------------------
# Decomposition prompt
# ---------------------------------------------------------------------------

_SYSTEM = """\
You are a task decomposition engine. Break the user's task into 3–8 concrete, \
actionable subtasks that can each be handled by a specialized AI agent.

Rules:
- Each subtask must be self-contained enough for one agent to execute.
- Identify dependencies between subtasks (which must finish before others start).
- Category must be one of: coding, reasoning, research, writing, vision, math, data, general
- Order subtasks so dependencies come first (topological order).
- Be specific. "Set up database" is better than "backend stuff".

You MUST respond with ONLY valid JSON matching this exact schema, no other text:
{"subtasks": [{"id": 1, "title": "...", "description": "...", "category": "coding", "depends_on": []}]}"""


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def decompose_and_route(prompt: str, orchestrator_model: str = "gemma3:12b") -> dict:
    client = get_ollama_client()
    models_catalog = _load_specializations()
    _router.warmup(models_catalog)

    # Phase 1: Decompose with structured output (grammar-constrained)
    resp = client.chat(
        model=orchestrator_model,
        messages=[
            {"role": "system", "content": _SYSTEM},
            {"role": "user", "content": prompt},
        ],
        format=DecompositionOutput.model_json_schema(),
        options={"temperature": 0},
        stream=False,
    )

    raw = resp["message"]["content"]

    # Try direct parse first; if model wrapped JSON in prose, extract it
    try:
        decomposition = DecompositionOutput.model_validate_json(raw)
    except Exception:
        # Extract JSON object from mixed text (e.g., "Here's the breakdown: {...}")
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        if not match:
            raise ValueError(f"Model returned no JSON. Raw response: {raw[:500]}")
        decomposition = DecompositionOutput.model_validate_json(match.group())

    # Phase 2: Route via keyword scoring (sub-millisecond, no network)
    subtasks = []
    for st in decomposition.subtasks:
        model_name, specialization, score = _router.route(st.category.value, st.description)
        subtasks.append({
            "id": st.id,
            "title": st.title,
            "description": st.description,
            "category": st.category.value,
            "depends_on": st.depends_on,
            "assigned_model": model_name,
            "routing_reason": f"Best match ({score:.1f}): {specialization}",
        })

    return {
        "original_prompt": prompt,
        "orchestrator_model": orchestrator_model,
        "subtasks": subtasks,
    }
