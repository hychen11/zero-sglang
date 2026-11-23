import { useMemo, useState } from "react";
import { stepsFor, trace } from "../types";

const LANE_ORDER = ["http", "client", "coordinator", "preprocessing", "mm_aggregate", "thinker", "decode", "talker_ar", "code2wav"];
const PLANE_COLOR: Record<string, string> = { control: "var(--control)", data: "var(--data)", stream: "var(--stream)", compute: "var(--compute)" };

interface RecordedEvent {
  request_id: string;
  stage: string | null;
  event_name: string;
  timestamp_ns: number;
  pid?: number;
  metadata?: Record<string, unknown>;
}

function parseJsonl(text: string): { events: RecordedEvent[]; skipped: number } {
  const events: RecordedEvent[] = [];
  let skipped = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const value = JSON.parse(line);
      if (typeof value.request_id === "string" && typeof value.event_name === "string" && typeof value.timestamp_ns === "number") {
        events.push(value);
      } else {
        skipped += 1;
      }
    } catch {
      skipped += 1;
    }
  }
  return { events, skipped };
}

function StaticTimeline({ scenario }: { scenario: string }) {
  const steps = stepsFor(scenario);
  const LANES = LANE_ORDER.filter((lane) => steps.some((step) => step.lane === lane));
  const laneHeight = 34;
  const columnWidth = 46;
  const left = 110;
  const width = left + steps.length * columnWidth + 20;
  const height = LANES.length * laneHeight + 40;
  const laneY = (lane: string) => 20 + LANES.indexOf(lane) * laneHeight + laneHeight / 2;
  return (
    <div className="timeline">
      <svg width={width} height={height} role="img" aria-label="Causal order of trace steps by lane">
        {LANES.map((lane) => (
          <g key={lane}>
            <line x1={left} x2={width - 10} y1={laneY(lane)} y2={laneY(lane)} stroke="var(--border)" />
            <text className="lane-label" x={8} y={laneY(lane) + 4}>{lane}</text>
          </g>
        ))}
        {steps.map((step, index) => {
          const x = left + index * columnWidth + columnWidth / 2;
          const previous = steps[index - 1];
          const isProcess = previous?.boundary === "process";
          return (
            <g key={step.id}>
              {previous && (
                <line x1={x - columnWidth} y1={laneY(previous.lane)} x2={x} y2={laneY(step.lane)} stroke={isProcess ? "var(--measured)" : "var(--muted)"} strokeDasharray={isProcess ? "4 3" : undefined} strokeWidth={1} />
              )}
              <circle cx={x} cy={laneY(step.lane)} r={9} fill={PLANE_COLOR[step.plane]}>
                <title>{`${index + 1}. ${step.title}\n${step.thread}\nboundary: ${step.boundary}`}</title>
              </circle>
              <text x={x} y={laneY(step.lane) + 4} textAnchor="middle" style={{ fill: "#fff", fontSize: 10 }}>{index + 1}</text>
              {step.repeats && <text x={x} y={laneY(step.lane) - 13} textAnchor="middle" style={{ fontSize: 10 }}>↻</text>}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function MeasuredTimeline({ events }: { events: RecordedEvent[] }) {
  const start = Math.min(...events.map((event) => event.timestamp_ns));
  const end = Math.max(...events.map((event) => event.timestamp_ns));
  const spanMs = Math.max((end - start) / 1e6, 0.001);
  const lanes = Array.from(new Set(events.map((event) => event.stage ?? "(none)")));
  const laneHeight = 30;
  const left = 130;
  const width = 1100;
  const plotWidth = width - left - 30;
  const height = lanes.length * laneHeight + 50;
  const x = (ns: number) => left + ((ns - start) / 1e6 / spanMs) * plotWidth;
  return (
    <>
      <div className="timeline">
        <svg width={width} height={height} role="img" aria-label="Measured request events">
          {lanes.map((lane, laneIndex) => (
            <g key={lane}>
              <line x1={left} x2={width - 20} y1={25 + laneIndex * laneHeight} y2={25 + laneIndex * laneHeight} stroke="var(--border)" />
              <text className="lane-label" x={8} y={29 + laneIndex * laneHeight}>{lane}</text>
            </g>
          ))}
          {events.map((event, index) => (
            <circle key={index} cx={x(event.timestamp_ns)} cy={25 + lanes.indexOf(event.stage ?? "(none)") * laneHeight} r={4} fill="var(--measured)">
              <title>{`${event.event_name} @ ${((event.timestamp_ns - start) / 1e6).toFixed(3)} ms`}</title>
            </circle>
          ))}
          <text x={left} y={height - 8}>0 ms</text>
          <text x={width - 20} y={height - 8} textAnchor="end">{spanMs.toFixed(3)} ms</text>
        </svg>
      </div>
      <table className="events">
        <thead><tr><th>t (ms from first event)</th><th>stage</th><th>event</th><th>pid</th><th>metadata</th></tr></thead>
        <tbody>
          {events.map((event, index) => (
            <tr key={index}>
              <td>{((event.timestamp_ns - start) / 1e6).toFixed(3)}</td>
              <td>{event.stage}</td>
              <td>{event.event_name}</td>
              <td>{event.pid}</td>
              <td><code>{event.metadata ? JSON.stringify(event.metadata) : ""}</code></td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export function TimelineView() {
  const [scenario, setScenario] = useState("stream");
  const [recorded, setRecorded] = useState<RecordedEvent[]>([]);
  const [skipped, setSkipped] = useState(0);
  const [requestId, setRequestId] = useState<string>("");
  const requestIds = useMemo(() => Array.from(new Set(recorded.map((event) => event.request_id))), [recorded]);
  const selectedEvents = useMemo(
    () => recorded.filter((event) => event.request_id === requestId).sort((a, b) => a.timestamp_ns - b.timestamp_ns),
    [recorded, requestId],
  );

  const onFiles = async (files: FileList | null) => {
    if (!files) return;
    const texts = await Promise.all(Array.from(files).map((file) => file.text()));
    const parsed = texts.map(parseJsonl);
    const events = parsed.flatMap((item) => item.events);
    setRecorded(events);
    setSkipped(parsed.reduce((n, item) => n + item.skipped, 0));
    setRequestId(events[0]?.request_id ?? "");
  };

  return (
    <div className="full">
      <h2>Code-derived causal order <span className="badge b-STATIC">STATIC</span></h2>
      <p>
        Each dot is one trace step, placed on the lane that owns it, in causal order. The x axis is step order, not time. Red dashed links cross a process boundary (ZMQ). ↻ marks a step that repeats (per token, per window); it is drawn once. Colors: <span className="p-control">control</span>, <span className="p-data">data</span>, <span className="p-stream">stream</span>, <span className="p-compute">compute</span>.
      </p>
      <div className="controls">
        <label>
          scenario{" "}
          <select value={scenario} onChange={(event) => setScenario(event.target.value)}>
            {Object.entries(trace.scenarios).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>
      </div>
      <StaticTimeline scenario={scenario} />

      <h2 style={{ marginTop: 24 }}>Recorded run <span className="badge b-MEASURED">MEASURED</span></h2>
      <p>
        Load the JSONL files written by the request-level profiler (<code>events_&lt;stage&gt;_&lt;pid&gt;.jsonl</code>). Record them with <code>POST /start_profile</code> with an <code>event_dir</code>, send requests, then <code>POST /stop_profile</code>. Files from every process merge by <code>request_id</code>. Timestamps come from different processes; a missing or incomplete <code>run_status_&lt;pid&gt;.json</code> means the trace may be incomplete.
      </p>
      <input type="file" accept=".jsonl,.json,.txt" multiple onChange={(event) => onFiles(event.target.files)} />
      {skipped > 0 && <p className="error-text">{skipped} lines skipped (not request events).</p>}
      {requestIds.length > 0 && (
        <div className="controls">
          <label>
            request_id{" "}
            <select value={requestId} onChange={(event) => setRequestId(event.target.value)}>
              {requestIds.map((id) => <option key={id} value={id}>{id}</option>)}
            </select>
          </label>
          <span className="meta">{selectedEvents.length} events</span>
        </div>
      )}
      {selectedEvents.length > 0 ? <MeasuredTimeline events={selectedEvents} /> : <p className="meta">No recorded trace loaded. Nothing here is estimated.</p>}
    </div>
  );
}
