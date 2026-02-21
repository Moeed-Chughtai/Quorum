"""
Parallel agent execution engine.

Builds a dependency graph from decomposed subtasks, runs independent tasks
concurrently via ThreadPoolExecutor, streams SSE events, then synthesises
all agent outputs into one final deliverable.
"""

import time
import threading
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from queue import Queue

import json
from pathlib import Path

from ollama_client import get_ollama_client

# ---------------------------------------------------------------------------
# Category-specific system prompts — gives each agent a sharper role
# ---------------------------------------------------------------------------

_AGENT_PERSONAS: dict[str, str] = {
    "coding": (
        "You are an expert software engineer. Write clean, production-ready code "
        "with clear structure. Include file paths, language tags on code blocks, "
        "and brief inline comments only where logic is non-obvious."
    ),
    "reasoning": (
        "You are a rigorous analytical thinker. Break the problem into logical steps, "
        "evaluate trade-offs explicitly, and state your assumptions. "
        "Use numbered reasoning chains."
    ),
    "research": (
        "You are a thorough technical researcher. Identify key concepts, compare "
        "alternatives with pros/cons, cite concrete details, and surface risks "
        "or unknowns. Be comprehensive but concise."
    ),
    "writing": (
        "You are a clear, professional writer. Produce well-structured prose "
        "with headings, bullet points where helpful, and a consistent tone. "
        "Be concise — every sentence should earn its place."
    ),
    "vision": (
        "You are a visual analysis specialist. Describe visual elements precisely, "
        "reference spatial relationships, and extract actionable information from "
        "images or diagrams."
    ),
    "math": (
        "You are a precise mathematician. Show your work step-by-step, define "
        "variables clearly, verify results, and state the final answer explicitly."
    ),
    "data": (
        "You are a data engineering and analysis expert. Design efficient schemas "
        "and pipelines, explain transformations clearly, and consider edge cases "
        "in data quality."
    ),
    "general": (
        "You are a capable AI assistant. Provide thorough, actionable responses "
        "structured with clear headings and steps."
    ),
}

_DEFAULT_PERSONA = _AGENT_PERSONAS["general"]

_SPECIALIZATIONS_PATH = Path(__file__).resolve().parent / "model_specialization.json"


def _load_pricing() -> dict[str, dict[str, float]]:
    try:
        with open(_SPECIALIZATIONS_PATH) as f:
            models = json.load(f).get("models", [])
        out: dict[str, dict[str, float]] = {}
        for m in models:
            model = m.get("model")
            pricing = m.get("pricing_per_1m_tokens") or {}
            if model:
                out[model] = {
                    "input": float(pricing.get("input") or 0),
                    "output": float(pricing.get("output") or 0),
                }
        return out
    except Exception:
        return {}


_PRICING_PER_1M = _load_pricing()


