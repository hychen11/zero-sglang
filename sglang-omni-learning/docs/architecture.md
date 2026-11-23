# Architecture (core path)

This page describes the modules a Qwen3-Omni text request passes through, at commit `b62b0f94`. It covers only what the core path uses. The step-by-step walk is in [request_trace.md](request_trace.md); the speech stages are in [qwen3_omni_pipeline.md](qwen3_omni_pipeline.md).

## System diagram

```text
┌──────────────────────── HTTP process (run_server, serve/launcher.py:683) ───────────────────────┐
│                                                                                                 │
│  FastAPI app (serve/openai_api.py)                                                              │
│     │ ChatCompletionRequest → GenerateRequest                                                   │
│     ▼                                                                                           │
│  Client (client/client.py)          GenerateRequest → OmniRequest; chunks → CompletionResult    │
│     │                                                                                           │
│     ▼                                                                                           │
│  Coordinator (pipeline/coordinator.py)   request state, admission, terminal collection, abort   │
│     │ CoordinatorControlPlane: PUSH (submit) ─┐   PULL (completions/streams) ◄─┐   PUB (abort) │
└─────┼─────────────────────────────────────────┼─────────────────────────────────┼──────────────┘
      │ ZMQ (msgpack)                            │                                 │
┌─────▼───────────── pipeline process(es) (stage_workers.run_process) ────────────┼──────────────┐
│                                                                                  │              │
│  Stage = IO shell (pipeline/stage/runtime.py)     one asyncio loop per process   │              │
│    ├ StageControlPlane: PULL in, PUSH to next stage / coordinator, SUB abort ────┘              │
│    ├ InputHandler: DirectInput | AggregatedInput (fan-in + merge_fn)                            │
│    ├ CommEngine / LocalStageDispatcher: local_object | CUDA IPC | SHM | Mooncake                │
│    └ scheduler.inbox / scheduler.outbox  (queue.Queue, thread-safe)                             │
│             ▲                     │                                                             │
│             │  IncomingMessage    ▼  OutgoingMessage        one thread per scheduler            │
│  Scheduler: SimpleScheduler | OmniScheduler | StreamingDetokenizeScheduler | ...                │
│             │ (OmniScheduler only)                                                              │
│             ▼                                                                                   │
│  ModelRunner (model_runner/base.py) → ThinkerModelRunner → Qwen3OmniThinkerModelRunner          │
│             │                                                                                   │
│             ▼                                                                                   │
│  SGLang upstream: Scheduler methods (via __getattr__), TpModelWorker, radix cache, KV pools     │
│                                                                                                 │
│  Model-specific (models/qwen3_omni/): config.py, stages.py, request_builders.py, merge.py,      │
│                                       components/preprocessor.py, streaming_detokenizer.py      │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
```

## Modules

### HTTP API: `sglang_omni/serve/openai_api.py`

- **Problem:** speak the OpenAI protocol without leaking it into the runtime.
- **Responsibilities:** schemas, routes, conversion to `GenerateRequest` (`build_chat_generate_request`, `:1387`), SSE framing, mapping errors to HTTP status codes.
- **In / out:** `ChatCompletionRequest` → `GenerateRequest`. `CompletionResult` / `CompletionStreamChunk` → JSON or SSE.
- **Concurrency:** async handlers on uvicorn's event loop.
- **Talks to:** `Client` only.

### Client: `sglang_omni/client/client.py`

- **Problem:** one internal API that the chat, speech, generate and realtime routes all share.
- **Responsibilities:** `GenerateRequest` → `OmniRequest` (`build_omni_request`, `:751`). Picks `Coordinator.stream` or `Coordinator.submit`. Turns stage results into `GenerateChunk` (`default_result_builder`, `default_stream_builder`). Aggregates text and audio and applies stop strings (`completion`, `completion_stream`).
- **Concurrency:** async generators on the HTTP loop.

### Coordinator: `sglang_omni/pipeline/coordinator.py`

- **Problem:** someone has to own a request's lifecycle across stages it does not understand.
- **Responsibilities:** admission (`max_in_flight`, duplicate IDs), wrapping the request as `StagePayload`, submitting to the entry stage, tracking `RequestInfo`, collecting completions from one or more terminal stages, stream backlog limits, and broadcasting aborts. It never schedules GPU work.
- **Main classes and functions:** `Coordinator.submit_request` (`:560`), `run_completion_loop` (`:861`), `handle_completion` (`:881`), `handle_stream` (`:1033`), `abort` (`:761`). The control plane is `CoordinatorControlPlane` (`pipeline/control_plane.py:425`).
- **Concurrency:** single asyncio loop. `run_completion_loop` is a background task started by `MultiProcessPipelineRunner` (`pipeline/mp_runner.py:748`).

