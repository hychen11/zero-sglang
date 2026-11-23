import { Background, Controls, Edge, MarkerType, Node, Position, ReactFlow } from "@xyflow/react";
import { useMemo, useState } from "react";
import { CodeBlock } from "../CodeBlock";
import { Pipeline, trace } from "../types";

const LAYOUT: Record<string, Record<string, { x: number; y: number }>> = {
  text: {
    preprocessing: { x: 0, y: 160 },
    image_encoder: { x: 260, y: 20 },
    audio_encoder: { x: 260, y: 300 },
    mm_aggregate: { x: 520, y: 160 },
    thinker: { x: 780, y: 160 },
    decode: { x: 1040, y: 160 },
    coordinator: { x: 1300, y: 160 },
  },
  speech: {
    preprocessing: { x: 0, y: 200 },
    image_encoder: { x: 260, y: 40 },
    audio_encoder: { x: 260, y: 360 },
    thinker: { x: 560, y: 120 },
    talker_ar: { x: 560, y: 340 },
    decode: { x: 860, y: 60 },
    code2wav: { x: 860, y: 380 },
    coordinator: { x: 1140, y: 220 },
  },
};
const KIND_COLOR = { payload: "var(--data)", stream: "var(--stream)", control: "var(--control)" };

function StageLabel({ pipeline, id }: { pipeline: Pipeline; id: string }) {
  const stage = pipeline.stages.find((item) => item.id === id);
  if (!stage) return <div className="flow-node"><b>Coordinator</b><div className="cat">HTTP process</div></div>;
  return (
    <div className="flow-node">
      <div className="cat">
        {stage.entry ? "entry · " : ""}
        {stage.terminal ? "terminal · " : ""}
        process={stage.process}
        {stage.gpu !== null ? ` · gpu ${stage.gpu}` : ""}
      </div>
      <b>{stage.id}</b>
      <div style={{ fontSize: 11 }}>{stage.scheduler}</div>
      {stage.waitFor.length > 0 && <div style={{ fontSize: 10, color: "var(--muted)" }}>fan-in: {stage.waitFor.join(", ")} → {stage.merge}</div>}
    </div>
  );
}

export function PipelineView() {
  const [pipelineId, setPipelineId] = useState("text");
  const [selected, setSelected] = useState<number | null>(null);
  const pipeline = trace.pipelines.find((item) => item.id === pipelineId)!;

  const nodes = useMemo<Node[]>(
    () =>
      [...pipeline.stages.map((stage) => stage.id), "coordinator"].map((id) => ({
        id,
        position: LAYOUT[pipeline.id][id],
        data: { label: <StageLabel pipeline={pipeline} id={id} /> },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        style: { padding: 0, border: 0, background: "transparent", width: 196 },
      })),
    [pipeline],
  );
  const edges = useMemo<Edge[]>(
    () =>
      pipeline.edges.map((edge, index) => ({
        id: `p${index}`,
        source: edge.source,
        target: edge.target,
        label: edge.kind + (edge.conditional ? " (conditional)" : ""),
        animated: edge.kind === "stream",
        markerEnd: { type: MarkerType.ArrowClosed, color: KIND_COLOR[edge.kind] },
        style: { stroke: KIND_COLOR[edge.kind], strokeWidth: selected === index ? 4 : 1.6, strokeDasharray: edge.conditional ? "5 4" : undefined },
        labelStyle: { fontSize: 10, fill: "var(--muted)" },
        labelBgStyle: { fill: "var(--surface)" },
      })),
    [pipeline, selected],
  );

  return (
    <div className="split">
      <div className="graph">
        <ReactFlow key={pipeline.id} nodes={nodes} edges={edges} fitView nodesConnectable={false} onEdgeClick={(_, edge) => setSelected(Number(edge.id.slice(1)))}>
          <Background gap={20} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      <div className="panel">
        <div className="tabs">
          {trace.pipelines.map((item) => (
            <button key={item.id} className={item.id === pipelineId ? "active" : ""} onClick={() => { setPipelineId(item.id); setSelected(null); }}>
              {item.label}
            </button>
          ))}
        </div>
        <p>
          <span className={`badge b-${pipeline.status}`}>{pipeline.status}</span> topology read from the config.{" "}
          {pipeline.traced ? "The core-path request trace runs on this pipeline." : "Per-request path through this pipeline is not traced yet; edges come from the config and route functions only."}
        </p>
        <div className="callout">
          Solid = always taken for a matching request. Dashed = a route function or a request flag decides per request. Stages with the same <code>process</code> share one OS process and asyncio loop; each stage's scheduler runs in its own thread. Fan-in stages wait for the sources listed, narrowed per request by <code>resolve_mm_aggregate_wait_sources</code>.
        </div>
        <h3>Edges (click an edge in the graph)</h3>
        <table className="events">
          <thead><tr><th>from → to</th><th>kind</th><th>condition</th></tr></thead>
          <tbody>
            {pipeline.edges.map((edge, index) => (
              <tr key={index} style={selected === index ? { background: "var(--accent-soft)" } : undefined} onClick={() => setSelected(index)}>
                <td>{edge.source} → {edge.target}</td>
                <td className={`p-${edge.kind === "payload" ? "data" : edge.kind}`}>{edge.kind}</td>
                <td>{edge.conditional ?? "always"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h3>Execution order and possible concurrency</h3>
        {pipeline.id === "text" ? (
          <p>preprocessing → (image_encoder ‖ audio_encoder, only with media) → mm_aggregate → thinker → decode. While the thinker decodes, decode detokenizes earlier tokens concurrently (stream=true). With several requests in flight, every stage can work on a different request at the same time; the thinker additionally batches requests.</p>
        ) : (
          <p>preprocessing fans out to the encoders, thinker and talker_ar. The thinker and the talker both fan in. The thinker streams tokens to decode and to talker_ar while it decodes, and talker_ar streams codec codes to code2wav, so thinker, talker and code2wav all run concurrently on one request. Terminal stages are decode and code2wav, and the Coordinator merges their results.</p>
        )}
        <h3>Config source</h3>
        <CodeBlock code={pipeline.configRef} />
      </div>
    </div>
  );
}
