"""
Test de comparaison des couts : Pipeline Monolithique vs Agents Specialises
Base sur gemini_pipeline_comparison.md
Utilise l'API OpenRouter avec des modeles Gemini.
"""

import os
import sys
import time
import json
import base64
from datetime import datetime
import requests
from dotenv import load_dotenv

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
load_dotenv()

# ─── Paths ───────────────────────────────────────────────────────────────────

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
RESULTS_DIR = os.path.join(SCRIPT_DIR, "results")
os.makedirs(RESULTS_DIR, exist_ok=True)
RUN_ID = datetime.now().strftime("%Y%m%d_%H%M%S")

# ─── Charger les donnees externes ────────────────────────────────────────────

with open(os.path.join(SCRIPT_DIR, "reviews.json"), "r", encoding="utf-8") as f:
    REVIEWS = json.load(f)

with open(os.path.join(SCRIPT_DIR, "brief.txt"), "r", encoding="utf-8") as f:
    BRAND_BRIEF = f.read().strip()

# ─── Configuration API ───────────────────────────────────────────────────────

API_KEY = os.getenv("key", "").strip()
BASE_URL = "https://openrouter.ai/api/v1/chat/completions"

MODELS = {
    "pro": {
        "id": "google/gemini-3.1-pro-preview",
        "label": "Gemini 3.1 Pro",
        "input_price": 2.00,
        "output_price": 12.00,
    },
    "flash": {
        "id": "google/gemini-3-flash-preview",
        "label": "Gemini 3 Flash",
        "input_price": 0.50,
        "output_price": 3.00,
    },
    "lite": {
        "id": "google/gemini-2.5-flash-lite-preview-09-2025",
        "label": "Gemini 2.5 Flash Lite",
        "input_price": 0.10,
        "output_price": 0.40,
    },
}

# Modeles et couts image
IMAGE_MODEL_A = "google/gemini-3-pro-image-preview"
IMAGE_MODEL_A_LABEL = "Gemini 3 Pro Image"
IMAGE_COST_A = 0.134

IMAGE_MODEL_B = "sourceful/riverflow-v2-fast"
IMAGE_MODEL_B_LABEL = "Riverflow V2 Fast"
IMAGE_COST_B = 0.02

# ─── Helpers ─────────────────────────────────────────────────────────────────

call_log = []


def call_model(model_key, messages, label, max_tokens=1024):
    """Appelle un modele via OpenRouter, retourne (texte, metriques)."""
    model = MODELS[model_key]
    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://pipeline-cost-test.local",
    }
    payload = {
        "model": model["id"],
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": 0.7,
    }

    for attempt in range(2):
        try:
            t0 = time.time()
            resp = requests.post(BASE_URL, headers=headers, json=payload, timeout=120)
            latency = time.time() - t0
            data = resp.json()

            if "error" in data:
                print(f"  [ERREUR] {label}: {data['error']}")
                call_log.append({
                    "label": label, "model": model["label"], "model_id": model["id"],
                    "error": str(data["error"]), "timestamp": datetime.now().isoformat(),
                    "prompt": messages, "response": None,
                })
                if attempt == 0:
                    time.sleep(5)
                    continue
                return None, None

            content = data["choices"][0]["message"]["content"]
            usage = data.get("usage", {})
            prompt_tokens = usage.get("prompt_tokens", 0)
            completion_tokens = usage.get("completion_tokens", 0)

            input_cost = prompt_tokens * model["input_price"] / 1_000_000
            output_cost = completion_tokens * model["output_price"] / 1_000_000
            total_cost = input_cost + output_cost

            metrics = {
                "label": label,
                "model": model["label"],
                "model_id": model["id"],
                "input_tokens": prompt_tokens,
                "output_tokens": completion_tokens,
                "input_cost": input_cost,
                "output_cost": output_cost,
                "total_cost": total_cost,
                "latency_s": round(latency, 2),
                "timestamp": datetime.now().isoformat(),
                "prompt": messages,
                "response": content,
            }
            call_log.append(metrics)
            return content, metrics

        except Exception as e:
            print(f"  [EXCEPTION] {label}: {e}")
            call_log.append({
                "label": label, "model": model["label"], "model_id": model["id"],
                "error": str(e), "timestamp": datetime.now().isoformat(),
                "prompt": messages, "response": None,
            })
            if attempt == 0:
                time.sleep(3)
                continue
            return None, None

    return None, None


