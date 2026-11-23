import { Background, Controls, Edge, MarkerType, Node, ReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMemo } from "react";
import { trace } from "./types";

const POSITIONS: Record<string, { x: number; y: number }> = {
  http: { x: 20, y: 40 },
  client: { x: 20, y: 170 },
  coordinator: { x: 20, y: 300 },
  st_pre: { x: 20, y: 40 },
  sch_pre: { x: 20, y: 170 },
  img_enc: { x: 250, y: 300 },
  aud_enc: { x: 250, y: 400 },
  st_agg: { x: 250, y: 40 },
  sch_agg: { x: 250, y: 170 },
  st_thk: { x: 480, y: 40 },
  sch_thk: { x: 480, y: 170 },
  sglang: { x: 480, y: 300 },
  mr_thk: { x: 480, y: 410 },
  st_dec: { x: 710, y: 40 },
  sch_dec: { x: 710, y: 170 },
  st_tk: { x: 20, y: 40 },
  sch_tk: { x: 250, y: 40 },
  mr_tk: { x: 480, y: 40 },
  st_c2w: { x: 20, y: 150 },
  sch_c2w: { x: 250, y: 150 },
};
const GROUP_BOXES: Record<string, { x: number; y: number; width: number; height: number }> = {
  http_proc: { x: 0, y: 0, width: 236, height: 400 },
  pipe_proc: { x: 290, y: 0, width: 930, height: 510 },
  speech_proc: { x: 290, y: 560, width: 930, height: 240 },
};
const EDGE_COLORS = { control: "var(--control)", data: "var(--data)", stream: "var(--stream)" };
const SKIPPED = new Set(["img_enc", "aud_enc"]);

interface Props {
  scenario?: string;
  activeNode?: string;
  activeEdge?: { source: string; target: string } | null;
  selectedNode?: string | null;
  onSelect?: (id: string) => void;
}

export function ComponentGraph({ scenario, activeNode, activeEdge, selectedNode, onSelect }: Props) {
  const nodes = useMemo<Node[]>(() => {
    const groupNodes: Node[] = trace.groups.map((group) => ({
      id: group.id,
      type: "group",
      position: { x: GROUP_BOXES[group.id].x, y: GROUP_BOXES[group.id].y },
      style: { width: GROUP_BOXES[group.id].width, height: GROUP_BOXES[group.id].height },
      className: "flow-group",
      data: { label: group.label },
      selectable: false,
      draggable: false,
    }));
    const labelNodes: Node[] = trace.groups.map((group) => ({
      id: `${group.id}-label`,
      parentId: group.id,
      position: { x: 4, y: 2 },
      data: { label: <div className="flow-group-label">{group.label}</div> },
      draggable: false,
      selectable: false,
      style: { border: 0, background: "transparent", width: 300, padding: 0 },
    }));
    const componentNodes: Node[] = trace.components.map((component) => {
      const classes = ["flow-node"];
      if (SKIPPED.has(component.id) || (scenario && !component.scenarios.includes(scenario))) classes.push("skipped");
      if (component.id === activeNode) classes.push("active");
      if (component.id === selectedNode) classes.push("selected");
      return {
        id: component.id,
        parentId: component.group,
        extent: "parent" as const,
        position: POSITIONS[component.id] ?? { x: 0, y: 0 },
        data: {
          label: (
            <div className={classes.join(" ")}>
              <div className="cat">{component.category}</div>
              {component.label}
            </div>
          ),
        },
        style: { padding: 0, border: 0, background: "transparent", width: 196 },
      };
    });
    return [...groupNodes, ...labelNodes, ...componentNodes];
  }, [scenario, activeNode, selectedNode]);

  const edges = useMemo<Edge[]>(() => {
    const list: Edge[] = trace.edges.map((edge, index) => {
      const isActive = activeEdge != null && edge.source === activeEdge.source && edge.target === activeEdge.target;
      const color = EDGE_COLORS[edge.kind];
      const outOfScenario = !!scenario && !!edge.scenarios && !edge.scenarios.includes(scenario);
      return {
        id: `e${index}`,
        source: edge.source,
        target: edge.target,
        label: edge.label + (edge.crossProcess ? " ⟂" : ""),
        animated: isActive || edge.kind === "stream",
        markerEnd: { type: MarkerType.ArrowClosed, color },
        style: {
          stroke: color,
          strokeWidth: isActive ? 4 : 1.5,
          strokeDasharray: edge.skipped || outOfScenario ? "4 4" : undefined,
          opacity: edge.skipped || outOfScenario ? 0.35 : 1,
        },
        labelStyle: { fontSize: 10, fill: "var(--muted)" },
        labelBgStyle: { fill: "var(--surface)" },
      };
    });
    const isKnown = trace.edges.some((edge) => activeEdge && edge.source === activeEdge.source && edge.target === activeEdge.target);
    if (activeEdge && !isKnown) {
      list.push({
        id: "active-transient",
        source: activeEdge.source,
        target: activeEdge.target,
        animated: true,
        style: { stroke: "var(--active)", strokeWidth: 4 },
        markerEnd: { type: MarkerType.ArrowClosed, color: "var(--active)" },
      });
    }
    return list;
  }, [scenario, activeEdge]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      fitView
      minZoom={0.3}
      nodesConnectable={false}
      onNodeClick={(_, node) => {
        if (onSelect && trace.components.some((component) => component.id === node.id)) onSelect(node.id);
      }}
    >
      <Background gap={20} size={1} />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
