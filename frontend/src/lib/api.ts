const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export type ChatMessage = { role: string; content: string };

export async function getModels(): Promise<{
  models: { name: string; size?: number; modified?: string }[];
  source: string;
  error?: string;
}> {
  const res = await fetch(`${API_BASE}/api/models`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function chat(model: string, messages: ChatMessage[]): Promise<{ message: ChatMessage }> {
  const res = await fetch(`${API_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, stream: false }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function health(): Promise<{ status: string; ollama_cloud: boolean }> {
  const res = await fetch(`${API_BASE}/api/health`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
