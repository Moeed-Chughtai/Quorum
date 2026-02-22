"""
Carbon footprint tracker for LLM inference.

Energy estimates are derived from published benchmarks (Patterson et al. 2021,
Lannelongue et al. 2021, IEA 2023) and scaled from GPU TDP / throughput data.
Carbon intensity is fetched in real-time from the Electricity Maps API with a
France fallback (nuclear-heavy grid, ~55-70 gCO2/kWh).
"""

import json as _json
import math
import os
import re
import urllib.error
import urllib.request

# ---------------------------------------------------------------------------
# Energy model: kWh per 1K tokens by parameter count (billions)
# Based on A100 80GB TDP (400W) at batch=1 throughput, with PUE=1.12 overhead.
# MoE models (DeepSeek) use ~1/10 active params — adjusted accordingly.
# ---------------------------------------------------------------------------

_ENERGY_BY_PARAMS: list[tuple[float, float]] = [
    (1,    0.00005),
    (3,    0.00012),
    (7,    0.00028),
    (8,    0.00032),
    (12,   0.00054),
    (13,   0.00058),
    (14,   0.00063),
    (20,   0.00090),
    (27,   0.00121),
    (32,   0.00144),
    (70,   0.00315),
    (72,   0.00324),
    (90,   0.00405),
    (110,  0.00495),
    (405,  0.01823),
    (671,  0.01500),   # DeepSeek MoE: ~37B active, adjusted
]

# Real-time carbon intensity fallbacks by zone (gCO2/kWh)
# Source: Electricity Maps historical averages, 2024
_ZONE_FALLBACKS: dict[str, float] = {
    "FR": 65.0,    # France: nuclear-dominant, world's cleanest major grid
    "DE": 400.0,   # Germany: coal + renewables mix
    "GB": 225.0,   # UK: gas + offshore wind
    "US": 386.0,   # USA: mixed grid average
    "NO": 29.0,    # Norway: near-100% hydro
    "SE": 42.0,    # Sweden: hydro + nuclear
    "EU": 295.0,   # EU average
}

# Baseline: a typical large open-source frontier model (70B dense)
# Used as "what you would have used without AgentFlow routing"
BASELINE_PARAMS_B = 70.0

# Module-level cache so we only call the API once per process
_intensity_cache: dict[str, float] = {}


def _interp_energy(params_b: float) -> float:
    """Linear interpolation of energy kWh/1K tokens for arbitrary param count."""
    table = _ENERGY_BY_PARAMS
    if params_b <= table[0][0]:
        return table[0][1]
    if params_b >= table[-1][0]:
        return table[-1][1]
    for i in range(len(table) - 1):
        lo_p, lo_e = table[i]
        hi_p, hi_e = table[i + 1]
        if lo_p <= params_b <= hi_p:
            t = (params_b - lo_p) / (hi_p - lo_p)
            return lo_e + t * (hi_e - lo_e)
    return table[-1][1]


def extract_params_b(model_name: str) -> float:
    """Parse parameter count (billions) from a model name string.

    Handles patterns like: 'llama3:70b', 'qwen2.5:7b', 'deepseek-v3.1:671b',
    'ministral-3:3b'. Returns 7.0 as default if no match found.
    """
    # Match "<digits>[.<digits>]b" at word boundary — the colon separator in
    # Ollama model names ensures we don't confuse version numbers with param counts
    match = re.search(r":(\d+(?:\.\d+)?)\s*b\b", model_name.lower())
    if match:
        return float(match.group(1))
    # Fallback: match bare number+b at end of string
    match = re.search(r"(\d+(?:\.\d+)?)\s*b\b", model_name.lower())
    if match:
        return float(match.group(1))
    return 7.0  # sensible default


def get_carbon_intensity(zone: str = "FR") -> float:
    """Return grid carbon intensity in gCO2/kWh.

    Tries the Electricity Maps API if ELECTRICITY_MAPS_API_KEY is set.
    Results are cached for the process lifetime (good enough for a hackathon demo).
    """
    if zone in _intensity_cache:
        return _intensity_cache[zone]

    api_key = os.environ.get("ELECTRICITY_MAPS_API_KEY", "").strip()
    if api_key:
        try:
            req = urllib.request.Request(
                f"https://api.electricitymap.org/v3/carbon-intensity/latest?zone={zone}",
                headers={"auth-token": api_key},
            )
            with urllib.request.urlopen(req, timeout=5) as resp:
                data = _json.loads(resp.read().decode())
                intensity = float(data["carbonIntensity"])
                _intensity_cache[zone] = intensity
                return intensity
        except (urllib.error.URLError, KeyError, ValueError, OSError):
            pass  # Fall through to hardcoded fallback

    fallback = _ZONE_FALLBACKS.get(zone, _ZONE_FALLBACKS["EU"])
    _intensity_cache[zone] = fallback
    return fallback


def estimate_gco2(model_name: str, token_count: int, carbon_intensity: float) -> float:
    """Estimate gCO2 for a given number of tokens on a given model."""
    params_b = extract_params_b(model_name)
    energy_kwh = _interp_energy(params_b) * token_count / 1000.0
    return energy_kwh * carbon_intensity


def baseline_gco2(total_tokens: int, carbon_intensity: float) -> float:
    """Estimate gCO2 if the same tokens were processed by a single 70B model."""
    energy_kwh = _interp_energy(BASELINE_PARAMS_B) * total_tokens / 1000.0
    return energy_kwh * carbon_intensity


