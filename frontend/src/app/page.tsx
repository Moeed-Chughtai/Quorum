"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  getModels,
  getWalletBalance,
  getCarbonIntensity,
  getCarbonForecast,
  decompose,
  executeSubtasks,
  type DecomposeResult,
  type SubtaskExecution,
  type CarbonIntensity,
  type CarbonSummary,
  type CarbonForecast,
} from "@/lib/api";
import AgentWorkflow from "@/components/AgentWorkflow";
import ExecutionTimeline from "@/components/ExecutionTimeline";
import GreenWindowScheduler from "@/components/GreenWindowScheduler";

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

function LeafIcon({ className }: { className?: string }) {
  return (
    <svg className={className ?? "w-3 h-3"} fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 2c-5 0-9 4.5-9 10 0 3.5 2 7 5 8.5V22h4v-1.5c3-1.5 5-5 5-8.5 0-5.5-4-10-5-10z" />
    </svg>
  );
}

function ArrowLeftIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Shared Nav                                                          */
/* ------------------------------------------------------------------ */

function Nav({
  models,
  selectedModel,
  source,
  carbonIntensity,
  walletBalance,
  onModelChange,
}: {
  models: { name: string }[];
  selectedModel: string;
  source: string;
  carbonIntensity: CarbonIntensity | null;
  walletBalance: number | null;
  onModelChange: (m: string) => void;
}) {
  return (
    <nav className="shrink-0 bg-[var(--nav-bg)] border-b border-[var(--nav-border)]">
      <div className="max-w-full px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-md bg-[var(--accent)] flex items-center justify-center text-white">
            <BoltIcon />
          </div>
          <span className="text-[14px] font-semibold tracking-tight text-[var(--nav-text)]">
            Quorum
          </span>
        </div>

        <div className="flex items-center gap-4">
          {walletBalance !== null && (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-[var(--nav-border)]">
              <span className="text-[10px] text-emerald-400 font-medium font-mono tabular-nums">
                ${(walletBalance / 1_000_000).toFixed(2)}
              </span>
            </div>
          )}
          {carbonIntensity && (
            <div className="flex items-center gap-1.5 bg-emerald-950/40 border border-emerald-800/30 rounded-md px-2 py-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
              <span className="text-[10px] text-emerald-400 font-mono tabular-nums">
                {carbonIntensity.intensity} gCO₂/kWh
              </span>
              <span className="text-[10px] text-emerald-600 font-mono">{carbonIntensity.zone}</span>
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span className="text-[10px] text-[var(--nav-text-muted)] uppercase tracking-wider">{source}</span>
          </div>
          <select
            value={selectedModel}
            onChange={(e) => onModelChange(e.target.value)}
            className="bg-[var(--nav-border)] text-[11px] text-[var(--nav-text-muted)] border border-[var(--nav-border)] rounded-md px-2 py-1 outline-none cursor-pointer hover:text-[var(--nav-text)] transition-colors"
          >
            {models.map((m) => (
              <option key={m.name} value={m.name}>{m.name}</option>
            ))}
          </select>
        </div>
      </div>
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/* Tab types                                                           */
/* ------------------------------------------------------------------ */

type TabId = "graph" | "carbon" | "output";

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
  const [synthesisPartial, setSynthesisPartial] = useState<string | null>(null);
  const [finalOutput, setFinalOutput] = useState<string | null>(null);
  const [walletBalance, setWalletBalance] = useState<number | null>(null);

  // Carbon tracking
  const [carbonIntensity, setCarbonIntensity] = useState<CarbonIntensity | null>(null);
  const [totalCarbon, setTotalCarbon] = useState<number>(0);
  const [carbonSummary, setCarbonSummary] = useState<CarbonSummary | null>(null);
  const [carbonTimeSeries, setCarbonTimeSeries] = useState<Array<{ t: number; actual: number }>>([]);

  // Tab state
  const [activeTab, setActiveTab] = useState<TabId>("graph");
  const [shortcutMod, setShortcutMod] = useState("Ctrl"); // stable for SSR; updated in useEffect

  // Green window scheduling
  const [forecast, setForecast] = useState<CarbonForecast | null>(null);
  const [scheduledAt, setScheduledAt] = useState<number | null>(null); // Date.now() target
  const [countdownStr, setCountdownStr] = useState<string | null>(null);
  const [shouldAutoExecute, setShouldAutoExecute] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const executionStartRef = useRef<number>(0);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);

  // Auto-switch to Output tab when synthesis completes
  useEffect(() => {
    if (executionDone && finalOutput) setActiveTab("output");
  }, [executionDone, finalOutput]);

  // Auto-switch to Graph tab when execution starts (to watch agents run)
  useEffect(() => {
    if (executing) setActiveTab("graph");
  }, [executing]);

  const loadModels = useCallback(async () => {
    try {
      setError(null);
      const data = await getModels();
      const sorted = data.models.sort((a, b) => a.name.localeCompare(b.name));
      setModels(sorted);
      setSource(data.source as "cloud" | "local");
      if (data.error) setError(data.error);
      if (sorted.length && !selectedModel) setSelectedModel(sorted[0].name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load models");
      setModels([]);
    }
  }, [selectedModel]);

  useEffect(() => { loadModels(); }, [loadModels]);

  useEffect(() => {
    getWalletBalance("demo").then(d => setWalletBalance(d.balance_microdollars)).catch(() => { });
  }, []);

  useEffect(() => {
    getCarbonIntensity("FR").then(setCarbonIntensity).catch(() => { });
  }, []);

  // Fetch 24 h history + 8 h forecast for green-window scheduling
  useEffect(() => {
    getCarbonForecast("FR").then(setForecast).catch(() => { });
  }, []);

  // Countdown ticker — runs only while scheduledAt is set
  useEffect(() => {
    if (!scheduledAt) { setCountdownStr(null); return; }
    const tick = () => {
      const rem = scheduledAt - Date.now();
      if (rem <= 0) {
        setScheduledAt(null);
        setCountdownStr(null);
        setShouldAutoExecute(true);
      } else {
        const s = Math.ceil(rem / 1000);
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = s % 60;
        setCountdownStr(
          h > 0
            ? `${h}h ${String(m).padStart(2, "0")}m`
            : `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
        );
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [scheduledAt]);

  // Fire execute when the scheduled countdown reaches zero
  useEffect(() => {
    if (shouldAutoExecute && result && !executing) {
      setShouldAutoExecute(false);
      handleExecute();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldAutoExecute]);

  useEffect(() => {
    setShortcutMod(typeof navigator !== "undefined" && /mac/i.test(navigator.userAgent) ? "\u2318" : "Ctrl");
  }, []);

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
    setTotalCarbon(0);
    setCarbonSummary(null);
    setCarbonTimeSeries([]);
    setActiveTab("graph");
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
    const t0 = Date.now() / 1000;
    executionStartRef.current = t0;
    setExecuting(true);
    setExecutionDone(false);
    setFinalOutput(null);
    setSynthesizing(false);
    setSynthesisPartial(null);
    setTotalCarbon(0);
    setCarbonSummary(null);
    setCarbonTimeSeries([]);
    setError(null);
    const init: Record<number, SubtaskExecution> = {};
    for (const st of result.subtasks)
      init[st.id] = { status: "pending", output: null, partialOutput: null, error: null, duration: null, gco2: null, tokens: null, startedAt: null, completedAt: null };
    setTaskStates(init);

    abortRef.current = executeSubtasks(result, {
      onAgentStarted: (d) => setTaskStates(p => ({ ...p, [d.id]: { ...p[d.id], status: "running", startedAt: Date.now() / 1000 - executionStartRef.current } })),
      onAgentToken: (d) => setTaskStates(p => ({ ...p, [d.id]: { ...p[d.id], partialOutput: (p[d.id]?.partialOutput ?? "") + d.token } })),
      onAgentCompleted: (d) => setTaskStates(p => ({ ...p, [d.id]: { status: "completed", output: d.output, partialOutput: null, error: null, duration: d.duration, gco2: d.gco2, tokens: d.tokens, startedAt: p[d.id]?.startedAt ?? null, completedAt: Date.now() / 1000 - executionStartRef.current, input_tokens: d.input_tokens, output_tokens: d.output_tokens, input_cost: d.input_cost, output_cost: d.output_cost, total_cost: d.total_cost } })),
      onAgentFailed: (d) => setTaskStates(p => ({ ...p, [d.id]: { status: "failed", output: null, partialOutput: null, error: d.error, duration: null, gco2: null, tokens: null, startedAt: p[d.id]?.startedAt ?? null, completedAt: Date.now() / 1000 - executionStartRef.current } })),
      onSynthesizing: () => { setSynthesizing(true); setSynthesisPartial(""); },
      onSynthesisToken: (d) => setSynthesisPartial(p => (p ?? "") + d.token),
      onSynthesisComplete: (d) => { setSynthesizing(false); setSynthesisPartial(null); setFinalOutput(d.output); setExecuting(false); setExecutionDone(true); },
      onCarbonUpdate: (d) => { setTotalCarbon(d.total_gco2); setCarbonTimeSeries(p => [...p, { t: Date.now() / 1000 - executionStartRef.current, actual: d.total_gco2 }]); },
      onCarbonSummary: (d) => setCarbonSummary(d),
      onBillingRequired: (d) => setError(`Insufficient balance. Need $${(d.required_microdollars / 1e6).toFixed(4)} (balance: $${(d.balance_microdollars / 1e6).toFixed(4)}). Top up to continue.`),
      onWalletUpdated: (d) => setWalletBalance(d.balance_microdollars),
      onError: (e) => { setError(e); setExecuting(false); setSynthesizing(false); },
    }, { user_id: "demo" });
  };

  const handleCancel = () => {
    abortRef.current?.abort();
    setExecuting(false);
  };

  const handleReset = () => {
    abortRef.current?.abort();
    setResult(null);
    setExecuting(false);
    setExecutionDone(false);
    setTaskStates({});
    setSynthesizing(false);
    setSynthesisPartial(null);
    setFinalOutput(null);
    setTotalCarbon(0);
    setCarbonSummary(null);
    setCarbonTimeSeries([]);
    setScheduledAt(null);
    setCountdownStr(null);
    setError(null);
    setActiveTab("graph");
  };

  const busy = loading || executing;

  /* ---------------------------------------------------------------- */
  /* App mode — shown after decomposition                              */
  /* ---------------------------------------------------------------- */

  if (result && !loading) {
    const agentCount = new Set(result.subtasks.map(s => s.assigned_model)).size;
    const hasCarbon = carbonTimeSeries.length > 0;
    const hasOutput = !!finalOutput;
    const truncatedPrompt = result.original_prompt.length > 70
      ? result.original_prompt.slice(0, 70) + "…"
      : result.original_prompt;

    return (
      <div className="flex flex-col h-screen overflow-hidden" style={{ background: "var(--bg)" }}>
        {/* Nav */}
        <Nav
          models={models}
          selectedModel={selectedModel}
          source={source}
          carbonIntensity={carbonIntensity}
          walletBalance={walletBalance}
          onModelChange={setSelectedModel}
        />

        {/* Compact task bar */}
        <div className="shrink-0 border-b border-[var(--border)] px-5 py-2 flex items-center gap-3" style={{ background: "var(--surface)" }}>
          <button
            onClick={handleReset}
            className="shrink-0 flex items-center gap-1.5 text-[11px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
          >
            <ArrowLeftIcon />
            New Task
          </button>

          <div className="w-px h-4 bg-[var(--border)] shrink-0" />

          <p className="flex-1 min-w-0 text-[11px] text-[var(--text-secondary)] truncate font-mono">
            {truncatedPrompt}
          </p>

          <div className="flex items-center gap-1.5 shrink-0">
            <span className="px-2 py-0.5 rounded-full text-[10px] tabular-nums border border-[var(--border)] text-[var(--text-tertiary)]" style={{ background: "var(--surface-raised)" }}>
              {result.subtasks.length} tasks
            </span>
            <span className="px-2 py-0.5 rounded-full text-[10px] tabular-nums border border-[var(--border)] text-[var(--text-tertiary)]" style={{ background: "var(--surface-raised)" }}>
              {agentCount} agents
            </span>
            {totalCarbon > 0 && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono tabular-nums border border-emerald-800/30 text-emerald-400 flex items-center gap-1" style={{ background: "rgb(6 78 59 / 0.15)" }}>
                <LeafIcon className="w-2.5 h-2.5" />
                {totalCarbon.toFixed(5)} gCO₂
              </span>
            )}
          </div>
        </div>

        {/* Tab bar */}
        <div className="shrink-0 border-b border-[var(--border)] px-5 flex items-center" style={{ background: "var(--surface-raised)" }}>
          {(["graph", "carbon", "output"] as TabId[]).map((tab) => {
            const labels: Record<TabId, string> = { graph: "Agent Graph", carbon: "Carbon", output: "Output" };
            const isActive = activeTab === tab;

            let badge: React.ReactNode = null;
            if (tab === "carbon" && hasCarbon)
              badge = <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />;
            if (tab === "output") {
              if (synthesizing)
                badge = <span className="w-3 h-3 border border-[var(--accent)] border-t-transparent rounded-full animate-spin shrink-0" />;
              else if (hasOutput)
                badge = <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "var(--accent)" }} />;
            }

            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2.5 text-[12px] font-medium border-b-2 transition-all flex items-center gap-2 ${isActive
                    ? "border-[var(--accent)] text-[var(--text-primary)]"
                    : "border-transparent text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                  }`}
              >
                {labels[tab]}
                {badge}
              </button>
            );
          })}
        </div>

        {/* Error banner */}
        {error && (
          <div className="shrink-0 px-5 py-2 border-b border-red-200 bg-red-50">
            <p className="text-[12px] text-[var(--error)]">{error}</p>
          </div>
        )}

        {/* Tab content — fills remaining height */}
        <div className="flex-1 overflow-hidden">

          {/* Graph tab — side-by-side: grid status panel + agent graph */}
          <div className={`h-full flex overflow-hidden ${activeTab === "graph" ? "" : "hidden"}`}>

            {/* Left: Green Window side panel (pre-execution only) */}
            {!executing && !executionDone && forecast && (
              <aside className="w-[300px] shrink-0 border-r border-[var(--border)] flex flex-col overflow-hidden" style={{ background: "var(--surface)" }}>
                {/* Panel header */}
                <div className="shrink-0 px-4 pt-3 pb-2.5 border-b border-[var(--border)]">
                  <p className="text-[9px] uppercase tracking-[0.2em] font-semibold" style={{ color: "var(--accent)" }}>Pre-flight</p>
                  <h3 className="text-[12px] font-semibold mt-0.5" style={{ color: "var(--text-primary)" }}>Grid Status</h3>
                </div>
                {/* Scheduler fills remaining panel space */}
                <div className="flex-1 p-3 min-h-0 overflow-y-auto">
                  <GreenWindowScheduler
                    forecast={forecast}
                    onRunNow={handleExecute}
                    onSchedule={(delayMs) => setScheduledAt(Date.now() + delayMs)}
                    countdown={countdownStr}
                    onCancelSchedule={() => { setScheduledAt(null); setCountdownStr(null); }}
                    disabled={executing}
                  />
                </div>
              </aside>
            )}

            {/* Right: Agent graph — fills remaining space */}
            <div className="flex-1 min-w-0 h-full overflow-hidden">
              <AgentWorkflow
                subtasks={result.subtasks}
                taskStates={taskStates}
                executing={executing}
                executionDone={executionDone}
                synthesizing={synthesizing}
                synthesisPartial={synthesisPartial}
                finalOutput={finalOutput}
                carbonSummary={carbonSummary}
                onCancel={handleCancel}
              />
            </div>
          </div>

          {/* Carbon tab */}
          <div className={`h-full overflow-auto ${activeTab === "carbon" ? "" : "hidden"}`}>
            {Object.keys(taskStates).length > 0 ? (
              <ExecutionTimeline
                subtasks={result.subtasks}
                taskStates={taskStates}
                executing={executing}
                carbonSummary={carbonSummary}
                carbonTimeSeries={carbonTimeSeries}
              />
            ) : (
              <div className="h-full flex items-center justify-center">
                <div className="text-center">
                  <LeafIcon className="w-8 h-8 text-[var(--text-tertiary)] mx-auto mb-3" />
                  <p className="text-[13px] text-[var(--text-tertiary)]">Run agents to see carbon impact</p>
                  <p className="text-[11px] text-[var(--text-tertiary)] mt-1 opacity-60">Switch to Agent Graph and click Execute</p>
                </div>
              </div>
            )}
          </div>

          {/* Output tab */}
          <div className={`h-full overflow-auto ${activeTab === "output" ? "" : "hidden"}`}>
            {synthesizing ? (
              <div className="max-w-3xl mx-auto px-8 py-10">
                <div className="flex items-center gap-2 mb-6" style={{ color: "var(--accent)" }}>
                  <span className="w-3.5 h-3.5 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: "var(--accent)", borderTopColor: "transparent" }} />
                  <span className="text-[12px] font-medium">Synthesizing outputs...</span>
                </div>
                {synthesisPartial && (
                  <div className="text-[13px] leading-[1.9] whitespace-pre-wrap" style={{ color: "var(--text-secondary)" }}>
                    {synthesisPartial}
                    <span className="inline-block w-[2px] h-[13px] ml-0.5 align-middle animate-pulse" style={{ background: "var(--accent)" }} />
                  </div>
                )}
              </div>
            ) : finalOutput ? (
              <div className="max-w-3xl mx-auto px-8 py-10">
                <div className="prose-output text-[13.5px] leading-[1.9]" style={{ color: "var(--text-primary)" }}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{finalOutput}</ReactMarkdown>
                </div>
              </div>
            ) : (
              <div className="h-full flex items-center justify-center">
                <div className="text-center">
                  <div className="w-10 h-10 rounded-xl border border-[var(--border)] flex items-center justify-center mx-auto mb-3 text-[var(--text-tertiary)]">
                    <BoltIcon />
                  </div>
                  <p className="text-[13px] text-[var(--text-tertiary)]">No output yet</p>
                  <p className="text-[11px] text-[var(--text-tertiary)] mt-1 opacity-60">Execute agents in the Graph tab to generate output</p>
                </div>
              </div>
            )}
          </div>

        </div>
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /* Input mode                                                        */
  /* ---------------------------------------------------------------- */

  return (
    <main className="min-h-screen">
      <Nav
        models={models}
        selectedModel={selectedModel}
        source={source}
        carbonIntensity={carbonIntensity}
        walletBalance={walletBalance}
        onModelChange={setSelectedModel}
      />

      <div className="max-w-2xl mx-auto px-6 py-12">
        {/* Hero */}
        {!loading && (
          <div className="mb-14 hero-glow animate-enter">
            <p className="text-[11px] uppercase tracking-[0.2em] text-[var(--accent)] mb-4 font-medium">
              Carbon-Aware Multi-Agent Orchestration
            </p>
            <h1 className="text-[40px] font-light tracking-tight text-[var(--text-primary)] leading-[1.1] mb-4">
              Break down any task.<br />
              <span className="text-[var(--text-tertiary)]">Execute with precision.</span>
            </h1>
            <p className="text-[14px] text-[var(--text-secondary)] max-w-sm leading-relaxed">
              Routes each subtask to the smallest capable model, runs them in parallel, and tracks the real CO₂ cost — proving that specialized small models are both faster and greener.
            </p>
            {carbonIntensity && (
              <div className="mt-6 flex items-center gap-2 text-[11px] text-emerald-600">
                <LeafIcon className="w-3.5 h-3.5" />
                <span>
                  Live grid: <strong className="font-semibold">{carbonIntensity.intensity} gCO₂/kWh</strong> in {carbonIntensity.zone}
                  {carbonIntensity.intensity < 100 && <span className="text-emerald-500 ml-1">(one of the world&apos;s cleanest grids)</span>}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Prompt bar */}
        <div className="mb-10">
          <form onSubmit={(e) => { e.preventDefault(); handleDecompose(); }}>
            <div className="relative group">
              <div className="absolute -inset-0.5 rounded-2xl bg-gradient-to-r from-[var(--accent)] via-[var(--accent-hover)] to-[var(--accent)] opacity-0 group-focus-within:opacity-[0.08] blur-sm transition-opacity duration-500" />
              <div className="relative bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-sm group-focus-within:shadow-lg group-focus-within:border-[var(--accent-border)] transition-all duration-300 overflow-hidden">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      handleDecompose();
                    }
                  }}
                  placeholder="What do you want to build?"
                  disabled={busy}
                  style={{ minHeight: "92px", maxHeight: "400px" }}
                  className="w-full bg-transparent px-5 pt-4 pb-14 text-[14px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none resize-none disabled:opacity-30 leading-relaxed overflow-y-auto"
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
                      {shortcutMod}+\u21B5
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

        {/* Error */}
        {error && (
          <div className="mb-8 px-4 py-3 rounded-lg border border-red-200 bg-red-50 animate-enter-scale">
            <p className="text-[12px] text-[var(--error)]">{error}</p>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="py-20 flex flex-col items-center animate-fade">
            <div className="relative mb-6">
              <div
                className="w-10 h-10 rounded-xl border border-[var(--accent-border)] bg-[var(--accent-subtle)] flex items-center justify-center text-[var(--accent)]"
                style={{ animation: "glow-breathe 2.5s ease-in-out infinite" }}
              >
                <BoltIcon />
              </div>
            </div>
            <div className="h-3 w-32 rounded-full shimmer-bg mb-3" />
            <p className="text-[11px] text-[var(--text-tertiary)]">{loadingMessage}</p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="max-w-2xl mx-auto px-6">
        <footer className="mt-24 pb-8">
          <div className="h-px bg-gradient-to-r from-transparent via-[var(--border)] to-transparent mb-6" />
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-[0.15em]">
              Built for HackEurope · Sustainability Track
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
