# SGLang-Omni learning notes

My personal reading of the sglang-omni codebase, kept outside the repository. Nothing here changes or ships with sglang-omni.

```text
sglang-omni-learning/
├── README.md                  this file
├── docs/
│   ├── architecture.md        modules on the core path
│   ├── request_trace.md       step-by-step trace of one Qwen3-Omni text request
│   ├── qwen3_omni_pipeline.md text + audio: DAG, talker/code2wav trace, sequence, timeline, the 9 questions
│   ├── scheduler_deep_dive.md config → topology, Coordinator vs Scheduler, SGLang integration, KV, TTFT/TPOT levers
│   ├── communication.md       control plane, transport selection, per-edge transports, lifetimes
│   ├── reading_roadmap.md     reading order, data structures, exercise, coverage
│   ├── docker_dev_setup.md    Docker setup, starting services, the edit-and-restart loop (中文)
│   └── execution-trace.json   the data behind the explorer
└── explorer/                  interactive web explorer
```

The explorer (`explorer/`) is a local React + TypeScript + Vite + React Flow site that walks Qwen3-Omni requests (text-only, and text + audio) through the real code. It does not import or run any `sglang_omni` code and needs no GPU.

## Run

```bash
cd explorer
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build into dist/
npm run preview    # serve dist/
```

`npm run dev` and `npm run build` first run `scripts/extract-snippets.mjs`. The script reads `docs/execution-trace.json` and finds each code anchor in an sglang-omni checkout: `$SGLANG_OMNI_REPO` if set, otherwise the sibling directory `../sglang-omni` (here `/home/essie/Desktop/sglang-omni`). It writes `src/generated/trace.json` with the real line numbers and snippets. A missing anchor fails the build, and a HEAD different from the traced commit prints a warning. Deep links work with `#player`, `#architecture`, `#pipeline`, `#timeline` and `#source`.

## Views

- **Request Player:** enter a message, `max_tokens`, `stream` and `request_id`, pick `modalities`, then step through the 28 (text, stream), 23 (text, non-stream) or 18 (text + audio) steps. `#player:speech` opens the text + audio example directly. Each step highlights its component and the hop that led to it, and shows the function, caller and callee, payload shapes, state changes, cross-process communication, errors, rationale, profiler events and source.
- **Architecture:** click a component to see what it does, what state it owns, its interfaces, I/O, concurrency, design decisions, how to debug it, its connections and its source.
- **Pipeline DAG:** the text and speech stage graphs from `config.py`. Payload, stream and control edges are distinguished, and conditional edges are dashed.
- **Timeline:** the code-derived causal order across lanes (no durations). It can also load the request-level profiler's JSONL to show a real measured run.
- **Source:** every cited location, grouped by file, with links to an editor and to GitHub at the commit.

## Evidence labels

- **VERIFIED:** read in this checkout. **INFERRED:** the call edge is verified, but the behavior described lives in a dependency (upstream SGLang) that was not read. **UNKNOWN:** not used yet.
- **STATIC:** derived from code. **SIMULATED:** the player's replay of the static trace. **MEASURED:** only what you load from profiler JSONL.

## Extending

Add steps, components or edges to [docs/execution-trace.json](docs/execution-trace.json). Code references are `{file, anchor, span}`: `anchor` is the start of a line in the file, and the snippet is `span` lines from the first matching line. Graph layout lives in `explorer/src/ComponentGraph.tsx` and `explorer/src/views/PipelineView.tsx`.
