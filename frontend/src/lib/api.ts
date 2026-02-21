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

// ---------------------------------------------------------------------------
// Agent execution (SSE streaming)
// ---------------------------------------------------------------------------

export type TaskStatus = "pending" | "running" | "completed" | "failed";

export type SubtaskExecution = {
  status: TaskStatus;
  output: string | null;
  error: string | null;
  duration: number | null;
  input_tokens?: number;
  output_tokens?: number;
  input_cost?: number;
  output_cost?: number;
  total_cost?: number;
};

export type ExecutionCallbacks = {
  onAgentStarted: (data: { id: number; title: string; model: string }) => void;
  onAgentCompleted: (data: {
    id: number;
    title: string;
    model: string;
    output: string;
    duration: number;
    input_tokens?: number;
    output_tokens?: number;
    input_cost?: number;
    output_cost?: number;
    total_cost?: number;
  }) => void;
  onAgentFailed: (data: { id: number; title: string; error: string }) => void;
  onSynthesizing: () => void;
  onSynthesisComplete: (data: { output: string }) => void;
  onError: (error: string) => void;
};

export function executeSubtasks(
  result: DecomposeResult,
  callbacks: ExecutionCallbacks,
): AbortController {
  const controller = new AbortController();

  fetch(`${API_BASE}/api/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      original_prompt: result.original_prompt,
      orchestrator_model: result.orchestrator_model,
      subtasks: result.subtasks,
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
                case "agent_completed":
                  callbacks.onAgentCompleted(data);
                  break;
                case "agent_failed":
                  callbacks.onAgentFailed(data);
                  break;
                case "synthesizing":
                  callbacks.onSynthesizing();
                  break;
                case "synthesis_complete":
                  callbacks.onSynthesisComplete(data);
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
