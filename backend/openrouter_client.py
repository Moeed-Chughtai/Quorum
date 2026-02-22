"""
OpenRouter API client for Gemini frontier model comparison.

Makes calls to Gemini models via OpenRouter API during agent execution to provide
a cost/time/CO2 comparison against the multi-agent Ollama pipeline.
"""

import os
import time
from pathlib import Path
import json
import httpx

from dotenv import load_dotenv

# Load .env
_backend_dir = Path(__file__).resolve().parent
load_dotenv(_backend_dir.parent / ".env")
load_dotenv(_backend_dir / ".env")

# OpenRouter API endpoint (OpenAI-compatible)
OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"

# Cached pricing loaded from model_specialization.json
_gemini_pricing_cache: dict | None = None
_default_gemini_model_cache: str | None = None


def _load_model_spec() -> dict:
    """Load the full model_specialization.json data."""
    spec_path = _backend_dir / "model_specialization.json"
    with open(spec_path) as f:
        return json.load(f)


def _load_gemini_pricing() -> dict:
    """Load Gemini pricing from model_specialization.json (single source of truth)."""
    global _gemini_pricing_cache
    if _gemini_pricing_cache is not None:
        return _gemini_pricing_cache
    
    data = _load_model_spec()
    
    pricing = {}
    for model in data.get("models", []):
        name = model.get("model", "")
        # Match Gemini models (OpenRouter format: google/gemini-*)
        if name.startswith("google/gemini-"):
            p = model.get("pricing_per_1m_tokens", {})
            pricing[name] = {
                "input": p.get("input", 1.0),
                "output": p.get("output", 5.0),
                "image_output": p.get("image_output"),
            }
    
    _gemini_pricing_cache = pricing
    return pricing


def get_default_gemini_model() -> str:
    """Return the default Gemini model from model_specialization.json."""
    global _default_gemini_model_cache
    if _default_gemini_model_cache is not None:
        return _default_gemini_model_cache
    
    data = _load_model_spec()
    _default_gemini_model_cache = data.get("defaults", {}).get("gemini_model", "google/gemini-2.5-flash")
    return _default_gemini_model_cache


def get_available_gemini_models() -> list[dict]:
    """Return list of available Gemini models with display names."""
    data = _load_model_spec()
    models = []
    for m in data.get("models", []):
        name = m.get("model", "")
        if name.startswith("google/gemini-"):
            models.append({
                "id": name,
                "display_name": get_gemini_display_name(name),
                "supports_images": "image" in name.lower(),
            })
    return models


# Estimated GPU power draw for Gemini inference (Watts)
# Conservative estimate for frontier models on datacenter GPUs
GEMINI_WATTS = 400

# Cloud datacenter carbon intensity (gCO2/kWh)
# US average datacenter mix
CLOUD_CARBON_INTENSITY = 400


def get_openrouter_api_key() -> str | None:
    """Return the OpenRouter API key from environment."""
    return os.getenv("OPENROUTER_API_KEY")


def is_gemini_available() -> bool:
    """Check if OpenRouter API is configured and available."""
    return bool(get_openrouter_api_key())


