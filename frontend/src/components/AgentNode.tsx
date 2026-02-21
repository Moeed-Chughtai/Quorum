import React, { memo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { type Subtask, type SubtaskExecution } from '@/lib/api';
import { CategoryBadge } from './CategoryBadge';

export type AgentNodeData = Subtask & {
    execution?: SubtaskExecution;
    model_totals?: { input_tokens: number; output_tokens: number; total_cost: number };
} & Record<string, unknown>;

export type AgentNodeProps = NodeProps<Node<AgentNodeData>>;

function AgentNode({ data }: AgentNodeProps) {
    const [showOutput, setShowOutput] = useState(false);
    const exec = data.execution;
    const status = exec?.status ?? 'idle';
    const totals = data.model_totals;

    const isRunning = status === 'running';
    const isCompleted = status === 'completed';
    const isFailed = status === 'failed';

    return (
        <div
            className={`rounded-xl border bg-white shadow-sm transition-all select-none ${
                isRunning
                    ? 'w-[420px] border-[#d97757]/40 shadow-lg ring-1 ring-[#d97757]/10'
                    : isCompleted
                        ? 'w-[420px] border-[#16a34a]/25 shadow-md cursor-pointer'
                        : isFailed
                            ? 'w-[420px] border-red-300 shadow-md'
                            : 'w-[420px] border-[#e8e5e0] hover:shadow-md hover:border-[#d4d0ca] cursor-pointer'
            }`}
            onClick={() => {
                if (isCompleted && exec?.output) setShowOutput(!showOutput);
            }}
        >
            <Handle
                type="target"
                position={Position.Left}
                className="!bg-[#d97757] !border-white !w-3 !h-3"
            />

            {/* Status bar at top */}
            {(isRunning || isCompleted || isFailed) && (
                <div className={`h-[3px] rounded-t-xl ${
                    isRunning ? 'bg-[#d97757] shimmer-bar' :
                    isCompleted ? 'bg-[#16a34a]' :
                    'bg-red-500'
                }`} />
            )}

            {/* Header */}
            <div className="flex items-start justify-between gap-3 p-4 pb-0">
                <div className="flex items-center gap-3 overflow-hidden">
                    <div className={`flex items-center justify-center w-7 h-7 rounded-lg text-[12px] font-bold shrink-0 font-mono ${
                        isRunning
                            ? 'bg-[#d97757]/10 border border-[#d97757]/20 text-[#d97757]'
                            : isCompleted
                                ? 'bg-[#16a34a]/10 border border-[#16a34a]/20 text-[#16a34a]'
                                : isFailed
                                    ? 'bg-red-50 border border-red-200 text-red-500'
                                    : 'bg-[rgba(217,119,87,0.08)] border border-[rgba(217,119,87,0.15)] text-[#d97757]'
                    }`}>
                        {isCompleted ? (
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                            </svg>
                        ) : isFailed ? (
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                            </svg>
                        ) : (
                            String(data.id).padStart(2, '0')
                        )}
                    </div>
                    <div className="min-w-0">
                        <h3 className={`text-[14px] font-semibold leading-snug truncate ${
                            isRunning ? 'text-[#d97757]' : 'text-[#1a1715]'
                        }`}>
                            {data.title}
                        </h3>
                        {isRunning && (
                            <span className="text-[10px] text-[#d97757] font-medium">Processing...</span>
                        )}
                        {isCompleted && exec?.duration != null && (
                            <span className="text-[10px] text-[#16a34a] font-mono">{exec.duration}s</span>
                        )}
                    </div>
                </div>
                <div className="shrink-0 mt-0.5">
                    <CategoryBadge category={data.category} />
                </div>
            </div>

            {/* Model + deps */}
            <div className="flex items-center gap-2.5 px-4 pt-2.5 pb-2.5">
                <div className="flex items-center gap-2 bg-[#f5f3f0] rounded-md px-2.5 py-1.5 border border-[#f0ede8]">
                    <div className={`w-1.5 h-1.5 rounded-full ${
                        isRunning ? 'bg-[#d97757] animate-pulse' :
                        isCompleted ? 'bg-[#16a34a]' :
                        isFailed ? 'bg-red-500' :
                        'bg-[#a8a29e]'
                    }`} />
                    <span className="text-[11px] font-mono text-[#6b6560]">{data.assigned_model}</span>
                </div>
                {totals && (
                    <span className="text-[11px] font-mono text-[#a8a29e]">
                        in {totals.input_tokens.toLocaleString()} · out {totals.output_tokens.toLocaleString()} · $
                        {(totals.total_cost >= 0.01 ? totals.total_cost.toFixed(2) : totals.total_cost.toFixed(4))}
                    </span>
                )}
                {data.depends_on.length > 0 && (
                    <span className="text-[11px] font-mono text-[#a8a29e]">
                        needs {data.depends_on.map(d => `#${String(d).padStart(2, '0')}`).join(', ')}
                    </span>
                )}
            </div>

            {/* Description */}
            <div className="px-4 pb-3 border-t border-[#f0ede8] pt-2.5">
                <p className="text-[12px] text-[#6b6560] leading-relaxed line-clamp-2">
                    {data.description}
                </p>
            </div>

            {/* Running shimmer */}
            {isRunning && (
                <div className="px-4 pb-3 space-y-1.5">
                    <div className="h-2 rounded-full shimmer-bg w-full" />
                    <div className="h-2 rounded-full shimmer-bg w-3/5" />
                </div>
            )}

            {/* Failed error */}
            {isFailed && exec?.error && (
                <div className="px-4 pb-3 border-t border-red-100 pt-2.5">
                    <p className="text-[11px] text-red-500 font-mono leading-relaxed">{exec.error}</p>
                </div>
            )}

            {/* Completed output */}
            {isCompleted && exec?.output && (
                <div className="px-4 pb-3">
                    {!showOutput ? (
                        <span className="text-[10px] text-[#16a34a]/70 hover:text-[#16a34a]">
                            Click to view output
                        </span>
                    ) : (
                        <div className="border-t border-[#f0ede8] pt-2.5 mt-1 max-h-[300px] overflow-y-auto">
                            <div className="prose-agent text-[11px]">
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>{exec.output}</ReactMarkdown>
                            </div>
                        </div>
                    )}
                </div>
            )}

            <Handle
                type="source"
                position={Position.Right}
                className="!bg-[#d97757] !border-white !w-3 !h-3"
            />
        </div>
    );
}

export default memo(AgentNode);