# Default GPU power (W) for duration-based energy. A100 80GB ~400W; adjust if known.
DEFAULT_GPU_WATTS = 400.0
PUE = 1.12  # Power usage effectiveness (datacenter overhead)


def get_carbon_forecast(zone: str = "FR") -> dict:
    """Return 24 h of historical carbon intensity + 8 h extrapolated forecast.

    Data source priority:
      1. Electricity Maps /v3/carbon-intensity/history  (real hourly data, free tier)
      2. Physics-informed synthetic model — two-cycle sinusoidal diurnal curve
         based on published demand patterns (IEA, ENTSO-E).

    Forecast strategy: same-hour value from 24 h ago (strong diurnal
    autocorrelation for all grid types) with the synthetic curve as fallback.
    """
    from datetime import datetime as _dt, timezone as _tz, timedelta as _td

    now = _dt.now(_tz.utc)
    current = get_carbon_intensity(zone)
    source = "synthetic_model"
    raw_history: list[dict] = []

    api_key = os.environ.get("ELECTRICITY_MAPS_API_KEY", "").strip()
    if api_key:
        try:
            req = urllib.request.Request(
                f"https://api.electricitymap.org/v3/carbon-intensity/history?zone={zone}",
                headers={"auth-token": api_key},
            )
            with urllib.request.urlopen(req, timeout=8) as resp:
                data = _json.loads(resp.read().decode())
                raw_history = data.get("history", [])
                source = "electricity_maps"
        except Exception:
            pass

    # Daily amplitude (fraction of base intensity).
    # Nuclear/hydro grids are very flat; fossil/wind grids swing more with demand.
    _amp = {
        "FR": 0.12, "NO": 0.08, "SE": 0.10,
        "DE": 0.30, "GB": 0.28, "US": 0.25,
    }.get(zone, 0.20)
    base_fb = _ZONE_FALLBACKS.get(zone, _ZONE_FALLBACKS["EU"])

    def _synth(dt: "_dt") -> float:
        """Two-cycle sinusoidal demand model (UTC time).
        Primary peak ~07:00 UTC (morning); secondary ~18:00 UTC (evening).
        Valleys ~03:00 and ~14:00.
        """
        h = dt.hour + dt.minute / 60.0
        primary   = math.sin(math.pi * (h - 7)  / 12)
        secondary = math.sin(math.pi * (h - 18) / 12)
        factor = 1.0 + _amp * (0.65 * primary + 0.35 * secondary)
        factor = max(0.75, min(1.35, factor))
        # Deterministic micro-noise so consecutive same-hour values differ slightly
        seed = (dt.year * 1000 + dt.timetuple().tm_yday * 24 + dt.hour) % 997
        noise = ((seed * 6271) % 100) / 100.0 * _amp * 0.12
        return round(base_fb * factor + base_fb * noise, 1)

    # ── Build history (last 24 hourly samples) ─────────────────────────────
    if source == "electricity_maps" and raw_history:
        history = [
            {
                "dt": pt["datetime"],
                "intensity": float(pt["carbonIntensity"]),
                "is_estimate": bool(pt.get("isEstimated", False)),
            }
            for pt in raw_history[-24:]
        ]
    else:
        history = [
            {
                "dt": (now - _td(hours=24 - i)).replace(minute=0, second=0, microsecond=0).isoformat(),
                "intensity": _synth(now - _td(hours=24 - i)),
                "is_estimate": True,
            }
            for i in range(24)
        ]

    # ── Build 8 h forecast ─────────────────────────────────────────────────
    # Prefer yesterday's same-hour intensity (diurnal autocorrelation r ≈ 0.85
    # for most grids over a 24 h horizon — see Haben et al. 2019).
    hourly_hist: dict[int, float] = {}
    for pt in history:
        try:
            dt_pt = _dt.fromisoformat(pt["dt"].replace("Z", "+00:00"))
            hourly_hist[dt_pt.hour] = pt["intensity"]
        except Exception:
            pass

    forecast = []
    for h in range(1, 9):
        t = now + _td(hours=h)
        t_r = t.replace(minute=0, second=0, microsecond=0)
        intensity = float(hourly_hist.get(t_r.hour, _synth(t)))
        forecast.append({
            "dt": t_r.isoformat(),
            "intensity": intensity,
            "is_estimate": True,
        })

    # ── Green window ────────────────────────────────────────────────────────
    green_window = None
    if forecast:
        best = min(forecast, key=lambda p: p["intensity"])
        best_idx = forecast.index(best)
        minutes_from_now = (best_idx + 1) * 60
        savings_pct = max(0.0, (current - best["intensity"]) / current * 100)
        if savings_pct > 3.0:
            green_window = {
                "dt": best["dt"],
                "intensity": best["intensity"],
                "minutes_from_now": minutes_from_now,
                "savings_pct": round(savings_pct, 1),
            }

    return {
        "zone": zone,
        "current_intensity": current,
        "history": history,
        "forecast": forecast,
        "green_window": green_window,
        "source": source,
    }


def estimate_gco2_from_duration_ns(
    duration_ns: int,
    carbon_intensity: float,
    power_watts: float = DEFAULT_GPU_WATTS,
) -> float:
    """Estimate gCO2 from real GPU time reported by Ollama (eval_duration + prompt_eval_duration).

    Uses actual compute time from the inference server; only assumption is GPU power.
    duration_ns: total nanoseconds (prompt_eval_duration + eval_duration) from the API.
    """
    if duration_ns <= 0:
        return 0.0
    seconds = duration_ns / 1e9
    energy_kwh = (power_watts / 1000.0) * seconds / 3600.0 * PUE
    return energy_kwh * carbon_intensity
