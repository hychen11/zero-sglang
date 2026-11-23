# Reading roadmap (core path)

Pages here: [architecture.md](architecture.md), [request_trace.md](request_trace.md), [qwen3_omni_pipeline.md](qwen3_omni_pipeline.md), [scheduler_deep_dive.md](scheduler_deep_dive.md), [communication.md](communication.md), [execution-trace.json](execution-trace.json) (the data behind the [interactive explorer](../README.md)). Line numbers are at commit `b62b0f94`.

## 60–90 minute reading order (text path; speech additions at the end)

1. `sglang_omni/models/qwen3_omni/config.py` (`text_stages`, `thinker_stage`, `decode_stage`, `Qwen3OmniPipelineConfig`): the topology everything else follows. 10 min.
2. `sglang_omni/serve/openai_api.py` (`chat_completions`, `build_chat_generate_request`, `chat_stream_events`): the edge of the system. 10 min.
3. `sglang_omni/client/client.py` (`generate`, `build_omni_request`, `default_result_builder`): how results come back into HTTP shape. 10 min.
4. `sglang_omni/pipeline/coordinator.py` (`submit_request`, `stream`, `handle_completion`, `handle_stream`, `abort`): request lifecycle. 15 min.
5. `sglang_omni/pipeline/stage/runtime.py` (`run`, `on_submit`, `execute`, `drain_outbox_external`, `route_result`, `send_to_stage`): the IO shell. 15 min.
6. `sglang_omni/scheduling/simple_scheduler.py` (`start_serial`, `run_single`) and `sglang_omni/scheduling/streaming_detokenizer.py`: the two simplest schedulers. 10 min.
7. `sglang_omni/scheduling/omni_scheduler.py` (`__getattr__`, `recv_requests`, `process_input_requests`, `enqueue_built_request`, `_run_batch`, `emit_stream_output`, `stream_output`, `event_loop_async_decode`): where SGLang is embedded. 20 min.
8. `sglang_omni/model_runner/base.py` (`execute`, `prepare_and_forward`, `finalize`) and `sglang_omni/models/qwen3_omni/thinker_model_runner.py` (`classify_prefill`, `before_prefill`). 10 min.
9. `sglang_omni/models/qwen3_omni/request_builders.py` (`resolve_*`, `project_*`, `build_sglang_thinker_request`, `make_thinker_*`): the model-specific glue. 10 min.
10. Speech: `models/qwen3_omni/talker_scheduler.py` (`is_request_build_ready`, `update_running_batch`), `talker_model_runner.py` (`emit_code_chunks_and_feedback`, `combine_feedback_with_next_text`), `components/code2wav_scheduler.py` (`ingest`, `window_ready`, `final_result_data`), `comm/router.py` (`outbound_payload`, `outbound_stream`). 30 min.

## Critical data structures

- `OmniRequest` / `StagePayload` (`proto/request.py`): what every stage receives. `StagePayload.data` is a `Qwen3OmniPipelineState` dict (`models/qwen3_omni/payload_types.py`).
- `IncomingMessage` / `OutgoingMessage` (`scheduling/message.py`): the only contract between a Stage and its scheduler.
- `SubmitMessage`, `DataReadyMessage`, `StreamMessage`, `CompleteMessage`, `AbortMessage` (`proto/messages.py`): the control-plane vocabulary.
- `RequestInfo` (`proto/request.py`) plus the Coordinator's futures, stream queues and backlogs: the lifecycle state.
- `SGLangARRequestData` wrapping a SGLang `Req` (`req.omni_data` back-pointer): the bridge into upstream scheduling.

## Design trade-offs visible on this path

- **Stage as IO shell, scheduler as compute:** any scheduler fits behind one interface. The cost is a thread hand-off (queue) on every message.
- **Composition over inheritance for SGLang:** upstream algorithms are reused without forking. In exchange, `OmniScheduler` depends on upstream method names and attributes (`__getattr__`, upstream spellings marked `noqa: leading-underscore`).
- **Process grouping from config:** `process="pipeline"` makes hops free (`local_object`) but puts every stage in one failure domain and one GIL. Separate processes isolate failures, but hops then go through ZMQ and relays.
- **A separate decode stage:** detokenization is off the thinker's thread, and streaming and non-streaming share one stage. Each streamed token costs a hop and one ZMQ message to the HTTP process.
- **Whole-stream failure on backlog overflow:** this protects memory and avoids corrupt partial output, at the cost of failing slow readers.

## Debug exercise

Goal: see the stream_done-before-payload ordering at the decode stage (request_trace.md steps 23–24) without changing behavior.

1. In `sglang_omni/scheduling/streaming_detokenizer.py`, add temporary `logger.info` lines at the top of `on_stream_done` and `on_new_request` that print `request_id` and whether `request_states` already holds it.
2. Launch the text pipeline (`examples/run_qwen3_omni_server.py`, or `sgl-omni serve` with the Qwen3-Omni model and text-only config) and send one `stream: true` and one `stream: false` request.
3. Predict before you look: with stream=true, `on_stream_done` finds state (chunks created it). With stream=false, it finds none, so the ID goes into `done_seen`. Then check the log, and revert the change.

A no-GPU alternative is to read `tests/` for the detokenizer (`rg -l StreamingDetokenizeScheduler tests`) and run that unit test with a print.

## Verified vs not yet covered

- **Verified at `b62b0f94`:** every step in `request_trace.md` except the internals of upstream SGLang batch selection, which is marked INFERRED.
- **Covered since:** the text + audio path (talker_ar, code2wav, multi-terminal merge) in `qwen3_omni_pipeline.md`; transport selection and per-edge transports in `communication.md` (derived from rules plus default placement, not observed on a run).
- **Not covered yet:** encoder stages with real media, `TalkerPrefillBuilder` internals, code2wav CUDA graphs, TP leader/follower fan-out, sessions (realtime), and speculative decoding.
- **Not measured:** nothing in these pages comes from a run. Load profiler JSONL into the explorer's Timeline to get real numbers.