async def call_gemini(
    model: str,
    prompt: str,
    max_tokens: int = 4096,
    system_prompt: str | None = None,
) -> dict:
    """
    Call Gemini via OpenRouter API with the given prompt.
    
    Args:
        model: The Gemini model ID (e.g., 'google/gemini-2.5-flash')
        prompt: The user prompt
        max_tokens: Maximum tokens in response
        system_prompt: Optional system prompt for model behavior
    
    Returns:
        {
            "model": str,
            "model_display": str,
            "output": str,
            "input_tokens": int,
            "output_tokens": int,
            "cost_usd": float,
            "duration_s": float,
            "gco2": float,
        }
    """
    api_key = get_openrouter_api_key()
    if not api_key:
        raise RuntimeError("OPENROUTER_API_KEY not set")
    
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/HackEurope",  # Required by OpenRouter
        "X-Title": "GreenAgents",  # Optional: shows in OpenRouter dashboard
    }
    
    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": prompt})
    
    payload = {
        "model": model,
        "max_tokens": max_tokens,
        "messages": messages,
    }
    
    start_time = time.perf_counter()
    
    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(
            OPENROUTER_API_URL,
            headers=headers,
            json=payload,
        )
        response.raise_for_status()
        data = response.json()
    
    duration_s = time.perf_counter() - start_time
    
    # Extract usage from OpenAI-compatible response
    usage = data.get("usage", {})
    input_tokens = usage.get("prompt_tokens", 0)
    output_tokens = usage.get("completion_tokens", 0)
    
    # Extract output text
    output = ""
    choices = data.get("choices", [])
    if choices:
        message = choices[0].get("message", {})
        output = message.get("content", "")
    
    # Calculate cost from model_specialization.json pricing
    gemini_pricing = _load_gemini_pricing()
    pricing = gemini_pricing.get(model, {"input": 1.0, "output": 5.0})
    input_cost = (input_tokens / 1_000_000) * pricing["input"]
    output_cost = (output_tokens / 1_000_000) * pricing["output"]
    cost_usd = input_cost + output_cost
    
    # Estimate CO2
    # Energy (kWh) = Power (W) × Time (s) / 3600 / 1000
    energy_kwh = GEMINI_WATTS * duration_s / 3600 / 1000
    gco2 = energy_kwh * CLOUD_CARBON_INTENSITY
    
    return {
        "model": model,
        "model_display": get_gemini_display_name(model),
        "output": output,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "cost_usd": round(cost_usd, 6),
        "duration_s": round(duration_s, 2),
        "gco2": round(gco2, 6),
    }


def estimate_gemini_gco2(duration_s: float) -> float:
    """Estimate gCO2 for a Gemini call given duration."""
    energy_kwh = GEMINI_WATTS * duration_s / 3600 / 1000
    return energy_kwh * CLOUD_CARBON_INTENSITY


def estimate_gemini_baseline_gco2(
    model: str,
    total_tokens: int,
    carbon_intensity: float | None = None,
) -> float:
    """
    Estimate gCO2 if the same tokens were processed by Gemini.
    
    Uses a tokens-per-second estimate based on model tier:
    - Flash/Lite: ~100 tok/s
    - Pro: ~50 tok/s
    
    Args:
        model: Gemini model name (OpenRouter format)
        total_tokens: Total tokens (input + output)
        carbon_intensity: Override carbon intensity (gCO2/kWh), defaults to CLOUD_CARBON_INTENSITY
    
    Returns:
        Estimated gCO2
    """
    model_lower = model.lower()
    
    # Tokens per second estimates for Gemini models
    if "flash" in model_lower or "lite" in model_lower:
        tps = 100
    else:  # Pro variants
        tps = 50
    
    estimated_duration_s = total_tokens / tps
    intensity = carbon_intensity if carbon_intensity is not None else CLOUD_CARBON_INTENSITY
    
    energy_kwh = GEMINI_WATTS * estimated_duration_s / 3600 / 1000
    return energy_kwh * intensity


def get_gemini_display_name(model: str) -> str:
    """Return a human-friendly display name for a Gemini model."""
    # Remove provider prefix
    name = model.replace("google/", "")
    
    # Map known models to display names
    display_map = {
        "gemini-2.5-pro": "Gemini 2.5 Pro",
        "gemini-2.5-flash": "Gemini 2.5 Flash",
        "gemini-2.5-flash-image": "Gemini 2.5 Flash Image (Nano Banana)",
        "gemini-3-pro-preview": "Gemini 3 Pro Preview",
        "gemini-3.1-pro-preview": "Gemini 3.1 Pro Preview",
        "gemini-3-pro-image-preview": "Gemini 3 Pro Image (Nano Banana Pro)",
    }
    
    return display_map.get(name, name.replace("-", " ").title())