def generate_image(prompt_text, label, pipeline):
    """Genere une image via OpenRouter.
    Pipeline A → Gemini 3 Pro Image, Pipeline B → Riverflow V2 Fast.
    Retourne le chemin du fichier sauvegarde ou None."""

    model_id = IMAGE_MODEL_A if pipeline == "pipeline_a" else IMAGE_MODEL_B
    model_label = IMAGE_MODEL_A_LABEL if pipeline == "pipeline_a" else IMAGE_MODEL_B_LABEL
    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://pipeline-cost-test.local",
    }
    payload = {
        "model": model_id,
        "messages": [
            {"role": "user", "content": f"Generate an image: {prompt_text}"}
        ],
        "modalities": ["image", "text"],
        "max_tokens": 1024,
    }

    print(f"  {label}: Generation d'image via {model_id}...")
    try:
        t0 = time.time()
        resp = requests.post(BASE_URL, headers=headers, json=payload, timeout=180)
        latency = time.time() - t0
        data = resp.json()

        if "error" in data:
            print(f"    [IMAGE ERREUR] {data['error']}")
            print(f"    -> Cout image theorique ajoute au total ({pipeline})")
            return None

        message = data.get("choices", [{}])[0].get("message", {})
        usage = data.get("usage", {})
        img_cost = IMAGE_COST_A if pipeline == "pipeline_a" else IMAGE_COST_B

        # Methode 1: images array (format SDK OpenRouter)
        images = message.get("images", [])
        if images:
            for i, img in enumerate(images):
                url = img.get("image_url", {}).get("url", "")
                if url.startswith("data:"):
                    # data:image/png;base64,xxxx
                    header, b64data = url.split(",", 1)
                    ext = "png" if "png" in header else "jpg"
                    img_path = os.path.join(RESULTS_DIR, f"image_{pipeline}_{RUN_ID}.{ext}")
                    with open(img_path, "wb") as f:
                        f.write(base64.b64decode(b64data))
                    print(f"    Image sauvegardee: {img_path} ({latency:.1f}s)")
                    call_log.append({
                        "label": label, "model": model_label,
                        "model_id": model_id,
                        "input_tokens": usage.get("prompt_tokens", 0),
                        "output_tokens": usage.get("completion_tokens", 0),
                        "input_cost": 0, "output_cost": 0,
                        "total_cost": img_cost,
                        "latency_s": round(latency, 2),
                        "timestamp": datetime.now().isoformat(),
                        "prompt": [{"role": "user", "content": prompt_text[:300]}],
                        "response": f"[Image saved: {img_path}]",
                    })
                    return img_path

        # Methode 2: content multipart (inline_data)
        content = message.get("content", "")
        if isinstance(content, list):
            for part in content:
                if isinstance(part, dict) and part.get("type") == "image_url":
                    url = part.get("image_url", {}).get("url", "")
                    if url.startswith("data:"):
                        header, b64data = url.split(",", 1)
                        ext = "png" if "png" in header else "jpg"
                        img_path = os.path.join(RESULTS_DIR, f"image_{pipeline}_{RUN_ID}.{ext}")
                        with open(img_path, "wb") as f:
                            f.write(base64.b64decode(b64data))
                        print(f"    Image sauvegardee: {img_path} ({latency:.1f}s)")
                        call_log.append({
                            "label": label, "model": model_label,
                            "model_id": model_id,
                            "input_tokens": usage.get("prompt_tokens", 0),
                            "output_tokens": usage.get("completion_tokens", 0),
                            "input_cost": 0, "output_cost": 0,
                            "total_cost": img_cost,
                            "latency_s": round(latency, 2),
                            "timestamp": datetime.now().isoformat(),
                            "prompt": [{"role": "user", "content": prompt_text[:300]}],
                            "response": f"[Image saved: {img_path}]",
                        })
                        return img_path

        # Debug: sauvegarder la reponse brute pour comprendre le format
        debug_path = os.path.join(RESULTS_DIR, f"image_debug_{pipeline}_{RUN_ID}.json")
        with open(debug_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False, default=str)
        print(f"    [IMAGE DEBUG] Reponse sauvegardee: {debug_path}")
        print(f"    -> Cout image theorique ajoute au total ({pipeline})")
        return None

    except Exception as e:
        print(f"    [IMAGE ERREUR] {e}")
        print(f"    -> Cout image theorique ajoute au total ({pipeline})")
        return None


