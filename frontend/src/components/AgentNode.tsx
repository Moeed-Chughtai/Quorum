import React, { memo } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { type Subtask } from '@/lib/api';
import { CategoryBadge } from './CategoryBadge';

export type AgentNodeData = Subtask & Record<string, unknown>;
export type AgentNodeProps = NodeProps<Node<AgentNodeData>>;

function AgentNode({ data }: AgentNodeProps) {
    return (
        <div className="w-[300px] rounded-xl border border-[#e8e5e0] bg-white p-4 shadow-sm transition-all hover:shadow-md hover:border-[#d4d0ca]">
            {/* Input Handle */}
            <Handle
                type="target"
                position={Position.Left}
                className="!bg-[#d97757] !border-white !w-2.5 !h-2.5"
            />

            {/* Header */}
            <div className="flex items-start justify-between gap-3 mb-2.5">
                <div className="flex items-center gap-2.5 overflow-hidden">
                    <div className="flex items-center justify-center w-5 h-5 rounded bg-[rgba(217,119,87,0.08)] border border-[rgba(217,119,87,0.15)] text-[#d97757] text-[10px] font-bold shrink-0 font-mono">
                        {String(data.id).padStart(2, '0')}
                    </div>
                    <h3 className="text-[12px] font-semibold text-[#1a1715] leading-tight truncate" title={data.title}>
                        {data.title}
                    </h3>
                </div>
                <div className="shrink-0">
                    <CategoryBadge category={data.category} />
                </div>
            </div>

            {/* Model Info */}
            <div className="flex items-center gap-2 mb-2.5 bg-[#f5f3f0] rounded-md px-2 py-1 border border-[#f0ede8]">
                <div className="w-1.5 h-1.5 rounded-full bg-[#16a34a]" />
                <span className="text-[10px] font-mono text-[#6b6560]">{data.assigned_model}</span>
            </div>

            {/* Description */}
            <p className="text-[11px] text-[#a8a29e] line-clamp-2 leading-relaxed border-t border-[#f0ede8] pt-2">
                {data.description}
            </p>

            {/* Output Handle */}
            <Handle
                type="source"
                position={Position.Right}
                className="!bg-[#d97757] !border-white !w-2.5 !h-2.5"
            />
        </div>
    );
}

export default memo(AgentNode);
