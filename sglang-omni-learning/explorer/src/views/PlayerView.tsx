import { useEffect, useMemo, useState } from "react";
import { CodeBlock } from "../CodeBlock";
import { ComponentGraph } from "../ComponentGraph";
import { fillTemplate, RequestForm, scenarioOf, stepsFor, trace } from "../types";

const EXAMPLES: RequestForm[] = [
  { prompt: "What is the capital of France?", maxTokens: 64, stream: true, audio: false, requestId: "demo-stream-1" },
  { prompt: "Summarize the plot of Hamlet in one sentence.", maxTokens: 128, stream: false, audio: false, requestId: "demo-json-1" },
  { prompt: "Say hello and tell me a short joke.", maxTokens: 128, stream: true, audio: true, requestId: "demo-speech-1" },
];

function exampleLabel(example: RequestForm): string {
  const mode = example.audio ? "text+audio" : example.stream ? "stream" : "non-stream";
  return `${mode}: ${example.prompt.slice(0, 26)}…`;
}

function validate(form: RequestForm): string | null {
  if (!form.prompt.trim()) return "The message must not be empty.";
  if (!Number.isInteger(form.maxTokens) || form.maxTokens < 1 || form.maxTokens > 32768) return "max_tokens must be an integer between 1 and 32768.";
  if (!/^[\w.-]{1,64}$/.test(form.requestId)) return "request_id: 1-64 letters, digits, '.', '_' or '-'.";
  return null;
}

export function PlayerView() {
  const [form, setForm] = useState<RequestForm>(window.location.hash.endsWith(":speech") ? EXAMPLES[2] : EXAMPLES[0]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const error = validate(form);
  const scenario = scenarioOf(form);
  const steps = useMemo(() => stepsFor(scenario), [scenario]);
  const step = steps[Math.min(index, steps.length - 1)];
  const next = steps[index + 1];

  useEffect(() => {
    if (!playing) return;
    if (index >= steps.length - 1) {
      setPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => setIndex((value) => value + 1), 2200 / speed);
    return () => window.clearTimeout(timer);
  }, [playing, index, speed, steps.length]);

  const update = (patch: Partial<RequestForm>) => {
    setForm((current) => ({ ...current, ...patch }));
    setIndex(0);
    setPlaying(false);
  };

  return (
    <div className="split">
      <div className="graph">
        <ComponentGraph scenario={scenario} activeNode={step.node} activeEdge={step.edgeFrom ? { source: step.edgeFrom, target: step.node } : null} />
      </div>
      <div className="panel">
        <div className="callout">
          <span className="badge b-SIMULATED">SIMULATED</span> replay of a <span className="badge b-STATIC">STATIC</span> code-derived trace. Nothing is sent to a server; values in payloads come from this form, shapes come from the code. No step has a duration.
        </div>
        <div className="form">
          <label htmlFor="prompt">User message</label>
          <input id="prompt" type="text" value={form.prompt} onChange={(event) => update({ prompt: event.target.value })} />
          <div className="row">
            <label>
              max_tokens{" "}
              <input type="number" style={{ width: 90 }} value={form.maxTokens} onChange={(event) => update({ maxTokens: Number(event.target.value) })} />
            </label>
            <label>
              <input type="checkbox" checked={form.stream} onChange={(event) => update({ stream: event.target.checked })} /> stream
            </label>
            <label>
              modalities{" "}
              <select value={form.audio ? "audio" : "text"} onChange={(event) => update({ audio: event.target.value === "audio" })}>
                <option value="text">["text"]</option>
                <option value="audio">["text", "audio"]</option>
              </select>
            </label>
            <label>
              request_id{" "}
              <input type="text" style={{ width: 130 }} value={form.requestId} onChange={(event) => update({ requestId: event.target.value })} />
            </label>
          </div>
          <div className="row">
            <span className="meta">Examples:</span>
            {EXAMPLES.map((example) => (
              <button key={example.requestId} className="tabs" onClick={() => update(example)}>
                {exampleLabel(example)}
              </button>
            ))}
          </div>
          <p className="meta">Scenario: {trace.scenarios[scenario]}</p>
          {form.audio && !form.stream && <p className="meta">The text+audio trace follows stream=true; with stream=false, code2wav returns the whole waveform in its final result instead of streaming windows (see step "code2wav final result").</p>}
          {error && <p className="error-text">{error}</p>}
        </div>
        <div className="controls">
          <button disabled={!!error} onClick={() => { setIndex(0); setPlaying(true); }}>Start</button>
          <button disabled={index === 0} onClick={() => setIndex(index - 1)}>◀ Previous</button>
          <button disabled={!!error || index >= steps.length - 1} onClick={() => setIndex(index + 1)}>Next ▶</button>
          <button disabled={!!error} onClick={() => setPlaying(!playing)}>{playing ? "Pause" : "Auto play"}</button>
          <button onClick={() => { setIndex(0); setPlaying(false); }}>Reset</button>
          <label className="meta">
            speed{" "}
            <input type="range" min={0.5} max={4} step={0.5} value={speed} onChange={(event) => setSpeed(Number(event.target.value))} /> {speed}×
          </label>
        </div>
        <ol className="steplist">
          {steps.map((item, itemIndex) => (
            <li key={item.id} className={itemIndex === index ? "cur" : ""} onClick={() => setIndex(itemIndex)}>
              {itemIndex + 1}. {item.title}
            </li>
          ))}
        </ol>

        <h2>
          {index + 1}/{steps.length} · {step.title}
        </h2>
        <p>
          <span className={`badge b-${step.status}`}>{step.status}</span> <span className={`p-${step.plane}`}>● {step.plane}</span> · {step.thread}
          {step.boundary !== "none" && <> · boundary: <b>{step.boundary}</b></>}
          {step.repeats && <> · ↻ repeats {step.repeats}</>}
        </p>
        {step.uncertainty && <div className="callout warn">{step.uncertainty}</div>}
        <h3>Current function</h3>
        <p><code>{step.function}</code></p>
        <dl className="kv">
          <dt>caller</dt><dd>{step.caller}</dd>
          <dt>callee</dt><dd>{step.callee}</dd>
          <dt>input type</dt><dd>{step.input}</dd>
          <dt>output type</dt><dd>{step.output}</dd>
        </dl>
        <h3>Request payload (shape, values from the form)</h3>
        <pre className="payload">{fillTemplate(step.requestPayload, form)}</pre>
        <h3>Output payload</h3>
        <pre className="payload">{fillTemplate(step.outputPayload, form)}</pre>
        <h3>Internal state</h3>
        <p>{step.state}</p>
        <h3>Cross-process communication</h3>
        <p>{step.crossProcess ?? "None at this step."}</p>
        <h3>Errors</h3>
        <p>{step.errors}</p>
        <h3>Why</h3>
        <p>{step.rationale}</p>
        {step.events.length > 0 && (
          <>
            <h3>Profiler events emitted here</h3>
            <p>{step.events.map((name) => <code key={name}>{name} </code>)}</p>
          </>
        )}
        <h3>Next function</h3>
        <p>{next ? <code>{next.function}</code> : "End of request."}</p>
        <h3>Source</h3>
        {step.code.map((code) => (
          <CodeBlock key={`${code.file}:${code.start}`} code={code} />
        ))}
      </div>
    </div>
  );
}