def sep(title):
    print(f"\n{'='*70}")
    print(f"  {title}")
    print(f"{'='*70}")


# ─── Pipeline A : Monolith ───────────────────────────────────────────────────

def run_pipeline_a():
    sep("PIPELINE A - MONOLITH (Gemini 3.1 Pro)")
    print("  1 seul appel au modele le plus cher pour tout faire...\n")

    reviews_block = "\n".join(f"  Review #{i+1}: \"{r}\"" for i, r in enumerate(REVIEWS))

    messages = [
        {"role": "system", "content": "You are a senior social media strategist and copywriter."},
        {"role": "user", "content": f"""{BRAND_BRIEF}

Here are {len(REVIEWS)} Google Reviews from our customers:
{reviews_block}

Please produce ALL of the following in a single response:
1. Pick the 2-3 best review quotes (most compelling, specific, emotional).
2. Write a main X (Twitter) post (max 280 chars) incorporating a quote snippet.
3. Write 2 variant posts (different angles, also max 280 chars each).
4. Suggest 3-5 relevant hashtags.
5. Write alt-text for a promotional image.
6. Write a detailed image generation prompt (style, composition, mood, colors).

Format your response clearly with labeled sections."""}
    ]

    content, metrics = call_model("pro", messages, "A1: Monolith (tout-en-un)")
    if metrics:
        print(f"  Tokens: {metrics['input_tokens']} in / {metrics['output_tokens']} out")
        print(f"  Cout texte: ${metrics['total_cost']:.5f}")

    # Tenter de generer l'image
    image_prompt = ""
    if content:
        # Extraire le prompt image de la reponse
        for marker in ["image generation prompt", "Image Prompt", "Image Generation"]:
            idx = content.lower().find(marker.lower())
            if idx != -1:
                image_prompt = content[idx:idx+500]
                break
        if not image_prompt:
            image_prompt = "Luxury home renovation, modern kitchen, warm lighting, professional photography"

    img_a = generate_image(image_prompt, "A2: Image", "pipeline_a")
    if not img_a:
        print(f"  + Cout image theorique ({IMAGE_MODEL_A_LABEL}): ${IMAGE_COST_A:.3f}")

    return content, metrics, img_a


# ─── Pipeline B : Agents specialises ─────────────────────────────────────────

