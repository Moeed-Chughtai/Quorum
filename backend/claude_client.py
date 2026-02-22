"""
Claude API client for frontier model comparison.

Makes parallel calls to Claude during agent execution to provide
a cost/time/CO2 comparison against the multi-agent Ollama pipeline.
"""

import os
import time
from pathlib import Path
import json

from dotenv import load_dotenv

# Load .env
_backend_dir = Path(__file__).resolve().parent
load_dotenv(_backend_dir.parent / ".env")
load_dotenv(_backend_dir / ".env")

# Lazy import anthropic to avoid import errors if not installed
_anthropic = None


def _get_anthropic():
    global _anthropic
    if _anthropic is None:
        import anthropic
        _anthropic = anthropic
    return _anthropic


# Cached pricing loaded from model_specialization.json
_claude_pricing_cache: dict | None = None
_default_claude_model_cache: str | None = None


def _load_model_spec() -> dict:
    """Load the full model_specialization.json data."""
    spec_path = _backend_dir / "model_specialization.json"
    with open(spec_path) as f:
        return json.load(f)


def _load_claude_pricing() -> dict:
    """Load Claude pricing from model_specialization.json (single source of truth)."""
    global _claude_pricing_cache
    if _claude_pricing_cache is not None:
        return _claude_pricing_cache
    
    data = _load_model_spec()
    
    pricing = {}
    for model in data.get("models", []):
        name = model.get("model", "")
        if name.startswith("claude-"):
            p = model.get("pricing_per_1m_tokens", {})
            pricing[name] = {
                "input": p.get("input", 3.0),
                "output": p.get("output", 15.0),
            }
    
    _claude_pricing_cache = pricing
    return pricing


def get_default_claude_model() -> str:
    """Return the default Claude model from model_specialization.json."""
    global _default_claude_model_cache
    if _default_claude_model_cache is not None:
        return _default_claude_model_cache
    
    data = _load_model_spec()
    _default_claude_model_cache = data.get("defaults", {}).get("claude_model", "claude-sonnet-4-5-20241022")
    return _default_claude_model_cache


def get_available_claude_models() -> list[dict]:
    """Return list of available Claude models with display names."""
    data = _load_model_spec()
    models = []
    for m in data.get("models", []):
        name = m.get("model", "")
        if name.startswith("claude-"):
            models.append({
                "id": name,
                "display_name": get_claude_display_name(name),
            })
    return models


# Estimated GPU power draw for Claude inference (Watts)
# Conservative estimate for frontier models on datacenter GPUs
CLAUDE_WATTS = 400

# Cloud datacenter carbon intensity (gCO2/kWh)
# US average datacenter mix — higher than France grid
CLOUD_CARBON_INTENSITY = 400


def get_claude_api_key() -> str | None:
    """Return the Anthropic API key from environment."""
    return os.getenv("ANTHROPIC_API_KEY")


def is_claude_available() -> bool:
    """Check if Claude API is configured and available."""
    return bool(get_claude_api_key())


async def call_claude(
    model: str,
    prompt: str,
    max_tokens: int = 4096,
    system_prompt: str | None = None,
) -> dict:
    """
    Call Claude API with the given prompt.
    
    Args:
        model: The Claude model ID (e.g., 'claude-sonnet-4-5-20241022')
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
    api_key = get_claude_api_key()
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY not set")
    
    anthropic = _get_anthropic()
    client = anthropic.AsyncAnthropic(api_key=api_key)
    
    start_time = time.perf_counter()
    
    # Build API call kwargs
    api_kwargs = {
        "model": model,
        "max_tokens": max_tokens,
        "messages": [{"role": "user", "content": prompt}],
    }
    if system_prompt:
        api_kwargs["system"] = system_prompt
    
    response = await client.messages.create(**api_kwargs)
    
    duration_s = time.perf_counter() - start_time
    
    # Extract usage
    input_tokens = response.usage.input_tokens
    output_tokens = response.usage.output_tokens
    
    # Extract output text
    output = ""
    for block in response.content:
        if hasattr(block, "text"):
            output += block.text
    
    # Calculate cost from model_specialization.json pricing
    claude_pricing = _load_claude_pricing()
    pricing = claude_pricing.get(model, {"input": 3.0, "output": 15.0})
    input_cost = (input_tokens / 1_000_000) * pricing["input"]
    output_cost = (output_tokens / 1_000_000) * pricing["output"]
    cost_usd = input_cost + output_cost
    
    # Estimate CO2
    # Energy (kWh) = Power (W) × Time (s) / 3600 / 1000
    energy_kwh = CLAUDE_WATTS * duration_s / 3600 / 1000
    gco2 = energy_kwh * CLOUD_CARBON_INTENSITY
    
    return {
        "model": model,
        "model_display": get_claude_display_name(model),
        "output": output,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "cost_usd": round(cost_usd, 6),
        "duration_s": round(duration_s, 2),
        "gco2": round(gco2, 6),
    }


def estimate_claude_gco2(duration_s: float) -> float:
    """Estimate gCO2 for a Claude call given duration."""
    energy_kwh = CLAUDE_WATTS * duration_s / 3600 / 1000
    return energy_kwh * CLOUD_CARBON_INTENSITY


def estimate_claude_baseline_gco2(
    model: str,
    total_tokens: int,
    carbon_intensity: float | None = None,
) -> float:
    """
    Estimate gCO2 if the same tokens were processed by Claude.
    
    Uses a tokens-per-second estimate based on model tier:
    - Haiku: ~100 tok/s
    - Sonnet: ~50 tok/s  
    - Opus: ~25 tok/s
    
    Args:
        model: Claude model name
        total_tokens: Total tokens (input + output)
        carbon_intensity: Override carbon intensity (gCO2/kWh), defaults to CLOUD_CARBON_INTENSITY
    
    Returns:
        Estimated gCO2
    """
    # Tokens per second estimates for Claude models
    if "haiku" in model.lower():
        tps = 100
    elif "sonnet" in model.lower():
        tps = 50
    else:  # opus
        tps = 25
    
    estimated_duration_s = total_tokens / tps
    intensity = carbon_intensity if carbon_intensity is not None else CLOUD_CARBON_INTENSITY
    
    energy_kwh = CLAUDE_WATTS * estimated_duration_s / 3600 / 1000
    return energy_kwh * intensity


def get_claude_display_name(model: str) -> str:
    """Return a human-friendly display name for a Claude model."""
    if "opus" in model.lower():
        return "Claude Opus 4.5"
    elif "sonnet" in model.lower():
        return "Claude Sonnet 4.5"
    elif "haiku" in model.lower():
        return "Claude Haiku 4.5"
    return model
