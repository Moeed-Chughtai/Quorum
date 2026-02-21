import React, { useMemo, useEffect } from 'react';
import {
    ReactFlow,
    Background,
    Controls,
    MiniMap,
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

    const nodeWidth = 360; // 320px width + 40px gap
    const nodeHeight = 200; // Approx height

    dagreGraph.setGraph({ rankdir: 'LR' }); // Left to Right layout

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
    // Memoize nodeTypes inside component to prevent re-creation issues
    const nodeTypes = useMemo(() => ({
        agent: AgentNode,
    }), []);

    // Transform subtasks to nodes and edges
    const { nodes: initialNodes, edges: initialEdges } = useMemo(() => {
        const nodes: Node<AgentNodeData>[] = subtasks.map((task) => ({
            id: task.id.toString(),
            type: 'agent',
            position: { x: 0, y: 0 }, // Position will be calculated by dagre
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
                        style: { stroke: '#3b82f6', strokeWidth: 2 },
                    });
                });
            }
        });

        return getLayoutedElements(nodes, edges);
    }, [subtasks]);

    // Use React Flow hooks for state management
    const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

    // Update graph when subtasks change
    useEffect(() => {
        setNodes(initialNodes);
        setEdges(initialEdges);
    }, [initialNodes, initialEdges, setNodes, setEdges]);

    return (
        <div className="w-full h-[600px] border border-zinc-800 rounded-xl bg-zinc-950/50 overflow-hidden shadow-inner">
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                nodeTypes={nodeTypes}
                fitView
                className="bg-zinc-950"
                minZoom={0.5}
                maxZoom={1.5}
                defaultEdgeOptions={{ type: 'smoothstep', animated: true }}
                proOptions={{ hideAttribution: true }}
            >
                <Background color="#27272a" gap={20} size={1} />
                <Controls className="!bg-zinc-800 !border-zinc-700 !text-zinc-400 [&>button]:!border-zinc-700 [&>button:hover]:!bg-zinc-700" />
                <MiniMap
                    className="!bg-zinc-900 !border-zinc-800"
                    nodeColor="#3b82f6"
                    maskColor="rgba(0, 0, 0, 0.6)"
                />
            </ReactFlow>
        </div>
    );
}