def run_pipeline_b():
    sep("PIPELINE B - AGENTS SPECIALISES")

    # B1: Review Scorer (30 appels flash-lite)
    print("\n  B1: Scoring des avis (Flash Lite)...")
    scored_reviews = []
    b1_total = {"input_tokens": 0, "output_tokens": 0, "total_cost": 0}

    for i, review in enumerate(REVIEWS):
        messages = [
            {"role": "system", "content": "You are a review analyst. Score the review and extract the best quote."},
            {"role": "user", "content": f"""Score this Google Review on 5 criteria (1-5 each):
- Credibility (specific details, believable)
- Specificity (mentions particular services/features)
- Emotion (enthusiasm, strong positive feeling)
- Product mention (references specific work done)
- Tone (professional, quotable)

Review: "{review}"

Respond in JSON: {{"overall_score": X, "tags": [...], "best_quote": "..."}}"""}
        ]

        content, metrics = call_model("lite", messages, f"B1: Score review #{i+1}", max_tokens=200)
        if content:
            scored_reviews.append({"index": i, "review": review, "scoring": content})
        if metrics:
            b1_total["input_tokens"] += metrics["input_tokens"]
            b1_total["output_tokens"] += metrics["output_tokens"]
            b1_total["total_cost"] += metrics["total_cost"]

        if (i + 1) % 10 == 0:
            print(f"    ...{i+1}/{len(REVIEWS)} avis scores")

    print(f"  B1 total: {b1_total['input_tokens']} in / {b1_total['output_tokens']} out = ${b1_total['total_cost']:.5f}")

    # B2: Selector (flash-lite)
    print("\n  B2: Selection des meilleurs quotes (Flash Lite)...")
    scored_json = json.dumps(scored_reviews[:10], indent=1)
    messages = [
        {"role": "system", "content": "You are a content curator. Select the best review quotes for marketing."},
        {"role": "user", "content": f"""From these scored reviews, pick the top 3 most compelling quotes and suggest 2-3 marketing angles.

Scored reviews:
{scored_json}

Respond in JSON: {{"top_quotes": ["...","...","..."], "angles": ["...","..."]}}"""}
    ]

    b2_content, b2_metrics = call_model("lite", messages, "B2: Selector", max_tokens=300)
    if b2_metrics:
        print(f"  B2: {b2_metrics['input_tokens']} in / {b2_metrics['output_tokens']} out = ${b2_metrics['total_cost']:.5f}")

    # B3: Copywriter (flash)
    print("\n  B3: Redaction du post X (Gemini 3 Flash)...")
    messages = [
        {"role": "system", "content": "You are an expert social media copywriter for luxury home renovation brands."},
        {"role": "user", "content": f"""{BRAND_BRIEF}

Selected quotes and angles:
{b2_content}

Write:
1. Main X post (max 280 chars) using one of the quotes.
2. Variant 1 (different angle, max 280 chars).
3. Variant 2 (different angle, max 280 chars).
4. 3-5 relevant hashtags.
5. Alt-text for a promotional image."""}
    ]

    b3_content, b3_metrics = call_model("flash", messages, "B3: Copywriter", max_tokens=500)
    if b3_metrics:
        print(f"  B3: {b3_metrics['input_tokens']} in / {b3_metrics['output_tokens']} out = ${b3_metrics['total_cost']:.5f}")

    # B4: Image Prompt Builder (flash-lite)
    print("\n  B4: Creation du prompt image (Flash Lite)...")
    messages = [
        {"role": "system", "content": "You are a visual prompt engineer for AI image generation."},
        {"role": "user", "content": f"""Based on this social media post for a luxury home renovation brand, create a detailed image generation prompt.

Post: {b3_content[:300] if b3_content else 'Luxury home renovation post'}

Include: style (photorealistic), composition, lighting, mood, color palette, and negative prompts.
Format: a single detailed prompt paragraph."""}
    ]

    b4_content, b4_metrics = call_model("lite", messages, "B4: Image Prompt", max_tokens=250)
    if b4_metrics:
        print(f"  B4: {b4_metrics['input_tokens']} in / {b4_metrics['output_tokens']} out = ${b4_metrics['total_cost']:.5f}")

    # B5: Image generation
    img_b = generate_image(
        b4_content if b4_content else "Luxury home renovation, modern kitchen",
        "B5: Image", "pipeline_b"
    )
    if not img_b:
        print(f"  + Cout image theorique ({IMAGE_MODEL_B_LABEL}): ${IMAGE_COST_B:.3f}")

    return b3_content, None, b4_content, img_b


# ─── Rapport final ───────────────────────────────────────────────────────────