class ExecutionEngine:
    def __init__(
        self,
        original_prompt: str,
        subtasks: list[dict],
        orchestrator_model: str = "gemma3:12b",
        max_workers: int = 8,
    ):
        self.original_prompt = original_prompt
        self.orchestrator_model = orchestrator_model
        self.tasks: dict[int, dict] = {}
        self.dependents: dict[int, list[int]] = defaultdict(list)
        self.events: Queue = Queue()
        self._lock = threading.Lock()
        self._executor = ThreadPoolExecutor(max_workers=max_workers)

        for st in subtasks:
            self.tasks[st["id"]] = {
                **st,
                "status": "pending",
                "output": None,
                "error": None,
                "started_at": None,
                "completed_at": None,
            }
            for dep_id in st.get("depends_on", []):
                self.dependents[dep_id].append(st["id"])

    # ------------------------------------------------------------------
    # Scheduling
    # ------------------------------------------------------------------

    def _ready_ids(self) -> list[int]:
        ready = []
        for tid, t in self.tasks.items():
            if t["status"] != "pending":
                continue
            if all(self.tasks[d]["status"] == "completed" for d in t["depends_on"]):
                ready.append(tid)
        return ready

    def _propagate_failures(self):
        changed = True
        while changed:
            changed = False
            for tid, t in self.tasks.items():
                if t["status"] != "pending":
                    continue
                for dep_id in t["depends_on"]:
                    if self.tasks[dep_id]["status"] == "failed":
                        t["status"] = "failed"
                        t["error"] = f"Skipped: upstream task #{dep_id} failed"
                        changed = True
                        self.events.put({
                            "event": "agent_failed",
                            "data": {"id": tid, "title": t["title"], "error": t["error"]},
                        })
                        break

    def _launch_ready(self):
        with self._lock:
            self._propagate_failures()
            ready = self._ready_ids()
            for tid in ready:
                self.tasks[tid]["status"] = "running"
                self._executor.submit(self._run_task, tid)

            all_done = all(
                t["status"] in ("completed", "failed") for t in self.tasks.values()
            )

        if all_done:
            self._synthesise()

    # ------------------------------------------------------------------
    # Agent prompt construction
    # ------------------------------------------------------------------

    def _build_messages(self, task: dict) -> list[dict]:
        category = task.get("category", "general")
        persona = _AGENT_PERSONAS.get(category, _DEFAULT_PERSONA)
        system = (
            f"{persona}\n\n"
            "You are working on one subtask of a larger project. "
            "Focus exclusively on your assigned task. Be thorough and actionable.\n\n"
            "Formatting rules (strict):\n"
            "- NEVER use emojis or emoticons of any kind.\n"
            "- NEVER use em dashes or en dashes. Use commas, periods, or semicolons instead.\n"
            "- Write in plain, clean prose."
        )

        parts = [f"## Overall Project Goal\n{self.original_prompt}"]

        if task["depends_on"]:
            parts.append("\n## Outputs from prerequisite tasks (use these as context):")
            for dep_id in task["depends_on"]:
                dep = self.tasks[dep_id]
                parts.append(f"\n### Task {dep_id}: {dep['title']}\n{dep['output']}")

        parts.append(f"\n## Your Task\n**{task['title']}**\n{task['description']}")

        return [
            {"role": "system", "content": system},
            {"role": "user", "content": "\n".join(parts)},
        ]

    # ------------------------------------------------------------------
    # Single task execution (runs in thread pool)
    # ------------------------------------------------------------------

    def _run_task(self, task_id: int):
        task = self.tasks[task_id]
        try:
            task["started_at"] = time.time()
            self.events.put({
                "event": "agent_started",
                "data": {
                    "id": task_id,
                    "title": task["title"],
                    "model": task["assigned_model"],
                },
            })

            client = get_ollama_client()
            messages = self._build_messages(task)
            resp = client.chat(
                model=task["assigned_model"],
                messages=messages,
                stream=False,
            )
            output = resp["message"]["content"]

            prompt_tokens = (
                (resp.get("prompt_eval_count") if isinstance(resp, dict) else None)
                or (getattr(resp, "prompt_eval_count", None))
            )
            output_tokens = (
                (resp.get("eval_count") if isinstance(resp, dict) else None)
                or (getattr(resp, "eval_count", None))
            )

            if prompt_tokens is None:
                prompt_text = "\n".join(m.get("content", "") for m in messages)
                prompt_tokens = (len(prompt_text) + 3) // 4
            if output_tokens is None:
                output_tokens = (len(output) + 3) // 4

            pricing = _PRICING_PER_1M.get(task["assigned_model"], {"input": 0.0, "output": 0.0})
            input_cost = (float(prompt_tokens) / 1_000_000) * float(pricing["input"])
            output_cost = (float(output_tokens) / 1_000_000) * float(pricing["output"])
            total_cost = input_cost + output_cost

            with self._lock:
                task["status"] = "completed"
                task["output"] = output
                task["completed_at"] = time.time()

            self.events.put({
                "event": "agent_completed",
                "data": {
                    "id": task_id,
                    "title": task["title"],
                    "model": task["assigned_model"],
                    "output": output,
                    "duration": round(task["completed_at"] - task["started_at"], 2),
                    "input_tokens": int(prompt_tokens),
                    "output_tokens": int(output_tokens),
                    "input_cost": round(input_cost, 8),
                    "output_cost": round(output_cost, 8),
                    "total_cost": round(total_cost, 8),
                },
            })
        except Exception as e:
            with self._lock:
                task["status"] = "failed"
                task["error"] = str(e)
                task["completed_at"] = time.time()

            self.events.put({
                "event": "agent_failed",
                "data": {"id": task_id, "title": task["title"], "error": str(e)},
            })

        self._launch_ready()

    # ------------------------------------------------------------------
    # Synthesis — merge all agent outputs into one final deliverable
    # ------------------------------------------------------------------

    def _synthesise(self):
        self.events.put({"event": "synthesizing", "data": {}})

        # Gather completed outputs
        sections: list[str] = []
        for tid in sorted(self.tasks):
            t = self.tasks[tid]
            if t["status"] == "completed" and t["output"]:
                sections.append(f"### Agent {tid}: {t['title']} ({t['assigned_model']})\n{t['output']}")

        if not sections:
            self.events.put({
                "event": "synthesis_complete",
                "data": {"output": "No agent outputs to synthesise."},
            })
            self.events.put(None)
            return

        system = (
            "You are a synthesis engine. Multiple specialist AI agents have each completed "
            "a subtask of the user's original request. Their full outputs are provided below.\n\n"
            "Your job: produce ONLY the final deliverable that directly answers the user's request.\n\n"
            "Rules:\n"
            "- Output ONLY the end product — the thing the user actually asked for.\n"
            "- Do NOT include meta-commentary, reasoning, justifications, selection criteria, "
            "or explanations of why you chose something.\n"
            "- Do NOT label which agent produced what.\n"
            "- Do NOT add introductions like 'Here is the result' or conclusions like 'This works because...'.\n"
            "- Keep it concise and actionable. If the user asked for 3 tweets, output 3 tweets. "
            "If they asked for code, output the code. Nothing extra.\n"
            "- Use clean markdown formatting where appropriate.\n"
            "- NEVER use emojis or emoticons of any kind.\n"
            "- NEVER use em dashes or en dashes. Use commas, periods, or semicolons instead."
        )
        user_msg = (
            f"## Original Request\n{self.original_prompt}\n\n"
            f"## Agent Outputs\n" + "\n\n".join(sections)
        )

        try:
            client = get_ollama_client()
            resp = client.chat(
                model=self.orchestrator_model,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user_msg},
                ],
                stream=False,
            )
            final = resp["message"]["content"]
        except Exception as e:
            final = f"Synthesis failed ({e}). Raw agent outputs above."

        self.events.put({
            "event": "synthesis_complete",
            "data": {"output": final},
        })
        self.events.put(None)  # sentinel — stream is done

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def run(self) -> Queue:
        """Start execution. Returns the event Queue for SSE streaming."""
        self._launch_ready()
        return self.events
