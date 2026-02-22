import React, { useCallback, useMemo, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
    ReactFlow,
    Background,
    Controls,
    useNodesState,
    useEdgesState,
    type Node,
    type Edge,
} from '@xyflow/react';
// @ts-ignore
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';

import { type Subtask, type SubtaskExecution, type CarbonSummary } from '@/lib/api';
import AgentNode, { type AgentNodeData } from './AgentNode';
import { CategoryBadge } from './CategoryBadge';

const getLayoutedElements = (nodes: Node[], edges: Edge[]) => {
    const dagreGraph = new dagre.graphlib.Graph();
    dagreGraph.setDefaultEdgeLabel(() => ({}));

    const nodeWidth = 460;
    const nodeHeight = 260;

    dagreGraph.setGraph({ rankdir: 'LR', ranksep: 140, nodesep: 80 });

    nodes.forEach((node) => {
        dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
    });

    edges.forEach((edge) => {
        dagreGraph.setEdge(edge.source, edge.target);
    });

    dagre.layout(dagreGraph);

    const layoutedNodes = nodes.map((node) => {
        const nodeWithPosition = dagreGraph.node(node.id);
        return {
            ...node,
            position: {
                x: nodeWithPosition.x - nodeWidth / 2,
                y: nodeWithPosition.y - nodeHeight / 2,
            },
        };
    });

    return { nodes: layoutedNodes, edges };
};

interface AgentWorkflowProps {
    subtasks: Subtask[];
    taskStates: Record<number, SubtaskExecution>;
    executing: boolean;
    executionDone: boolean;
    synthesizing: boolean;
    synthesisPartial: string | null;
    finalOutput: string | null;
    carbonSummary: CarbonSummary | null;
    onCancel: () => void;
}

/** Live total elapsed timer */
function TotalTimer() {
    const start = useRef(Date.now());
    const [elapsed, setElapsed] = useState(0);

    useEffect(() => {
        const iv = setInterval(() => setElapsed(Date.now() - start.current), 100);
        return () => clearInterval(iv);
    }, []);

    const secs = (elapsed / 1000).toFixed(1);
    return <span className="text-[10px] text-[#6b6560] font-mono tabular-nums">{secs}s elapsed</span>;
}