def print_report(a_content, a_metrics, b_content, b6_content, img_a, img_b):
    sep("RAPPORT DE COMPARAISON DES COUTS")

    # Totaux Pipeline B (ignorer erreurs)
    b_steps = {}
    for entry in call_log:
        label = entry["label"]
        if label.startswith("B") and "input_tokens" in entry:
            step = label.split(":")[0].strip()
            if step not in b_steps:
                b_steps[step] = {"input_tokens": 0, "output_tokens": 0, "total_cost": 0, "model": entry["model"]}
            b_steps[step]["input_tokens"] += entry["input_tokens"]
            b_steps[step]["output_tokens"] += entry["output_tokens"]
            b_steps[step]["total_cost"] += entry["total_cost"]

    a_text_cost = a_metrics["total_cost"] if a_metrics else 0
    # Cout image toujours ajoute (prix officiel doc, que l'image soit generee ou non)
    a_total = a_text_cost + IMAGE_COST_A

    b_text_cost_no_polish = sum(v["total_cost"] for k, v in b_steps.items() if k not in ("B5", "B6"))
    b_total_no_polish = b_text_cost_no_polish + IMAGE_COST_B

    b_text_cost_with_polish = sum(v["total_cost"] for k, v in b_steps.items() if k != "B5")
    b_total_with_polish = b_text_cost_with_polish + IMAGE_COST_B

    print(f"\n{'-'*70}")
    print(f"  {'Etape':<28} {'Modele':<22} {'Tokens (in/out)':<18} {'Cout':>8}")
    print(f"{'-'*70}")

    if a_metrics:
        print(f"  {'A1: Tout-en-un':<28} {a_metrics['model']:<22} {a_metrics['input_tokens']:>6}/{a_metrics['output_tokens']:<8} ${a_metrics['total_cost']:>7.5f}")
    img_a_tag = "ok" if img_a else "theorique"
    print(f"  {'A2: Image (' + img_a_tag + ')':<28} {IMAGE_MODEL_A_LABEL:<22} {'---':<18} ${IMAGE_COST_A:>7.3f}")
    print(f"  {'TOTAL PIPELINE A':<28} {'':<22} {'':<18} ${a_total:>7.5f}")

    print(f"{'-'*70}")

    for step_key in sorted(b_steps.keys()):
        if step_key == "B5":
            continue  # image affichee separement
        step = b_steps[step_key]
        labels = {"B1": "B1: Scoring (x30)", "B2": "B2: Selection", "B3": "B3: Copywriting",
                  "B4": "B4: Image prompt", "B6": "B6: Polish (opt.)"}
        lbl = labels.get(step_key, step_key)
        suffix = " *" if step_key == "B6" else ""
        print(f"  {lbl + suffix:<28} {step['model']:<22} {step['input_tokens']:>6}/{step['output_tokens']:<8} ${step['total_cost']:>7.5f}")

    img_b_tag = "ok" if img_b else "theorique"
    print(f"  {'B5: Image (' + img_b_tag + ')':<28} {IMAGE_MODEL_B_LABEL:<22} {'---':<18} ${IMAGE_COST_B:>7.3f}")
    print(f"  {'TOTAL PIPELINE B (sans B6)':<28} {'':<22} {'':<18} ${b_total_no_polish:>7.5f}")
    print(f"  {'TOTAL PIPELINE B (avec B6)':<28} {'':<22} {'':<18} ${b_total_with_polish:>7.5f}")

    print(f"{'-'*70}")

    if a_total > 0:
        savings_no = (1 - b_total_no_polish / a_total) * 100
        savings_with = (1 - b_total_with_polish / a_total) * 100
        ratio_no = a_total / b_total_no_polish if b_total_no_polish > 0 else 0
        ratio_with = a_total / b_total_with_polish if b_total_with_polish > 0 else 0

        print(f"\n  COMPARAISON:")
        print(f"  Pipeline A (Monolith):         ${a_total:.5f}")
        print(f"  Pipeline B (sans polish):      ${b_total_no_polish:.5f}  ({savings_no:.1f}% moins cher, {ratio_no:.1f}x)")
        print(f"  Pipeline B (avec polish):      ${b_total_with_polish:.5f}  ({savings_with:.1f}% moins cher, {ratio_with:.1f}x)")

    print(f"\n  Estimations du document:")
    print(f"  Pipeline A attendu:            $0.13964")
    print(f"  Pipeline B attendu (sans):     $0.02205")
    print(f"  Pipeline B attendu (avec):     $0.02381")
    print(f"  Economie attendue:             ~83-84%")

    # Images generees
    if img_a or img_b:
        sep("IMAGES GENEREES")
        if img_a:
            print(f"  Pipeline A: {img_a}")
        if img_b:
            print(f"  Pipeline B: {img_b}")
    else:
        print(f"\n  [NOTE] Aucune image generee (OpenRouter ne supporte pas la gen d'image)")
        print(f"  Les couts image sont theoriques d'apres le pricing Google.")

    # Outputs texte
    sep("OUTPUT PIPELINE A (Monolith)")
    print(a_content[:2000] if a_content else "  [Pas de reponse]")

    sep("OUTPUT PIPELINE B (Copywriter - Flash)")
    print(b_content[:2000] if b_content else "  [Pas de reponse]")

    if b6_content:
        sep("OUTPUT PIPELINE B (Premium Polish - Pro)")
        print(b6_content[:2000])

    print(f"\n{'='*70}")
    print(f"  Test termine! {len(call_log)} appels API effectues.")
    print(f"{'='*70}\n")

    save_results(a_content, a_metrics, a_total, b_content, b6_content,
                 b_steps, b_total_no_polish, b_total_with_polish, img_a, img_b)


