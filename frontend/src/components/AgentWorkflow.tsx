import React, { useMemo, useEffect } from 'react';
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

import { type Subtask } from '@/lib/api';
import AgentNode, { type AgentNodeData } from './AgentNode';

const getLayoutedElements = (nodes: Node[], edges: Edge[]) => {
    const dagreGraph = new dagre.graphlib.Graph();
    dagreGraph.setDefaultEdgeLabel(() => ({}));

    const nodeWidth = 340;
    const nodeHeight = 160;

    dagreGraph.setGraph({ rankdir: 'LR', ranksep: 80, nodesep: 40 });

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
}

export default function AgentWorkflow({ subtasks }: AgentWorkflowProps) {
    const nodeTypes = useMemo(() => ({
        agent: AgentNode,
    }), []);

    const { nodes: initialNodes, edges: initialEdges } = useMemo(() => {
        const nodes: Node<AgentNodeData>[] = subtasks.map((task) => ({
            id: task.id.toString(),
            type: 'agent',
            position: { x: 0, y: 0 },
            data: { ...task },
        }));

        const edges: Edge[] = [];
        subtasks.forEach((task) => {
            if (task.depends_on && task.depends_on.length > 0) {
                const uniqueDeps = Array.from(new Set(task.depends_on));
                uniqueDeps.forEach((depId) => {
                    edges.push({
                        id: `e${depId}-${task.id}`,
                        source: depId.toString(),
                        target: task.id.toString(),
                        animated: true,
                        style: { stroke: '#d97757', strokeWidth: 1.5, opacity: 0.6 },
                    });
                });
            }
        });

        return getLayoutedElements(nodes, edges);
    }, [subtasks]);

    const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

    useEffect(() => {
        setNodes(initialNodes);
        setEdges(initialEdges);
    }, [initialNodes, initialEdges, setNodes, setEdges]);

    return (
        <div className="w-full h-[500px] border border-[var(--border)] rounded-xl bg-[var(--surface-raised)] overflow-hidden shadow-sm">
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                nodeTypes={nodeTypes}
                fitView
                fitViewOptions={{ padding: 0.2 }}
                className="bg-[var(--surface-raised)]"
                minZoom={0.4}
                maxZoom={1.5}
                defaultEdgeOptions={{ type: 'smoothstep', animated: true }}
                proOptions={{ hideAttribution: true }}
            >
                <Background color="#e8e5e0" gap={24} size={1} />
                <Controls
                    className="!bg-white !border-[#e8e5e0] !rounded-lg !shadow-sm [&>button]:!border-[#e8e5e0] [&>button]:!bg-white [&>button:hover]:!bg-[#f5f3f0] [&>button>svg]:!fill-[#6b6560]"
                />
            </ReactFlow>
        </div>
    );
}
