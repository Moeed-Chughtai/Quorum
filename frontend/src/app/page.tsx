"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getModels,
  decompose,
  executeSubtasks,
  type DecomposeResult,
  type SubtaskExecution,
} from "@/lib/api";
import AgentWorkflow from "@/components/AgentWorkflow";

/* ------------------------------------------------------------------ */
/* Icons                                                               */
/* ------------------------------------------------------------------ */

function BoltIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Stats counter                                                       */
/* ------------------------------------------------------------------ */

function StatBlock({ value, label, delay }: { value: number; label: string; delay: number }) {
  return (
    <div className="animate-count" style={{ animationDelay: `${delay}ms` }}>
      <div className="text-[36px] font-extralight tabular-nums text-[var(--text-primary)] leading-none">
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-[0.15em] text-[var(--text-tertiary)] mt-1.5">
        {label}
      </div>
    </div>
  );
}

function Stats({ result }: { result: DecomposeResult }) {
  const agents = new Set(result.subtasks.map(s => s.assigned_model)).size;
  const cats = new Set(result.subtasks.map(s => s.category)).size;
  const deps = result.subtasks.reduce((n, s) => n + s.depends_on.length, 0);

  return (
    <div className="flex gap-12 mb-10 py-6 border-y border-[var(--border)]">
      <StatBlock value={result.subtasks.length} label="Subtasks" delay={0} />
      <StatBlock value={agents} label="Agents" delay={80} />
      <StatBlock value={cats} label="Categories" delay={160} />
      <StatBlock value={deps} label="Dependencies" delay={240} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

export default function Home() {
  const [models, setModels] = useState<{ name: string }[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [source, setSource] = useState<"cloud" | "local">("local");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DecomposeResult | null>(null);
  const [loadingMessage, setLoadingMessage] = useState("Decomposing...");

  const [executing, setExecuting] = useState(false);
  const [executionDone, setExecutionDone] = useState(false);
  const [taskStates, setTaskStates] = useState<Record<number, SubtaskExecution>>({});
  const [synthesizing, setSynthesizing] = useState(false);
  const [finalOutput, setFinalOutput] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const loadModels = useCallback(async () => {
    try {
      setError(null);
      const data = await getModels();
      const sortedModels = data.models.sort((a, b) => a.name.localeCompare(b.name));
      setModels(sortedModels);
      setSource(data.source as "cloud" | "local");
      if (data.error) setError(data.error);
      if (sortedModels.length && !selectedModel)
        setSelectedModel(sortedModels[0].name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load models");
      setModels([]);
    }
  }, [selectedModel]);

  useEffect(() => { loadModels(); }, [loadModels]);

  const handleDecompose = async () => {
    const text = input.trim();
    if (!text || !selectedModel || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setExecuting(false);
    setExecutionDone(false);
    setTaskStates({});
    setSynthesizing(false);
    setFinalOutput(null);
    setLoadingMessage("Decomposing...");
    const t = setTimeout(() => setLoadingMessage("Still working — models are thinking..."), 18_000);
    try {
      setResult(await decompose(text, selectedModel));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed";
      setError(msg.includes("abort") ? "Timed out. Try a shorter task." : msg);
    } finally {
      clearTimeout(t);
      setLoading(false);
    }
  };

  const handleExecute = () => {
    if (!result || executing) return;
    setExecuting(true);
    setExecutionDone(false);
    setFinalOutput(null);
    setSynthesizing(false);
    setError(null);
    const init: Record<number, SubtaskExecution> = {};
    for (const st of result.subtasks)
      init[st.id] = { status: "pending", output: null, error: null, duration: null };
    setTaskStates(init);

    abortRef.current = executeSubtasks(result, {
      onAgentStarted:    (d) => setTaskStates(p => ({ ...p, [d.id]: { ...p[d.id], status: "running" } })),
      onAgentCompleted:  (d) => setTaskStates(p => ({ ...p, [d.id]: { status: "completed", output: d.output, error: null, duration: d.duration } })),
      onAgentFailed:     (d) => setTaskStates(p => ({ ...p, [d.id]: { status: "failed", output: null, error: d.error, duration: null } })),
      onSynthesizing:    ()  => setSynthesizing(true),
      onSynthesisComplete: (d) => { setSynthesizing(false); setFinalOutput(d.output); setExecuting(false); setExecutionDone(true); },
      onError:           (e) => { setError(e); setExecuting(false); setSynthesizing(false); },
    });
  };

  const handleCancel = () => {
    abortRef.current?.abort();
    setExecuting(false);
  };

  const busy = loading || executing;

  return (
    <main className="min-h-screen">
      {/* ── Dark Navbar ── */}
      <nav className="bg-[var(--nav-bg)] border-b border-[var(--nav-border)]">
        <div className="max-w-2xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-md bg-[var(--accent)] flex items-center justify-center text-white">
              <BoltIcon />
            </div>
            <span className="text-[14px] font-semibold tracking-tight text-[var(--nav-text)]">
              AgentFlow
            </span>
          </div>
          <div className="flex items-center gap-5">
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span className="text-[10px] text-[var(--nav-text-muted)] uppercase tracking-wider">
                {source}
              </span>
            </div>
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="bg-[var(--nav-border)] text-[11px] text-[var(--nav-text-muted)] border border-[var(--nav-border)] rounded-md px-2 py-1 outline-none cursor-pointer hover:text-[var(--nav-text)] transition-colors"
            >
              {models.map((m) => (
                <option key={m.name} value={m.name}>{m.name}</option>
              ))}
            </select>
          </div>
        </div>
      </nav>

      {/* ── Content ── */}
      <div className="max-w-2xl mx-auto px-6 py-12">

        {/* ── Hero ── */}
        {!result && !loading && (
          <div className="mb-14 hero-glow animate-enter">
            <p className="text-[11px] uppercase tracking-[0.2em] text-[var(--accent)] mb-4 font-medium">
              Multi-Agent Orchestration
            </p>
            <h1 className="text-[40px] font-light tracking-tight text-[var(--text-primary)] leading-[1.1] mb-4">
              Break down any task.<br />
              <span className="text-[var(--text-tertiary)]">Execute with precision.</span>
            </h1>
            <p className="text-[14px] text-[var(--text-secondary)] max-w-sm leading-relaxed">
              Decompose complex tasks into subtasks, route to specialized AI agents, and execute in parallel with dependency-aware scheduling.
            </p>
          </div>
        )}

        {/* ── Prompt Bar ── */}
        <div className="mb-10">
          <form onSubmit={(e) => { e.preventDefault(); handleDecompose(); }}>
            <div className="relative group">
              <div className="absolute -inset-0.5 rounded-2xl bg-gradient-to-r from-[var(--accent)] via-[var(--accent-hover)] to-[var(--accent)] opacity-0 group-focus-within:opacity-[0.08] blur-sm transition-opacity duration-500" />

              <div className="relative bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-sm group-focus-within:shadow-lg group-focus-within:border-[var(--accent-border)] transition-all duration-300 overflow-hidden">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      handleDecompose();
                    }
                  }}
                  placeholder="What do you want to build?"
                  rows={3}
                  disabled={busy}
                  className="w-full bg-transparent px-5 pt-4 pb-14 text-[14px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none resize-none disabled:opacity-30 leading-relaxed"
                />

                <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-4 py-2.5 border-t border-[var(--border-subtle)] bg-[var(--surface-raised)]/60 backdrop-blur-sm">
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] text-[var(--text-tertiary)] font-mono">
                      {input.length > 0
                        ? (() => {
                            const trimmed = input.trim();
                            const words = trimmed ? trimmed.split(/\s+/).filter(Boolean).length : 0;
                            const tokens = trimmed ? Math.ceil(trimmed.replace(/\s+/g, " ").length / 4) : 0;
                            return `${words} words · ~${tokens} tokens`;
                          })()
                        : ""}
                    </span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <span className="text-[10px] text-[var(--text-tertiary)] hidden sm:block">
                      {typeof navigator !== "undefined" && navigator.platform?.includes("Mac") ? "\u2318" : "Ctrl"}+\u21B5
                    </span>
                    <button
                      type="submit"
                      disabled={busy || !input.trim() || !selectedModel}
                      className="btn-glow px-4 py-1.5 rounded-lg text-[12px] font-medium bg-[var(--nav-bg)] text-[var(--nav-text)] hover:bg-[var(--text-primary)] disabled:opacity-20 disabled:cursor-not-allowed transition-all duration-300 flex items-center gap-1.5"
                    >
                      {loading ? (
                        <>
                          <span className="w-3 h-3 border border-[var(--nav-text-muted)] border-t-transparent rounded-full animate-spin" />
                          Working...
                        </>
                      ) : (
                        <>
                          <BoltIcon />
                          Decompose
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </form>
        </div>

        {/* ── Error ── */}
        {error && (
          <div className="mb-8 px-4 py-3 rounded-lg border border-red-200 bg-red-50 animate-enter-scale">
            <p className="text-[12px] text-[var(--error)]">{error}</p>
          </div>
        )}

        {/* ── Loading ── */}
        {loading && (
          <div className="py-20 flex flex-col items-center animate-fade">
            <div className="relative mb-6">
              <div className="w-10 h-10 rounded-xl border border-[var(--accent-border)] bg-[var(--accent-subtle)] flex items-center justify-center text-[var(--accent)]" style={{ animation: "glow-breathe 2.5s ease-in-out infinite" }}>
                <BoltIcon />
              </div>
            </div>
            <div className="h-3 w-32 rounded-full shimmer-bg mb-3" />
            <p className="text-[11px] text-[var(--text-tertiary)]">{loadingMessage}</p>
          </div>
        )}

        {/* ── Results: stats only ── */}
        {!loading && result && (
          <Stats result={result} />
        )}
      </div>

      {/* ── Graph: full width, contains all execution UI ── */}
      {!loading && result && (
        <div className="mb-0 animate-enter-scale">
          <div className="max-w-2xl mx-auto px-6 mb-3">
            <p className="text-[11px] uppercase tracking-[0.15em] text-[var(--text-tertiary)] font-medium">
              Task dependency graph
            </p>
          </div>
          <AgentWorkflow
            subtasks={result.subtasks}
            taskStates={taskStates}
            executing={executing}
            executionDone={executionDone}
            synthesizing={synthesizing}
            finalOutput={finalOutput}
            onExecute={handleExecute}
            onCancel={handleCancel}
          />
        </div>
      )}

      {/* ── Footer ── */}
      <div className="max-w-2xl mx-auto px-6">
        <footer className="mt-24 pb-8">
          <div className="h-px bg-gradient-to-r from-transparent via-[var(--border)] to-transparent mb-6" />
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-[0.15em]">
              Built for HackEurope
            </p>
            <p className="text-[10px] text-[var(--text-tertiary)] font-mono opacity-50">
              {models.length} models loaded
            </p>
          </div>
        </footer>
      </div>
    </main>
  );
}
