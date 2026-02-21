"use client";

import { useCallback, useEffect, useState } from "react";
import { getModels, decompose, type DecomposeResult, type Subtask } from "@/lib/api";

const CATEGORY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  coding:    { bg: "bg-violet-500/10", text: "text-violet-400", border: "border-violet-500/30" },
  reasoning: { bg: "bg-amber-500/10",  text: "text-amber-400",  border: "border-amber-500/30"  },
  research:  { bg: "bg-cyan-500/10",   text: "text-cyan-400",   border: "border-cyan-500/30"   },
  writing:   { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/30" },
  vision:    { bg: "bg-pink-500/10",   text: "text-pink-400",   border: "border-pink-500/30"   },
  math:      { bg: "bg-orange-500/10", text: "text-orange-400", border: "border-orange-500/30" },
  data:      { bg: "bg-teal-500/10",   text: "text-teal-400",   border: "border-teal-500/30"   },
  general:   { bg: "bg-zinc-500/10",   text: "text-zinc-400",   border: "border-zinc-500/30"   },
};

function CategoryBadge({ category }: { category: string }) {
  const c = CATEGORY_COLORS[category] ?? CATEGORY_COLORS.general;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${c.bg} ${c.text} border ${c.border}`}>
      {category}
    </span>
  );
}

function SubtaskCard({ subtask, index }: { subtask: Subtask; index: number }) {
  return (
    <div className={`animate-fade-in stagger-${Math.min(index + 1, 8)} group relative rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 transition-all hover:border-zinc-700 hover:bg-zinc-900/80`}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-bold shrink-0">
            {subtask.id}
          </div>
          <h3 className="text-sm font-semibold text-zinc-100 leading-tight">{subtask.title}</h3>
        </div>
        <CategoryBadge category={subtask.category} />
      </div>

      <p className="text-sm text-zinc-400 mb-4 leading-relaxed">{subtask.description}</p>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-500" />
          <span className="text-xs font-mono text-zinc-300">{subtask.assigned_model}</span>
        </div>
        {subtask.depends_on.length > 0 && (
          <span className="text-xs text-zinc-500">
            depends on: {subtask.depends_on.map(d => `#${d}`).join(", ")}
          </span>
        )}
      </div>

      <p className="mt-2 text-xs text-zinc-500 italic">{subtask.routing_reason}</p>
    </div>
  );
}

function LoadingState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-4">
      <div className="flex gap-1.5">
        {[0, 1, 2].map(i => (
          <div
            key={i}
            className="w-2.5 h-2.5 rounded-full bg-blue-500"
            style={{ animation: `pulse-dot 1.2s ease-in-out ${i * 0.2}s infinite` }}
          />
        ))}
      </div>
      <p className="text-sm text-zinc-500 text-center max-w-xs">{message}</p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 rounded-2xl bg-zinc-800 border border-zinc-700 flex items-center justify-center mb-4">
        <svg className="w-8 h-8 text-zinc-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25a2.25 2.25 0 0 1-2.25-2.25v-2.25Z" />
        </svg>
      </div>
      <h2 className="text-lg font-semibold text-zinc-300 mb-1">Task Decomposer</h2>
      <p className="text-sm text-zinc-500 max-w-sm">
        Enter a complex task and the system will break it into subtasks, then assign the best specialized AI agent for each.
      </p>
    </div>
  );
}

function ResultSummary({ result }: { result: DecomposeResult }) {
  const uniqueModels = new Set(result.subtasks.map(s => s.assigned_model));
  const categories = result.subtasks.reduce<Record<string, number>>((acc, s) => {
    acc[s.category] = (acc[s.category] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="animate-fade-in grid grid-cols-3 gap-3 mb-6">
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 text-center">
        <p className="text-2xl font-bold text-zinc-100">{result.subtasks.length}</p>
        <p className="text-xs text-zinc-500 mt-1">Subtasks</p>
      </div>
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 text-center">
        <p className="text-2xl font-bold text-zinc-100">{uniqueModels.size}</p>
        <p className="text-xs text-zinc-500 mt-1">Agents</p>
      </div>
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 text-center">
        <div className="flex flex-wrap justify-center gap-1">
          {Object.keys(categories).map(cat => (
            <CategoryBadge key={cat} category={cat} />
          ))}
        </div>
        <p className="text-xs text-zinc-500 mt-2">Categories</p>
      </div>
    </div>
  );
}

export default function Home() {
  const [models, setModels] = useState<{ name: string }[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [source, setSource] = useState<"cloud" | "local">("local");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DecomposeResult | null>(null);
  const [loadingMessage, setLoadingMessage] = useState<string>("Decomposing task & routing agents...");

  const loadModels = useCallback(async () => {
    try {
      setError(null);
      const data = await getModels();
      setModels(data.models);
      setSource(data.source as "cloud" | "local");
      if (data.error) setError(data.error);
      if (data.models.length && !selectedModel)
        setSelectedModel(data.models[0].name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load models");
      setModels([]);
    }
  }, [selectedModel]);

  useEffect(() => {
    loadModels();
  }, [loadModels]);

  const handleDecompose = async () => {
    const text = input.trim();
    if (!text || !selectedModel || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setLoadingMessage("Decomposing task & routing agents...");
    const slowMessageTimer = setTimeout(() => {
      setLoadingMessage("Still working… (decompose + routing can take 30–90s)");
    }, 18_000);
    try {
      const res = await decompose(text, selectedModel);
      setResult(res);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Decomposition failed";
      setError(msg.includes("abort") ? "Request timed out (2 min). Try a shorter task or check the backend." : msg);
    } finally {
      clearTimeout(slowMessageTimer);
      setLoading(false);
    }
  };

  return (
    <main className="max-w-3xl mx-auto px-6 py-10 min-h-screen flex flex-col">
      <header className="mb-8">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456Z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-zinc-100 tracking-tight">AgentFlow</h1>
        </div>
        <p className="text-sm text-zinc-500">
          Ollama {source} · {models.length} model{models.length !== 1 ? "s" : ""} available
        </p>
      </header>

      {/* Input area */}
      <div className="mb-6">
        <div className="flex gap-2 mb-3">
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-300 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all"
          >
            <option value="" disabled>Orchestrator model</option>
            {models.map((m) => (
              <option key={m.name} value={m.name}>
                {m.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={loadModels}
            className="px-3 py-2 rounded-lg border border-zinc-800 text-zinc-400 text-sm hover:bg-zinc-800 hover:text-zinc-300 transition-all"
          >
            Refresh
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleDecompose();
          }}
          className="relative"
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleDecompose();
              }
            }}
            placeholder="Describe a complex task... e.g. 'Build a REST API for a todo app with auth, database, and deploy to AWS'"
            rows={3}
            className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 pr-24 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all resize-none"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || !input.trim() || !selectedModel}
            className="absolute right-3 bottom-3 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            {loading ? "Running..." : "Decompose"}
          </button>
        </form>
        <p className="mt-2 text-xs text-zinc-600">Press Ctrl+Enter to submit</p>
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-xl bg-red-500/5 border border-red-500/20 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Results */}
      <div className="flex-1">
        {loading && <LoadingState message={loadingMessage} />}
        {!loading && !result && <EmptyState />}
        {!loading && result && (
          <>
            <ResultSummary result={result} />
            <div className="space-y-3">
              {result.subtasks.map((st, i) => (
                <SubtaskCard key={st.id} subtask={st} index={i} />
              ))}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