function StatusPill({ status }: { status: string }) {
    const cfg: Record<string, { dot: string; label: string; cls: string }> = {
        running:   { dot: 'bg-[#d97757] animate-pulse', label: 'Running',   cls: 'text-[#d97757] bg-[#d97757]/8 border-[#d97757]/20' },
        completed: { dot: 'bg-[#16a34a]',               label: 'Completed', cls: 'text-[#16a34a] bg-[#16a34a]/8 border-[#16a34a]/20' },
        failed:    { dot: 'bg-red-500',                  label: 'Failed',    cls: 'text-red-500 bg-red-50 border-red-200' },
        pending:   { dot: 'bg-[#a8a29e]',               label: 'Pending',   cls: 'text-[#a8a29e] bg-[#f5f3f0] border-[#e8e5e0]' },
        idle:      { dot: 'bg-[#a8a29e]',               label: 'Queued',    cls: 'text-[#a8a29e] bg-[#f5f3f0] border-[#e8e5e0]' },
    };
    const { dot, label, cls } = cfg[status] ?? cfg.idle;
    return (
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-medium ${cls}`}>
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
            {label}
        </span>
    );
}

export default function AgentWorkflow({
    subtasks,
    taskStates,
    executing,
    executionDone,
    synthesizing,
    synthesisPartial,
    finalOutput,
    carbonSummary,
    onCancel,
}: AgentWorkflowProps) {
    const [showFinalOutput, setShowFinalOutput] = useState(false);
    const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);

    // Auto-show final output when it arrives
    useEffect(() => {
        if (executionDone && finalOutput) setShowFinalOutput(true);
    }, [executionDone, finalOutput]);

    // Keyboard: Escape closes panels, ←/→ navigate agents
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (showFinalOutput) { setShowFinalOutput(false); return; }
                if (selectedTaskId !== null) { setSelectedTaskId(null); return; }
            }
            if (selectedTaskId !== null) {
                const idx = subtasks.findIndex(t => t.id === selectedTaskId);
                if (e.key === 'ArrowLeft' && idx > 0) setSelectedTaskId(subtasks[idx - 1].id);
                if (e.key === 'ArrowRight' && idx < subtasks.length - 1) setSelectedTaskId(subtasks[idx + 1].id);
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [selectedTaskId, showFinalOutput, subtasks]);

    const handleExpand = useCallback((id: number) => setSelectedTaskId(id), []);

    const nodeTypes = useMemo(() => ({
        agent: AgentNode,
    }), []);

    const totalsByModel = useMemo(() => {
        const totals: Record<string, { input_tokens: number; output_tokens: number; total_cost: number }> = {};
        for (const st of subtasks) {
            const exec = taskStates[st.id];
            const model = st.assigned_model;
            if (!totals[model]) totals[model] = { input_tokens: 0, output_tokens: 0, total_cost: 0 };
            totals[model].input_tokens += exec?.input_tokens ?? 0;
            totals[model].output_tokens += exec?.output_tokens ?? 0;
            totals[model].total_cost += exec?.total_cost ?? 0;
        }
        return totals;
    }, [subtasks, taskStates]);

    const { nodes: layoutedNodes, edges: layoutedEdges } = useMemo(() => {
        const nodes: Node<AgentNodeData>[] = subtasks.map((task) => ({
            id: task.id.toString(),
            type: 'agent',
            position: { x: 0, y: 0 },
            data: { ...task, execution: taskStates[task.id], model_totals: totalsByModel[task.assigned_model] ?? { input_tokens: 0, output_tokens: 0, total_cost: 0 }, onExpand: handleExpand },
        }));

        const edges: Edge[] = [];
        subtasks.forEach((task) => {
            if (task.depends_on && task.depends_on.length > 0) {
                const uniqueDeps = Array.from(new Set(task.depends_on));
                uniqueDeps.forEach((depId) => {
                    const depDone = taskStates[depId]?.status === 'completed';
                    const targetRunning = taskStates[task.id]?.status === 'running';
                    edges.push({
                        id: `e${depId}-${task.id}`,
                        source: depId.toString(),
                        target: task.id.toString(),
                        animated: targetRunning || (!depDone),
                        label: depDone ? 'output passed' : undefined,
                        labelStyle: { fontSize: 9, fill: '#16a34a', fontWeight: 500 },
                        labelBgStyle: { fill: '#f5f3f0', fillOpacity: 0.9 },
                        labelBgPadding: [6, 3] as [number, number],
                        labelBgBorderRadius: 4,
                        style: {
                            stroke: depDone ? '#16a34a' : targetRunning ? '#d97757' : '#d4d0ca',
                            strokeWidth: depDone ? 2 : 1.5,
                            opacity: depDone ? 0.6 : 0.5,
                        },
                    });
                });
            }
        });

        return getLayoutedElements(nodes, edges);
    }, [subtasks, taskStates, totalsByModel, handleExpand]);

    const [nodes, setNodes, onNodesChange] = useNodesState(layoutedNodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState(layoutedEdges);

    useEffect(() => {
        setNodes(layoutedNodes);
        setEdges(layoutedEdges);
    }, [layoutedNodes, layoutedEdges, setNodes, setEdges]);

    // Progress stats
    const total = subtasks.length;
    const done = Object.values(taskStates).filter(t => t.status === 'completed').length;
    const running = Object.values(taskStates).filter(t => t.status === 'running').length;
    const failed = Object.values(taskStates).filter(t => t.status === 'failed').length;
    const pct = total > 0 ? ((done + failed) / total) * 100 : 0;
    const hasExecution = Object.keys(taskStates).length > 0;

    // Selected task detail
    const selectedIdx = subtasks.findIndex(t => t.id === selectedTaskId);
    const selectedTask = selectedIdx >= 0 ? subtasks[selectedIdx] : null;
    const selectedExec = selectedTaskId !== null ? taskStates[selectedTaskId] : null;

    return (
        <div className="relative w-full h-full bg-[var(--surface-raised)] overflow-hidden">
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                nodeTypes={nodeTypes}
                fitView
                fitViewOptions={{ padding: 0.3 }}
                className="bg-[var(--surface-raised)]"
                minZoom={0.3}
                maxZoom={2}
                defaultEdgeOptions={{ type: 'smoothstep', animated: true }}
                proOptions={{ hideAttribution: true }}
            >
                <Background color="#e8e5e0" gap={24} size={1} />
                <Controls
                    className="!bg-white !border-[#e8e5e0] !rounded-lg !shadow-sm [&>button]:!border-[#e8e5e0] [&>button]:!bg-white [&>button:hover]:!bg-[#f5f3f0] [&>button>svg]:!fill-[#6b6560]"
                />
            </ReactFlow>

            {/* ── Top-left: progress bar overlay ── */}
            {hasExecution && (executing || executionDone) && (
                <div className="absolute top-4 left-4 right-4 z-10 pointer-events-none">
                    <div className="bg-white/90 backdrop-blur-sm rounded-lg border border-[#e8e5e0] shadow-sm px-4 py-2.5 pointer-events-auto max-w-sm">
                        <div className="flex items-center justify-between mb-1.5">
                            <div className="flex items-center gap-2">
                                <span className="text-[18px] font-extralight tabular-nums text-[#1a1715]">{done}</span>
                                <span className="text-[10px] text-[#a8a29e] uppercase tracking-wider">/ {total} complete</span>
                                {failed > 0 && <span className="text-[10px] text-red-500 tabular-nums">{failed} failed</span>}
                            </div>
                            <div className="flex items-center gap-3">
                                {running > 0 && (
                                    <span className="text-[10px] text-[#d97757] tabular-nums flex items-center gap-1">
                                        <span className="relative flex h-1.5 w-1.5">
                                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#d97757] opacity-75" />
                                            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#d97757]" />
                                        </span>
                                        {running} running
                                    </span>
                                )}
                                {executing && <TotalTimer />}
                            </div>
                        </div>
                        <div className="h-[2px] bg-[#e8e5e0] rounded-full overflow-hidden">
                            <div
                                className="h-full bg-gradient-to-r from-[#d97757] to-[#c4633f] rounded-full transition-all duration-700 ease-out"
                                style={{ width: `${pct}%` }}
                            />
                        </div>
                    </div>
                </div>
            )}

            {/* ── Bottom-center: action buttons ── */}
            <div className="absolute bottom-4 left-0 right-0 z-10 flex justify-center gap-3 pointer-events-none">
                {executing && !synthesizing && (
                    <button
                        onClick={onCancel}
                        className="pointer-events-auto px-5 py-2.5 rounded-xl text-[12px] font-medium bg-white/90 backdrop-blur-sm text-[#a8a29e] border border-[#e8e5e0] hover:text-red-500 hover:border-red-200 transition-all duration-300 flex items-center gap-2 shadow-sm"
                    >
                        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                            <rect x="6" y="6" width="12" height="12" rx="1" />
                        </svg>
                        Cancel execution
                    </button>
                )}

                {synthesizing && (
                    <div className="pointer-events-auto bg-white/95 backdrop-blur-sm rounded-xl border border-[#d97757]/20 shadow-lg px-6 py-4 max-w-md w-full">
                        <div className="flex items-center gap-2 text-[#d97757] mb-3">
                            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z" />
                            </svg>
                            <span className="text-[11px] uppercase tracking-[0.15em] font-medium">Synthesizing final result</span>
                        </div>
                        {synthesisPartial ? (
                            <p className="text-[11px] text-[#6b6560] leading-relaxed max-h-[120px] overflow-y-auto font-mono whitespace-pre-wrap">
                                {synthesisPartial}
                                <span className="inline-block w-[2px] h-[11px] bg-[#d97757] ml-0.5 align-middle animate-pulse" />
                            </p>
                        ) : (
                            <div className="space-y-1.5">
                                <div className="h-2.5 rounded-full shimmer-bg w-full" />
                                <div className="h-2.5 rounded-full shimmer-bg w-4/5" />
                                <div className="h-2.5 rounded-full shimmer-bg w-3/5" />
                            </div>
                        )}
                    </div>
                )}

                {executionDone && finalOutput && !showFinalOutput && !synthesizing && (
                    <button
                        onClick={() => setShowFinalOutput(true)}
                        className="pointer-events-auto px-5 py-2.5 rounded-xl text-[12px] font-medium bg-white/90 backdrop-blur-sm text-[#d97757] border border-[#d97757]/20 hover:border-[#d97757]/40 transition-all duration-300 flex items-center gap-2 shadow-sm"
                    >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
                        </svg>
                        View final result
                    </button>
                )}
            </div>

            {/* ── Agent detail panel (right-side drawer) ── */}
            {selectedTask && (
                <div
                    className="absolute inset-0 z-30 flex items-stretch justify-end animate-fade"
                    onClick={(e) => { if (e.target === e.currentTarget) setSelectedTaskId(null); }}
                >
                    {/* Backdrop */}
                    <div className="absolute inset-0 bg-black/10 backdrop-blur-[1.5px]" onClick={() => setSelectedTaskId(null)} />

                    {/* Panel */}
                    <div className="relative z-10 w-[500px] max-w-[90%] bg-white border-l border-[#e8e5e0] shadow-2xl flex flex-col h-full">

                        {/* ── Panel header ── */}
                        <div className="px-5 py-4 border-b border-[#f0ede8] shrink-0">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                                        <span className="text-[10px] font-mono text-[#a8a29e]">
                                            #{String(selectedTask.id).padStart(2, '0')}
                                        </span>
                                        <CategoryBadge category={selectedTask.category} />
                                        <StatusPill status={selectedExec?.status ?? 'idle'} />
                                    </div>
                                    <h2 className="text-[15px] font-semibold text-[#1a1715] leading-snug">
                                        {selectedTask.title}
                                    </h2>
                                </div>
                                <button
                                    onClick={() => setSelectedTaskId(null)}
                                    className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-[#a8a29e] hover:text-[#1a1715] hover:bg-[#f5f3f0] transition-colors"
                                >
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>

                            {/* Model + stats row */}
                            <div className="flex items-center gap-2 mt-3 flex-wrap">
                                <div className="flex items-center gap-1.5 bg-[#f5f3f0] border border-[#f0ede8] rounded-md px-2.5 py-1.5">
                                    <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                        selectedExec?.status === 'running' ? 'bg-[#d97757] animate-pulse' :
                                        selectedExec?.status === 'completed' ? 'bg-[#16a34a]' :
                                        selectedExec?.status === 'failed' ? 'bg-red-500' :
                                        'bg-[#a8a29e]'
                                    }`} />
                                    <span className="text-[11px] font-mono text-[#6b6560]">{selectedTask.assigned_model}</span>
                                </div>
                                {selectedExec?.status === 'completed' && (
                                    <>
                                        {selectedExec.duration != null && (
                                            <span className="text-[11px] font-mono text-[#16a34a] bg-[#16a34a]/6 border border-[#16a34a]/15 rounded-md px-2 py-1">
                                                {selectedExec.duration}s
                                            </span>
                                        )}
                                        {selectedExec.gco2 != null && (
                                            <span className="text-[11px] font-mono text-emerald-600 bg-emerald-50 border border-emerald-100 rounded-md px-2 py-1">
                                                {selectedExec.gco2.toFixed(5)} gCO₂
                                            </span>
                                        )}
                                        {selectedExec.tokens != null && (
                                            <span className="text-[11px] font-mono text-[#a8a29e] bg-[#f5f3f0] border border-[#f0ede8] rounded-md px-2 py-1">
                                                {selectedExec.tokens.toLocaleString()} tok
                                            </span>
                                        )}
                                    </>
                                )}
                            </div>
                        </div>

                        {/* ── Scrollable body ── */}
                        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-5">

                            {/* Description */}
                            <section>
                                <h3 className="text-[10px] uppercase tracking-[0.12em] text-[#a8a29e] font-semibold mb-2">Description</h3>
                                <p className="text-[13px] text-[#4a4540] leading-relaxed">{selectedTask.description}</p>
                            </section>

                            {/* Routing reason */}
                            {selectedTask.routing_reason && (
                                <section>
                                    <h3 className="text-[10px] uppercase tracking-[0.12em] text-[#a8a29e] font-semibold mb-2">Why this model</h3>
                                    <div className="flex items-start gap-2 bg-[#faf9f7] border border-[#f0ede8] rounded-lg px-3 py-2.5">
                                        <svg className="w-3.5 h-3.5 text-[#a8a29e] mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
                                        </svg>
                                        <p className="text-[12px] text-[#6b6560] leading-relaxed italic">{selectedTask.routing_reason}</p>
                                    </div>
                                </section>
                            )}

                            {/* Dependencies */}
                            {selectedTask.depends_on.length > 0 && (
                                <section>
                                    <h3 className="text-[10px] uppercase tracking-[0.12em] text-[#a8a29e] font-semibold mb-2">
                                        Depends on
                                    </h3>
                                    <div className="flex flex-wrap gap-2">
                                        {selectedTask.depends_on.map(depId => {
                                            const dep = subtasks.find(t => t.id === depId);
                                            const depStatus = taskStates[depId]?.status ?? 'idle';
                                            return (
                                                <button
                                                    key={depId}
                                                    onClick={() => setSelectedTaskId(depId)}
                                                    className="flex items-center gap-2 bg-[#f5f3f0] border border-[#e8e5e0] hover:border-[#d97757]/30 hover:bg-[#d97757]/5 rounded-lg px-3 py-2 transition-colors text-left"
                                                >
                                                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                                        depStatus === 'completed' ? 'bg-[#16a34a]' :
                                                        depStatus === 'running' ? 'bg-[#d97757] animate-pulse' :
                                                        depStatus === 'failed' ? 'bg-red-500' :
                                                        'bg-[#a8a29e]'
                                                    }`} />
                                                    <span className="text-[11px] font-mono text-[#a8a29e]">#{String(depId).padStart(2, '0')}</span>
                                                    <span className="text-[12px] text-[#6b6560]">{dep?.title ?? 'Unknown'}</span>
                                                    <svg className="w-3 h-3 text-[#d4d0ca] ml-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                                                    </svg>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </section>
                            )}

                            {/* Running: live stream */}
                            {selectedExec?.status === 'running' && (
                                <section>
                                    <h3 className="text-[10px] uppercase tracking-[0.12em] text-[#d97757] font-semibold mb-2">Live output</h3>
                                    {selectedExec.partialOutput ? (
                                        <div className="bg-[#fdf9f7] border border-[#d97757]/15 rounded-lg p-3">
                                            <p className="text-[12px] text-[#4a4540] font-mono leading-relaxed whitespace-pre-wrap">
                                                {selectedExec.partialOutput}
                                                <span className="inline-block w-[2px] h-[13px] bg-[#d97757] ml-0.5 align-middle animate-pulse" />
                                            </p>
                                        </div>
                                    ) : (
                                        <div className="space-y-2">
                                            <div className="h-3 rounded-full shimmer-bg w-full" />
                                            <div className="h-3 rounded-full shimmer-bg w-4/5" />
                                            <div className="h-3 rounded-full shimmer-bg w-3/5" />
                                        </div>
                                    )}
                                </section>
                            )}

                            {/* Failed error */}
                            {selectedExec?.status === 'failed' && selectedExec.error && (
                                <section>
                                    <h3 className="text-[10px] uppercase tracking-[0.12em] text-red-500 font-semibold mb-2">Error</h3>
                                    <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                                        <p className="text-[12px] text-red-600 font-mono leading-relaxed">{selectedExec.error}</p>
                                    </div>
                                </section>
                            )}

                            {/* Completed output */}
                            {selectedExec?.status === 'completed' && selectedExec.output && (
                                <section>
                                    <h3 className="text-[10px] uppercase tracking-[0.12em] text-[#16a34a] font-semibold mb-2">Output</h3>
                                    <div className="bg-[#fafaf9] border border-[#f0ede8] rounded-lg p-4">
                                        <div className="prose-agent text-[12px]">
                                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{selectedExec.output}</ReactMarkdown>
                                        </div>
                                    </div>
                                </section>
                            )}

                            {/* Idle / pending placeholder */}
                            {(!selectedExec || selectedExec.status === 'pending') && (
                                <section>
                                    <div className="flex items-center gap-2 text-[#a8a29e] py-4">
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                                        </svg>
                                        <span className="text-[12px]">Waiting to run...</span>
                                    </div>
                                </section>
                            )}
                        </div>

                        {/* ── Panel footer: prev / next navigation ── */}
                        <div className="px-5 py-3 border-t border-[#f0ede8] flex items-center justify-between shrink-0 bg-[#faf9f7]">
                            <button
                                onClick={() => selectedIdx > 0 && setSelectedTaskId(subtasks[selectedIdx - 1].id)}
                                disabled={selectedIdx === 0}
                                className="flex items-center gap-1.5 text-[11px] text-[#6b6560] hover:text-[#1a1715] disabled:opacity-30 disabled:cursor-not-allowed transition-colors px-2 py-1 rounded-md hover:bg-[#f0ede8]"
                            >
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                                </svg>
                                Prev
                            </button>
                            <span className="text-[10px] font-mono text-[#a8a29e]">
                                {selectedIdx + 1} / {subtasks.length}
                                <span className="ml-2 text-[#d4d0ca]">← → to navigate</span>
                            </span>
                            <button
                                onClick={() => selectedIdx < subtasks.length - 1 && setSelectedTaskId(subtasks[selectedIdx + 1].id)}
                                disabled={selectedIdx === subtasks.length - 1}
                                className="flex items-center gap-1.5 text-[11px] text-[#6b6560] hover:text-[#1a1715] disabled:opacity-30 disabled:cursor-not-allowed transition-colors px-2 py-1 rounded-md hover:bg-[#f0ede8]"
                            >
                                Next
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Final output overlay (dismissible) ── */}
            {showFinalOutput && finalOutput && (
                <div className="absolute inset-0 z-20 bg-[var(--surface-raised)]/80 backdrop-blur-sm flex items-center justify-center p-8 animate-fade">
                    <div className="bg-white rounded-2xl border border-[#d97757]/15 shadow-xl max-w-2xl w-full max-h-[80%] overflow-y-auto">
                        <div className="sticky top-0 bg-white border-b border-[#f0ede8] px-6 py-4 flex items-center justify-between rounded-t-2xl z-10">
                            <div className="flex items-center gap-2 text-[#d97757]">
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z" />
                                </svg>
                                <span className="text-[12px] uppercase tracking-[0.12em] font-semibold">Final Result</span>
                            </div>
                            <div className="flex items-center gap-3">
                                <span className="text-[10px] text-[#a8a29e] font-mono">{done}/{total} agents completed</span>
                                <button
                                    onClick={() => setShowFinalOutput(false)}
                                    className="w-6 h-6 rounded-md flex items-center justify-center text-[#a8a29e] hover:text-[#1a1715] hover:bg-[#f5f3f0] transition-colors"
                                >
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>
                        </div>
                        {carbonSummary && (
                            <div className="px-6 pt-5 pb-4 border-b border-[#f0ede8] bg-gradient-to-br from-emerald-50/60 to-white">
                                <div className="flex items-center gap-1.5 mb-3">
                                    <svg className="w-3.5 h-3.5 text-emerald-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" />
                                    </svg>
                                    <span className="text-[10px] uppercase tracking-[0.15em] font-semibold text-emerald-700">Carbon Impact</span>
                                    <span className="text-[9px] text-emerald-500 font-mono ml-1 bg-emerald-100 px-1.5 py-0.5 rounded-full">{carbonSummary.zone} · {carbonSummary.carbon_intensity} gCO₂/kWh</span>
                                </div>
                                <div className="grid grid-cols-2 gap-3 mb-3">
                                    <div className="bg-white rounded-xl border border-emerald-100 px-4 py-3 shadow-sm">
                                        <div className="text-[9px] uppercase tracking-wider text-emerald-600 font-semibold mb-1">CO₂ Saved · Agent Routing</div>
                                        <div className="text-[26px] font-light text-emerald-600 tabular-nums leading-none">{carbonSummary.savings_pct.toFixed(1)}<span className="text-[14px] ml-0.5">%</span></div>
                                        <div className="text-[9px] text-[#a8a29e] font-mono mt-1">
                                            {carbonSummary.agent_gco2.toFixed(5)} vs {carbonSummary.baseline_gco2.toFixed(5)} gCO₂
                                        </div>
                                    </div>
                                    <div className="bg-white rounded-xl border border-[#d97757]/15 px-4 py-3 shadow-sm">
                                        <div className="text-[9px] uppercase tracking-wider text-[#d97757] font-semibold mb-1">Time Saved · Parallelism</div>
                                        <div className="text-[26px] font-light text-[#d97757] tabular-nums leading-none">{carbonSummary.time_savings_pct.toFixed(1)}<span className="text-[14px] ml-0.5">%</span></div>
                                        <div className="text-[9px] text-[#a8a29e] font-mono mt-1">
                                            {carbonSummary.pipeline_time_s}s vs {carbonSummary.sequential_time_s}s sequential
                                        </div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 text-[9px] font-mono text-[#a8a29e]">
                                    <span>{carbonSummary.total_tokens.toLocaleString()} tokens total</span>
                                    <span className="text-[#e8e5e0]">·</span>
                                    <span className="text-emerald-600 font-medium">{carbonSummary.agent_gco2.toFixed(5)} gCO₂ routed agents</span>
                                    <span className="text-[#e8e5e0]">·</span>
                                    <span>orchestrator baseline: {carbonSummary.baseline_gco2.toFixed(5)} gCO₂</span>
                                </div>
                            </div>
                        )}
                        <div className="p-6">
                            <div className="prose-agent">
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>{finalOutput}</ReactMarkdown>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
