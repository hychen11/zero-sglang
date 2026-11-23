import traceJson from "./generated/trace.json";

export type EvidenceStatus = "VERIFIED" | "INFERRED" | "UNKNOWN";
export type Plane = "control" | "data" | "compute" | "stream";

export interface CodeRef {
  file: string;
  anchor: string;
  start: number | null;
  end: number | null;
  text: string;
  absPath?: string;
  ambiguous?: number[];
  missing?: boolean;
}

export interface Component {
  id: string;
  label: string;
  category: "api" | "client" | "coordinator" | "stage" | "scheduler" | "runner" | "external";
  group: string;
  why: string;
  owns: string;
  interfaces: string;
  io: string;
  classes: string;
  concurrency: string;
  design: string;
  debug: string;
  scenarios: string[];
  code: CodeRef;
}

export interface GraphEdge {
  source: string;
  target: string;
  kind: "control" | "data" | "stream";
  label: string;
  crossProcess?: boolean;
  skipped?: boolean;
  scenarios?: string[];
}

export interface Step {
  id: string;
  title: string;
  scenarios: string[];
  node: string;
  edgeFrom?: string;
  lane: string;
  thread: string;
  plane: Plane;
  boundary: string;
  function: string;
  caller: string;
  callee: string;
  code: CodeRef[];
  input: string;
  output: string;
  requestPayload: string;
  outputPayload: string;
  state: string;
  crossProcess: string | null;
  errors: string;
  rationale: string;
  events: string[];
  status: EvidenceStatus;
  uncertainty?: string;
  repeats?: string;
}

export interface PipelineStage {
  id: string;
  scheduler: string;
  process: string;
  gpu: number | null;
  terminal: boolean;
  entry: boolean;
  waitFor: string[];
  merge: string | null;
  note: string;
}

export interface PipelineEdge {
  source: string;
  target: string;
  kind: "payload" | "stream" | "control";
  conditional?: string;
}

export interface Pipeline {
  id: string;
  label: string;
  status: EvidenceStatus;
  traced: boolean;
  configRef: CodeRef;
  stages: PipelineStage[];
  edges: PipelineEdge[];
}

export interface Trace {
  mode: "STATIC";
  provenance: { repository: string; commit: string; method: string; measured: boolean; note: string };
  subject: { pipelineConfig: string; request: string };
  scenarios: Record<string, string>;
  groups: { id: string; label: string }[];
  components: Component[];
  edges: GraphEdge[];
  steps: Step[];
  pipelines: Pipeline[];
  build: { resolvedAt: string; headCommit: string | null; matchesTraceCommit: boolean };
}

export const trace = traceJson as unknown as Trace;

export function githubUrl(ref: CodeRef): string {
  const lines = ref.start === null ? "" : `#L${ref.start}-L${ref.end}`;
  return `https://github.com/${trace.provenance.repository}/blob/${trace.provenance.commit}/${ref.file}${lines}`;
}

export function editorUrl(ref: CodeRef): string | null {
  return ref.absPath ? `vscode://file/${ref.absPath}:${ref.start ?? 1}` : null;
}

export interface RequestForm {
  prompt: string;
  maxTokens: number;
  stream: boolean;
  audio: boolean;
  requestId: string;
}

export function scenarioOf(form: { stream: boolean; audio: boolean }): string {
  if (form.audio) return "speech";
  return form.stream ? "stream" : "nonstream";
}

export function fillTemplate(template: string, form: RequestForm): string {
  const prompt = JSON.stringify(form.prompt).slice(1, -1);
  return template
    .replaceAll("{{prompt}}", prompt)
    .replaceAll("{{max_tokens}}", String(form.maxTokens))
    .replaceAll("{{stream}}", form.stream ? "true" : "false")
    .replaceAll("{{request_id}}", form.requestId);
}

export function stepsFor(scenario: string): Step[] {
  return trace.steps.filter((step) => step.scenarios.includes(scenario));
}
