import React, { useMemo, useEffect } from 'react';
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

import { type Subtask, type SubtaskExecution } from '@/lib/api';
import AgentNode, { type AgentNodeData } from './AgentNode';

const getLayoutedElements = (nodes: Node[], edges: Edge[]) => {
    const dagreGraph = new dagre.graphlib.Graph();
    dagreGraph.setDefaultEdgeLabel(() => ({}));

    const nodeWidth = 460;
    const nodeHeight = 220;

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
    finalOutput: string | null;
    onExecute: () => void;
    onCancel: () => void;
}

export default function AgentWorkflow({
    subtasks,
    taskStates,
    executing,
    executionDone,
    synthesizing,
    finalOutput,
    onExecute,
    onCancel,
}: AgentWorkflowProps) {
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
            data: { ...task, execution: taskStates[task.id], model_totals: totalsByModel[task.assigned_model] ?? { input_tokens: 0, output_tokens: 0, total_cost: 0 } },
        }));

        const edges: Edge[] = [];
        subtasks.forEach((task) => {
            if (task.depends_on && task.depends_on.length > 0) {
                const uniqueDeps = Array.from(new Set(task.depends_on));
                uniqueDeps.forEach((depId) => {
                    const depDone = taskStates[depId]?.status === 'completed';
                    edges.push({
                        id: `e${depId}-${task.id}`,
                        source: depId.toString(),
                        target: task.id.toString(),
                        animated: !depDone,
                        style: {
                            stroke: depDone ? '#16a34a' : '#d97757',
                            strokeWidth: 2,
                            opacity: depDone ? 0.4 : 0.5,
                        },
                    });
                });
            }
        });

        return getLayoutedElements(nodes, edges);
    }, [subtasks, taskStates, totalsByModel]);

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

    return (
        <div className="relative w-full h-[70vh] min-h-[500px] max-h-[800px] border-y border-[var(--border)] bg-[var(--surface-raised)] overflow-hidden">
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
                            {running > 0 && (
                                <span className="text-[10px] text-[#d97757] tabular-nums flex items-center gap-1">
                                    <span className="relative flex h-1.5 w-1.5">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#d97757] opacity-75" />
                                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#d97757]" />
                                    </span>
                                    {running} running
                                </span>
                            )}
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
            <div className="absolute bottom-4 left-0 right-0 z-10 flex justify-center pointer-events-none">
                {!executing && !executionDone && (
                    <button
                        onClick={onExecute}
                        className="pointer-events-auto btn-glow px-6 py-3 rounded-xl text-[13px] font-medium bg-[#1a1715] text-white hover:bg-[#2e2a26] transition-all duration-300 flex items-center gap-2 shadow-lg"
                    >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z" />
                        </svg>
                        Execute all {total} agents
                    </button>
                )}

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
                    <div className="pointer-events-auto bg-white/95 backdrop-blur-sm rounded-xl border border-[#d97757]/20 shadow-lg px-6 py-4 max-w-sm">
                        <div className="flex items-center gap-2 text-[#d97757] mb-3">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z" />
                            </svg>
                            <span className="text-[11px] uppercase tracking-[0.15em] font-medium">Synthesizing final result</span>
                        </div>
                        <div className="space-y-1.5">
                            <div className="h-2.5 rounded-full shimmer-bg w-full" />
                            <div className="h-2.5 rounded-full shimmer-bg w-4/5" />
                            <div className="h-2.5 rounded-full shimmer-bg w-3/5" />
                        </div>
                    </div>
                )}
            </div>

            {/* ── Final output overlay ── */}
            {executionDone && finalOutput && (
                <div className="absolute inset-0 z-20 bg-[var(--surface-raised)]/80 backdrop-blur-sm flex items-center justify-center p-8 animate-fade">
                    <div className="bg-white rounded-2xl border border-[#d97757]/15 shadow-xl max-w-2xl w-full max-h-[80%] overflow-y-auto">
                        <div className="sticky top-0 bg-white border-b border-[#f0ede8] px-6 py-4 flex items-center justify-between rounded-t-2xl">
                            <div className="flex items-center gap-2 text-[#d97757]">
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z" />
                                </svg>
                                <span className="text-[12px] uppercase tracking-[0.12em] font-semibold">Final Result</span>
                            </div>
                            <span className="text-[10px] text-[#a8a29e] font-mono">{done}/{total} agents completed</span>
                        </div>
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
