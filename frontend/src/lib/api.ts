const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function getWalletBalance(userId: string = "demo"): Promise<{
  user_id: string;
  balance_microdollars: number;
  balance_usd: number;
}> {
  const res = await fetch(`${API_BASE}/api/billing/balance?user_id=${encodeURIComponent(userId)}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function topUpWallet(userId: string = "demo", amountUsd: number = 5.0): Promise<{
  status: string;
  balance_microdollars: number;
  balance_usd: number;
}> {
  const res = await fetch(`${API_BASE}/api/billing/topup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: userId, amount_usd: amountUsd }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function createTopupIntent(userId: string, amountCents: number): Promise<{
  payment_intent_id: string;
  client_secret: string;
  customer_id: string;
}> {
  const res = await fetch(`${API_BASE}/api/billing/create_topup_intent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: userId, amount_cents: amountCents, currency: "usd" }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export type Subtask = {
  id: number;
  title: string;
  description: string;
  category: string;
  depends_on: number[];
  assigned_model: string;
  routing_reason: string;
};

export type DecomposeResult = {
  original_prompt: string;
  orchestrator_model: string;
  subtasks: Subtask[];
};

export type CarbonIntensity = {
  intensity: number;   // gCO2/kWh
  zone: string;        // e.g. "FR"
  source: "electricity_maps" | "fallback";
};

export type ForecastPoint = {
  dt: string;          // ISO 8601 timestamp
  intensity: number;   // gCO2/kWh
  is_estimate: boolean;
};

export type GreenWindow = {
  dt: string;
  intensity: number;   // gCO2/kWh at green window
  minutes_from_now: number;
  savings_pct: number; // relative savings vs current intensity
};

export type CarbonForecast = {
  zone: string;
  current_intensity: number;
  history: ForecastPoint[];   // last 24 hourly samples (real or synthetic)
  forecast: ForecastPoint[];  // next 8 hourly samples (estimated)
  green_window: GreenWindow | null;
  source: "electricity_maps" | "synthetic_model";
};

export type CarbonSummary = {
  pipeline_gco2: number;
  agent_gco2: number;      // agent routing cost only (excludes synthesis)
  baseline_gco2: number;   // 70B single-model baseline carbon cost
  savings_pct: number;
  time_savings_pct: number;
  pipeline_time_s: number;
  sequential_time_s: number;
  carbon_intensity: number;
  zone: string;
  total_tokens: number;
};

export async function getModels(): Promise<{
  models: { name: string; size?: number; modified?: string }[];
  source: string;
  error?: string;
}> {
  const res = await fetch(`${API_BASE}/api/models`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getCarbonForecast(zone = "FR"): Promise<CarbonForecast> {
  const res = await fetch(`${API_BASE}/api/carbon-forecast?zone=${zone}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getCarbonIntensity(zone = "FR"): Promise<CarbonIntensity> {
  try {
    const res = await fetch(`${API_BASE}/api/carbon-intensity?zone=${zone}`);
    if (!res.ok) throw new Error("failed");
    return res.json();
  } catch {
    return { intensity: 65, zone, source: "fallback" };
  }
}

const DECOMPOSE_TIMEOUT_MS = 120_000;

export async function decompose(
  prompt: string,
  orchestratorModel: string = "gemma3:12b",
  signal?: AbortSignal,
): Promise<DecomposeResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DECOMPOSE_TIMEOUT_MS);
  const abortSignal = signal ?? controller.signal;

  try {
    const res = await fetch(`${API_BASE}/api/decompose`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, orchestrator_model: orchestratorModel }),
      signal: abortSignal,
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

export type TaskStatus = "pending" | "running" | "completed" | "failed";

export type SubtaskExecution = {
  status: TaskStatus;
  output: string | null;
  partialOutput: string | null;
  error: string | null;
  duration: number | null;
  gco2: number | null;
  tokens: number | null;
  startedAt: number | null;   // seconds since pipeline start (client-tracked)
  completedAt: number | null; // seconds since pipeline start (client-tracked)
  input_tokens?: number;
  output_tokens?: number;
  input_cost?: number;
  output_cost?: number;
  total_cost?: number;
};

export type ExecutionCallbacks = {
  onAgentStarted: (data: { id: number; title: string; model: string }) => void;
  onAgentToken: (data: { id: number; token: string }) => void;
  onAgentCompleted: (data: {
    id: number;
    title: string;
    model: string;
    output: string;
    duration: number;
    gco2: number;
    tokens: number;
    input_tokens?: number;
    output_tokens?: number;
    input_cost?: number;
    output_cost?: number;
    total_cost?: number;
  }) => void;
  onAgentFailed: (data: { id: number; title: string; error: string }) => void;
  onWalletUpdated?: (data: { user_id: string; balance_microdollars: number }) => void;
  onBillingRequired?: (data: { user_id: string; subtask_id: number; required_microdollars: number; balance_microdollars: number }) => void;
  onSynthesizing: () => void;
  onSynthesisToken: (data: { token: string }) => void;
  onSynthesisComplete: (data: { output: string }) => void;
  onCarbonUpdate: (data: { total_gco2: number }) => void;
  onCarbonSummary: (data: CarbonSummary) => void;
  onError: (error: string) => void;
};

export function executeSubtasks(
  result: DecomposeResult,
  callbacks: ExecutionCallbacks,
  options?: { user_id?: string },
): AbortController {
  const controller = new AbortController();

  fetch(`${API_BASE}/api/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      original_prompt: result.original_prompt,
      orchestrator_model: result.orchestrator_model,
      subtasks: result.subtasks,
      user_id: options?.user_id ?? "demo",
    }),
    signal: controller.signal,
  })
    .then((res) => {
      if (!res.ok) throw new Error(`Execute failed: HTTP ${res.status}`);
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      function pump(): Promise<void> {
        return reader.read().then(({ done, value }) => {
          if (done) return;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");
          buffer = lines.pop()!;

          let currentEvent = "";
          for (const line of lines) {
            if (line.startsWith("event: ")) {
              currentEvent = line.slice(7).trim();
            } else if (line.startsWith("data: ") && currentEvent) {
              const data = JSON.parse(line.slice(6));
              switch (currentEvent) {
                case "agent_started":
                  callbacks.onAgentStarted(data);
                  break;
                case "agent_token":
                  callbacks.onAgentToken(data);
                  break;
                case "agent_completed":
                  callbacks.onAgentCompleted(data);
                  break;
                case "agent_failed":
                  callbacks.onAgentFailed(data);
                  break;
                case "wallet_updated":
                  callbacks.onWalletUpdated?.(data);
                  break;
                case "billing_required":
                  callbacks.onBillingRequired?.(data);
                  break;
                case "synthesizing":
                  callbacks.onSynthesizing();
                  break;
                case "synthesis_token":
                  callbacks.onSynthesisToken(data);
                  break;
                case "synthesis_complete":
                  callbacks.onSynthesisComplete(data);
                  break;
                case "carbon_update":
                  callbacks.onCarbonUpdate(data);
                  break;
                case "carbon_summary":
                  callbacks.onCarbonSummary(data);
                  break;
              }
              currentEvent = "";
            }
          }
          return pump();
        });
      }

      return pump();
    })
    .catch((err) => {
      if (err.name !== "AbortError") {
        callbacks.onError(err.message);
      }
    });

  return controller;
}