### Stage: `sglang_omni/pipeline/stage/runtime.py`

- **Problem:** separate inter-stage IO (sockets, relays, fan-in, stream routing) from compute.
- **Responsibilities:** receive `SubmitMessage`, `DataReadyMessage`, stream chunks and signals, and aborts. Run the `InputHandler`. Feed `scheduler.inbox`. Drain `scheduler.outbox` and route each result (`route_result`, `:1783`) to the next stage(s) with optional `project_payload`, or to the coordinator if terminal. Route stream chunks to `stream_targets` or the coordinator.
- **Invariant:** never branches on scheduler type.
- **Concurrency:** coroutines on the process's asyncio loop: the recv loop, the abort listener and the outbox drain. The scheduler runs in a separate thread (`Stage.start`, `:273`). Stages in one OS process share the loop and a failure domain.

### Scheduler: `sglang_omni/scheduling/`

- **Problem:** each stage needs its own execution policy behind one interface.
- **Interface:** `inbox`, `outbox`, `start()`, `stop()`, `abort(request_id)` (`StageScheduler`, `scheduling/message.py`).
- **On the core path:**
  - `SimpleScheduler` (`simple_scheduler.py:35`): `inbox.get()` → function → `outbox.put()`. Used by preprocessing and mm_aggregate.
  - `OmniScheduler` (`omni_scheduler.py:331`): wraps SGLang's scheduler by composition. `__getattr__` (`:1183`) binds upstream `Scheduler` methods to it. It overrides intake (`recv_requests`, `process_input_requests`), execution (`run_batch`, which calls a sglang-omni `ModelRunner`), and output (`stream_output`, `emit_stream_output`, which write to the outbox). Used by the thinker.
  - `StreamingDetokenizeScheduler` (`streaming_detokenizer.py:57`): accumulates token ids and emits UTF-8-safe text deltas. Used by decode.
- **Concurrency:** one dedicated thread per scheduler. `OmniScheduler` also uses a request-build thread pool.

### ModelRunner: `sglang_omni/model_runner/base.py`

- **Problem:** put model-specific forward hooks (multimodal embeddings, hidden-state capture, feedback) around a shared SGLang forward/sample path.
- **Pipeline:** `execute` (`:432`) = `build_forward_batch` → `prepare_and_forward` (`before_*` hook → `custom_*_forward` or `tp_worker.forward_batch_generation`, then sample) → `post_*` hook → `finalize` (→ `ModelRunnerOutput`). Async decode splits this into `execute_launch` / `execute_resolve`.
- **Qwen:** `ThinkerModelRunner` (`model_runner/thinker_model_runner.py:32`) injects multimodal embeddings. `Qwen3OmniThinkerModelRunner` (`models/qwen3_omni/thinker_model_runner.py:43`) adds the prefill-embeds sidecar used with breakable prefill CUDA graphs.

### Relay / Communication: `sglang_omni/comm/`, `sglang_omni/relay/`, `pipeline/local_dispatch.py`

- **Problem:** move payloads and stream chunks between stages, as cheaply as their placement allows.
- **Core path:** all hops after submit run inside one process, so `LocalStageDispatcher` passes object references and there is no relay traffic. ZMQ carries only coordinator ↔ stage messages. See `docs/developer_reference/communication.md` in the sglang-omni repo for CUDA IPC, SHM and Mooncake.

### Model-specific integration: `sglang_omni/models/qwen3_omni/`

- `config.py`: topology (`text_stages`, `speech_stages`, pipeline config classes).
- `stages.py`: scheduler factories.
- `request_builders.py`: routing functions (`resolve_*`), payload projections (`project_*`), and the thinker adapters between `StagePayload` and SGLang `Req`.
- `merge.py`: fan-in merge into `thinker_inputs`.
- `components/preprocessor.py`: chat template, tokenization and media.
- `components/streaming_detokenizer.py`: the decode result shape.
- `payload_types.py`: `Qwen3OmniPipelineState`, the typed view of `StagePayload.data`.

## Coordinator vs Scheduler in one sentence

The Coordinator decides **which request exists and when it is done**, for the whole pipeline and without knowing the model. A Scheduler decides **what runs next on one stage**: which requests go into the next batch, when to prefill or decode, and how much KV to use.
