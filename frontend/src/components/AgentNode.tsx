import React, { memo } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { type Subtask } from '@/lib/api';
import { CategoryBadge } from './CategoryBadge';

// Define the custom node data type by extending Subtask
// We need to ensure it matches what React Flow expects (Record<string, unknown>)
export type AgentNodeData = Subtask & Record<string, unknown>;

// Fix the props type to use AgentNodeData directly
export type AgentNodeProps = NodeProps<Node<AgentNodeData>>;

function AgentNode({ data }: AgentNodeProps) {
    return (
        <div className="w-[320px] rounded-xl border border-zinc-800 bg-zinc-900/95 p-4 shadow-2xl backdrop-blur-sm transition-all hover:border-zinc-700 hover:shadow-blue-500/5">
            {/* Input Handle */}
            <Handle
                type="target"
                position={Position.Left}
                className="!bg-zinc-600 !border-zinc-900 !w-3 !h-3 transition-colors hover:!bg-blue-500"
            />

            {/* Header */}
            <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex items-center gap-3 overflow-hidden">
                    <div className="flex items-center justify-center w-6 h-6 rounded-md bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-bold shrink-0">
                        {data.id}
                    </div>
                    <h3 className="text-sm font-semibold text-zinc-100 leading-tight truncate" title={data.title}>
                        {data.title}
                    </h3>
                </div>
                <div className="shrink-0">
                    <CategoryBadge category={data.category} />
                </div>
            </div>

            {/* Model Info */}
            <div className="flex items-center gap-2 mb-3 bg-zinc-950/50 rounded px-2 py-1 border border-zinc-800/50">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]" />
                <span className="text-xs font-mono text-zinc-300">{data.assigned_model}</span>
            </div>

            {/* Description */}
            <p className="text-xs text-zinc-400 line-clamp-3 leading-relaxed border-t border-zinc-800/50 pt-2">
                {data.description}
            </p>

            {/* Footer Info (Reasoning) */}
            {data.routing_reason && (
                <p className="mt-2 text-[10px] text-zinc-600 italic truncate" title={data.routing_reason}>
                    {data.routing_reason}
                </p>
            )}

            {/* Output Handle */}
            <Handle
                type="source"
                position={Position.Right}
                className="!bg-zinc-600 !border-zinc-900 !w-3 !h-3 transition-colors hover:!bg-blue-500"
            />
        </div>
    );
}

export default memo(AgentNode);