def save_results(a_content, a_metrics, a_total, b_content, b6_content,
                 b_steps, b_total_no_polish, b_total_with_polish, img_a, img_b):
    """Sauvegarde log JSON complet + rapport texte dans results/."""

    # 1) Log JSON
    log_path = os.path.join(RESULTS_DIR, f"log_{RUN_ID}.json")
    full_log = {
        "run_id": RUN_ID,
        "timestamp": datetime.now().isoformat(),
        "models": MODELS,
        "summary": {
            "total_api_calls": len(call_log),
            "pipeline_a_total": a_total,
            "pipeline_b_no_polish": b_total_no_polish,
            "pipeline_b_with_polish": b_total_with_polish,
            "savings_pct": round((1 - b_total_no_polish / a_total) * 100, 1) if a_total > 0 else 0,
            "image_a": img_a,
            "image_b": img_b,
        },
        "calls": call_log,
    }
    with open(log_path, "w", encoding="utf-8") as f:
        json.dump(full_log, f, indent=2, ensure_ascii=False)

    # 2) Rapport texte
    report_path = os.path.join(RESULTS_DIR, f"report_{RUN_ID}.txt")
    lines = []
    lines.append(f"COMPARAISON PIPELINES - {RUN_ID}")
    lines.append("=" * 70)
    lines.append(f"Donnees: {len(REVIEWS)} avis depuis reviews.json + brief.txt")
    lines.append("")
    lines.append(f"{'Etape':<28} {'Modele':<22} {'In':>6} {'Out':>6} {'Cout':>10} {'Latence':>8}")
    lines.append("-" * 80)

    for entry in call_log:
        lat = f"{entry.get('latency_s', 0):.1f}s"
        lines.append(
            f"{entry['label']:<28} {entry['model']:<22} "
            f"{entry.get('input_tokens', 0):>6} {entry.get('output_tokens', 0):>6} "
            f"${entry.get('total_cost', 0):>9.6f} {lat:>8}"
        )

    lines.append("-" * 80)
    lines.append(f"Pipeline A total:  ${a_total:.5f}")
    lines.append(f"Pipeline B (sans polish): ${b_total_no_polish:.5f}")
    lines.append(f"Pipeline B (avec polish): ${b_total_with_polish:.5f}")
    if a_total > 0:
        lines.append(f"Economie: {(1 - b_total_no_polish / a_total) * 100:.1f}%")
    if img_a:
        lines.append(f"Image Pipeline A: {img_a}")
    if img_b:
        lines.append(f"Image Pipeline B: {img_b}")
    lines.append("")
    lines.append("=" * 70)
    lines.append("OUTPUT PIPELINE A (Monolith)")
    lines.append("=" * 70)
    lines.append(a_content if a_content else "[Pas de reponse]")
    lines.append("")
    lines.append("=" * 70)
    lines.append("OUTPUT PIPELINE B (Copywriter - Flash)")
    lines.append("=" * 70)
    lines.append(b_content if b_content else "[Pas de reponse]")
    if b6_content:
        lines.append("")
        lines.append("=" * 70)
        lines.append("OUTPUT PIPELINE B (Premium Polish - Pro)")
        lines.append("=" * 70)
        lines.append(b6_content)

    with open(report_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    print(f"\n  Resultats sauvegardes:")
    print(f"    Log complet (JSON): {log_path}")
    print(f"    Rapport (TXT):      {report_path}")


# ─── Main ────────────────────────────────────────────────────────────────────

def main():
    print(f"\n{'='*70}")
    print(f"  COMPARAISON MONOLITH vs AGENTS SPECIALISES")
    print(f"{'='*70}")

    if not API_KEY:
        print("\n  ERREUR: Cle API manquante dans .env (key = ...)")
        return

    print(f"\n  Cle API:   {API_KEY[:12]}...{API_KEY[-4:]}")
    print(f"  Modeles:   {', '.join(m['label'] for m in MODELS.values())}")
    print(f"  Avis:      {len(REVIEWS)} (reviews.json)")
    print(f"  Brief:     brief.txt")
    print(f"  Resultats: {RESULTS_DIR}")

    a_content, a_metrics, img_a = run_pipeline_a()
    b_content, b6_content, b4_content, img_b = run_pipeline_b()
    print_report(a_content, a_metrics, b_content, b6_content, img_a, img_b)


if __name__ == "__main__":
    main()
