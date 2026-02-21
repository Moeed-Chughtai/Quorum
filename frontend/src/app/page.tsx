"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  getModels,
  decompose,
  executeSubtasks,
  type DecomposeResult,
  type Subtask,
  type SubtaskExecution,
  type TaskStatus,
} from "@/lib/api";
import AgentWorkflow from "@/components/AgentWorkflow";

/* ------------------------------------------------------------------ */
/* Icons                                                               */
/* ------------------------------------------------------------------ */

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`w-3.5 h-3.5 transition-transform duration-200 ${open ? "rotate-90" : ""}`}
      fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
    </svg>
  );
}

function BoltIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
      <rect x="6" y="6" width="12" height="12" rx="1" />
    </svg>
  );
}

function SparkleIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Markdown renderer                                                   */
/* ------------------------------------------------------------------ */

function Markdown({ children }: { children: string }) {
  return (
    <div className="prose-agent">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Status indicator                                                    */
/* ------------------------------------------------------------------ */

function StatusIndicator({ status }: { status: TaskStatus | "idle" }) {
  if (status === "running") {
    return (
      <span className="relative flex h-2 w-2 shrink-0">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--accent)] opacity-50" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--accent)]" />
      </span>
    );
  }

  const cls: Record<string, string> = {
    idle:      "bg-[var(--text-tertiary)]",
    pending:   "bg-[var(--border)]",
    completed: "bg-[var(--success)]",
    failed:    "bg-[var(--error)]",
  };

  return <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${cls[status]} opacity-60`} />;
}

/* ------------------------------------------------------------------ */
/* SubtaskCard                                                         */
/* ------------------------------------------------------------------ */

function SubtaskCard({
  subtask,
  index,
  execution,
}: {
  subtask: Subtask;
  index: number;
  execution?: SubtaskExecution;
}) {
  const status = execution?.status ?? "idle";
  const [open, setOpen] = useState(false);

  const isRunning = status === "running";
  const isCompleted = status === "completed";
  const isFailed = status === "failed";

  return (
    <div
      className={`
        animate-enter-scale stagger-${Math.min(index + 1, 8)}
        rounded-xl border transition-all duration-500 shadow-sm
        ${isRunning
          ? "card-running border-[var(--accent-border)] bg-[var(--accent-subtle)] shadow-md"
          : isCompleted
            ? "border-[var(--border)] bg-[var(--surface)]"
            : isFailed
              ? "border-red-200 bg-red-50/50"
              : "border-[var(--border-subtle)] bg-[var(--surface)] hover:border-[var(--border)] hover:shadow-md"
        }
      `}
    >
      <div className="flex items-center gap-3.5 px-5 py-3.5">
        <span className="text-[10px] font-mono tabular-nums text-[var(--text-tertiary)] w-5 text-right shrink-0">
          {String(subtask.id).padStart(2, "0")}
        </span>

        <StatusIndicator status={status} />

        <div className="flex-1 min-w-0">
          <h3 className={`text-[13px] font-medium truncate ${isRunning ? "text-[var(--accent)]" : "text-[var(--text-primary)]"}`}>
            {subtask.title}
          </h3>
          <p className="text-[11px] text-[var(--text-tertiary)] truncate mt-0.5">
            {subtask.description}
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <span className="text-[10px] font-mono text-[var(--accent)] px-1.5 py-0.5 rounded bg-[var(--accent-subtle)] border border-[var(--accent-border)]">
            {subtask.assigned_model}
          </span>
          <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)] px-2 py-0.5 rounded-full border border-[var(--border)] bg-[var(--surface-raised)]">
            {subtask.category}
          </span>
          {execution?.duration != null && (
            <span className="text-[10px] font-mono tabular-nums text-[var(--text-tertiary)]">
              {execution.duration}s
            </span>
          )}
        </div>
      </div>

      {/* Running shimmer */}
      {isRunning && (
        <div className="px-5 pb-3.5 pt-0 ml-[3.25rem]">
          <div className="space-y-1.5">
            <div className="h-2 rounded-full shimmer-bg w-full" />
            <div className="h-2 rounded-full shimmer-bg w-3/5" />
          </div>
        </div>
      )}

      {/* Completed — expandable markdown output */}
      {isCompleted && execution?.output && (
        <div className="px-5 pb-3.5 pt-0 ml-[3.25rem]">
          <button
            onClick={() => setOpen(!open)}
            className="group inline-flex items-center gap-1.5 text-[11px] text-[var(--text-tertiary)] hover:text-[var(--accent)] transition-colors"
          >
            <ChevronIcon open={open} />
            <span className="uppercase tracking-[0.08em]">View output</span>
            {execution.duration != null && (
              <span className="font-mono normal-case text-[10px]">{execution.duration}s</span>
            )}
          </button>
          {open && (
            <div className="mt-2 rounded-lg bg-[var(--surface-raised)] border border-[var(--border)] max-h-96 overflow-y-auto animate-enter-scale p-5">
              <Markdown>{execution.output}</Markdown>
            </div>
          )}
        </div>
      )}

      {/* Failed inline error */}
      {isFailed && execution?.error && (
        <div className="px-5 pb-3.5 pt-0">
          <p className="ml-[3.25rem] text-[11px] text-[var(--error)] font-mono">{execution.error}</p>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Execution progress                                                  */
/* ------------------------------------------------------------------ */

function ExecutionProgress({
  taskStates,
  total,
}: {
  taskStates: Record<number, SubtaskExecution>;
  total: number;
}) {
  const done = Object.values(taskStates).filter(t => t.status === "completed").length;
  const running = Object.values(taskStates).filter(t => t.status === "running").length;
  const failed = Object.values(taskStates).filter(t => t.status === "failed").length;
  const pct = ((done + failed) / total) * 100;

  return (
    <div className="mb-8 animate-fade">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <span className="text-[22px] font-extralight tabular-nums text-[var(--text-primary)]">
            {done}
          </span>
          <span className="text-[11px] text-[var(--text-tertiary)] uppercase tracking-wider">
            / {total} complete
          </span>
          {failed > 0 && (
            <span className="text-[11px] text-[var(--error)] tabular-nums">{failed} failed</span>
          )}
        </div>
        {running > 0 && (
          <span className="text-[11px] text-[var(--accent)] tabular-nums animate-fade flex items-center gap-1.5">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--accent)] opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[var(--accent)]" />
            </span>
            {running} running
          </span>
        )}
      </div>
      <div className="h-[2px] bg-[var(--border)] rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-[var(--accent)] to-[var(--accent-hover)] rounded-full transition-all duration-700 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
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
/* Synthesizing state                                                  */
/* ------------------------------------------------------------------ */

function SynthesizingState() {
  return (
    <div className="mt-12 animate-fade">
      <div className="flex items-center gap-4 mb-6">
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-[var(--accent-border)] to-transparent" />
        <div className="flex items-center gap-2 text-[var(--accent)]">
          <SparkleIcon />
          <span className="text-[11px] uppercase tracking-[0.15em] font-medium">Synthesizing</span>
        </div>
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-[var(--accent-border)] to-transparent" />
      </div>
      <div className="space-y-2.5 max-w-lg mx-auto">
        <div className="h-3.5 rounded-full shimmer-bg w-full" />
        <div className="h-3.5 rounded-full shimmer-bg w-5/6" />
        <div className="h-3.5 rounded-full shimmer-bg w-3/5" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Final output                                                        */
/* ------------------------------------------------------------------ */

function FinalOutput({ output }: { output: string }) {
  return (
    <div className="mt-12 animate-enter-scale">
      <div className="flex items-center gap-4 mb-6">
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-[var(--accent)] to-transparent opacity-30" />
        <div className="flex items-center gap-2 text-[var(--accent)]">
          <SparkleIcon />
          <span className="text-[11px] uppercase tracking-[0.15em] font-medium">Final Result</span>
        </div>
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-[var(--accent)] to-transparent opacity-30" />
      </div>
      <div className="rounded-xl border border-[var(--accent-border)] bg-[var(--surface)] shadow-lg p-6">
        <Markdown>{output}</Markdown>
      </div>
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
              {/* Outer glow ring on focus */}
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

                {/* Bottom toolbar */}
                <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-4 py-2.5 border-t border-[var(--border-subtle)] bg-[var(--surface-raised)]/60 backdrop-blur-sm">
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] text-[var(--text-tertiary)] font-mono">
                      {input.length > 0 ? `${input.trim().split(/\s+/).filter(Boolean).length} words` : ""}
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

        {/* ── Results ── */}
        {!loading && result && (
          <>
            <Stats result={result} />

            {/* Dependency graph */}
            <div className="mb-10 animate-enter-scale">
              <p className="text-[11px] uppercase tracking-[0.15em] text-[var(--text-tertiary)] mb-3 font-medium">
                Task dependency graph
              </p>
              <AgentWorkflow subtasks={result.subtasks} />
            </div>

            {/* Execute button */}
            {!executing && !executionDone && (
              <div className="mb-10 animate-enter-scale">
                <button
                  onClick={handleExecute}
                  className="btn-glow group w-full py-4 rounded-xl text-[13px] font-medium bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] transition-all duration-300 flex items-center justify-center gap-2 shadow-md"
                >
                  <BoltIcon />
                  Execute all {result.subtasks.length} agents
                </button>
              </div>
            )}

            {/* Cancel button */}
            {executing && !synthesizing && (
              <div className="mb-8 animate-fade">
                <button
                  onClick={() => { abortRef.current?.abort(); setExecuting(false); }}
                  className="group flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] text-[var(--text-tertiary)] border border-[var(--border)] hover:text-[var(--error)] hover:border-red-200 transition-all duration-300"
                >
                  <StopIcon />
                  Cancel execution
                </button>
              </div>
            )}

            {/* Progress */}
            {(executing || executionDone) && Object.keys(taskStates).length > 0 && (
              <ExecutionProgress taskStates={taskStates} total={result.subtasks.length} />
            )}

            {/* Task cards */}
            <div className="space-y-2.5">
              {result.subtasks.map((st, i) => (
                <SubtaskCard key={st.id} subtask={st} index={i} execution={taskStates[st.id]} />
              ))}
            </div>

            {/* Synthesis */}
            {synthesizing && <SynthesizingState />}
            {executionDone && finalOutput && <FinalOutput output={finalOutput} />}
          </>
        )}

        {/* ── Footer ── */}
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
