# Cost Comparison: Monolithic Gemini vs a Frontier of Specialized Agents
**Task:** Create a post for X (Twitter) that promotes your best Google Reviews **and** generates a matching image.

This document compares two ways to run the exact same job:

- **Pipeline A (Monolith):** one frontier model does everything end-to-end.
- **Pipeline B (Frontier-of-agents):** multiple specialized agents handle each subtask; the frontier model is used only where it adds real value.

---

## Assumptions (example run)
- **Number of reviews:** 30
- **Goal:** 1 final X post + 2 variants + hashtags + alt-text
- **One generated image:** 1K/2K size
- **Token estimates (illustrative):**
  - Monolith text prompt (brief + 30 reviews + constraints): **~1,500 input tokens**
  - Monolith output (post + variants + tags): **~220 output tokens**
  - Per-review scoring call: **~120 input / 40 output tokens**

> Note: Output token pricing for Gemini includes thinking tokens (per Google pricing).

---

## Official pricing used (Google Gemini API)
From the **Google AI for Developers – Gemini Developer API pricing** page:
- `gemini-3.1-pro-preview`: **$2.00 / 1M input tokens**, **$12.00 / 1M output tokens** (<=200k prompt)
- `gemini-3-flash-preview`: **$0.50 / 1M input**, **$3.00 / 1M output**
- `gemini-2.5-flash-lite-preview-09-2025`: **$0.10 / 1M input**, **$0.40 / 1M output**
- `gemini-3-pro-image-preview`: **$0.134 per 1K/2K image**
- `sourceful/riverflow-v2-fast` (OpenRouter): **$0.02 per 1K image**

(See references at the end for the exact pricing page URL.)

---

# Pipeline A — Monolithic (Gemini 3.1 Pro does the whole job)

## Step A1 — “Do everything”
**Model:** `gemini-3.1-pro-preview`  
**Input:**
- brief (brand voice, CTA, hashtags, constraints)
- 30 raw Google reviews
- ask for: best 2–3 review quotes, final post + variants, alt-text, and an image prompt

**Output:**
- final X post + 2 variants + hashtags
- selected review quotes
- alt-text
- image prompt

**Cost (text):**
- Input: 1,500 * $2.00 / 1,000,000 = **$0.00300**
- Output: 220 * $12.00 / 1,000,000 = **$0.00264**
- **Step A1 total = $0.00564**

## Step A2 — Generate the image
**Model:** `gemini-3-pro-image-preview`  
**Input:** image prompt from Step A1  
**Output:** 1 image (1K/2K)  
**Cost:** **$0.134**

### ✅ Total cost (Pipeline A)
**$0.00564 + $0.134 = $0.13964 per complete post (text + image)**

---

# Pipeline B — Frontier of specialized agents (cheaper, same deliverable)

## Step B1 — Review Scorer (one call per review)
**Model:** `gemini-2.5-flash-lite-preview-09-2025`  
**Input (per review):**
- one review text
- scoring rubric: credibility, specificity, emotion, product mention, tone
**Output (per review):**
- score (1–5)
- tags + best quote snippet

**Token estimate:** 120 in / 40 out per review  
**Cost (30 reviews):**
- Input tokens: 30*120 = 3,600 → 3,600 * $0.10 / 1,000,000 = **$0.00036**
- Output tokens: 30*40 = 1,200 → 1,200 * $0.40 / 1,000,000 = **$0.00048**
- **Step B1 total = $0.00084**

## Step B2 — Selector (pick the best quotes)
**Model:** `gemini-2.5-flash-lite-preview-09-2025`  
**Input:** all scored JSONs  
**Output:** top 3 quotes + 2–3 “angles”  
**Token estimate:** 800 in / 200 out  
**Cost:** **$0.00016**

## Step B3 — Copywriter (write the X post)
**Model:** `gemini-3-flash-preview`  
**Input:** top quotes + brief + constraints  
**Output:** final post + 2 variants + hashtags + alt-text  
**Token estimate:** 600 in / 220 out  
**Cost:**
- 600 * $0.50 / 1,000,000 = **$0.00030**
- 220 * $3.00 / 1,000,000 = **$0.00066**
- **Step B3 total = $0.00096**

## Step B4 — Image Prompt Builder
**Model:** `gemini-2.5-flash-lite-preview-09-2025`  
**Input:** final post + visual guidelines  
**Output:** clean image prompt (style + composition + negatives)  
**Token estimate:** 300 in / 150 out  
**Cost:** **$0.00009**

## Step B5 — Generate the image (specialized image model)
**Model:** `sourceful/riverflow-v2-fast`
**Input:** image prompt  
**Output:** 1 image  
**Cost:** **$0.02**

## (Optional) Step B6 — Premium polish (luxury tone)
**Model:** `gemini-3.1-pro-preview`  
**Input:** draft post + variants  
**Output:** refined post  
**Token estimate:** 220 in / 110 out  
**Cost:** **$0.00176**

### ✅ Total cost (Pipeline B)
- **Without premium polish:**  
  $0.00084 + $0.00016 + $0.00096 + $0.00009 + $0.02 = **$0.02205**
- **With premium polish:**  
  $0.02205 + $0.00176 = **$0.02381**

---

# Summary (this example)
- **Monolith (Gemini 3.1 Pro + Gemini image):** **$0.13964**
- **Frontier-of-agents (Flash-Lite + Flash + Riverflow V2 Fast):** **$0.02205–$0.02381**

**Savings:** ~83–84% cheaper (about **5.9× to 6.3×** cheaper) for the same output *in this example*.

---

## Why the “frontier-of-agents” wins economically
1. **Repetitive work is routed to cheap models** (per-review scoring and selection).
2. **Premium intelligence is used only where it creates value** (final copy polish).
3. **Image generation cost dominates** in many marketing tasks: using a specialized image model (Riverflow V2 Fast) is much cheaper than Gemini Pro Image preview.

---

## References (official pricing)
```text
Google AI for Developers – Gemini Developer API pricing:
https://ai.google.dev/gemini-api/docs/pricing

OpenRouter – Sourceful Riverflow V2 Fast:
https://openrouter.ai/sourceful/riverflow-v2-fast
```
