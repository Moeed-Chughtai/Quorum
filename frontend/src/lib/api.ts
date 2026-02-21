const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export type ChatMessage = { role: string; content: string };

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

export async function getModels(): Promise<{
  models: { name: string; size?: number; modified?: string }[];
  source: string;
  error?: string;
}> {
  const res = await fetch(`${API_BASE}/api/models`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

const DECOMPOSE_TIMEOUT_MS = 120_000; // 2 min for 2 LLM calls

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

export async function chat(
  model: string,
  messages: ChatMessage[],
): Promise<{ message: ChatMessage }> {
  const res = await fetch(`${API_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, stream: false }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function health(): Promise<{
  status: string;
  ollama_cloud: boolean;
}> {
  const res = await fetch(`${API_BASE}/api/health`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
