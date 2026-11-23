# Scheduler deep dive

This page covers how sglang-omni decides what runs where and when: config to topology, Coordinator vs Scheduler, stage-local scheduling, the SGLang integration, memory, and the levers that move TTFT, TPOT and throughput. It is read from code at commit `b62b0f94`. Nothing here is measured.

## 1. How PipelineConfig and StageConfig decide the topology

The topology is decided once, at startup, from the stage list. Request-time code only narrows it.

| Config field (`StageConfig`) | Consumed by | Effect |
| --- | --- | --- |
| `name`, `process` | `build_stage_groups` (`pipeline/mp_runner.py:100`) | stages with the same `process` share one OS process; `resolve_same_process_targets` (`mp_runner.py:352`) enables `local_object` between them |
| `gpu`, `tp_size`, `gpu_memory_fraction` | placement + process launch | device pinning, TP rank groups, memory budget |
| `factory_path`, `factory.*`, `engine.*` | `construct_scheduler` (`pipeline/stage_workers.py:1298`) | imports the factory and calls it with factory kwargs; `engine.*` becomes SGLang `ServerArgs` overrides |
| `next`, `route_fn`, `terminal` | `construct_stage` (`stage_workers.py:1026`) | builds `get_next`: terminal → `None`; `route_fn` → per-request; otherwise the static `next` |
| `wait_for`, `merge_fn`, `wait_for_fn` | `construct_stage` | wraps the stage in `AggregatedInput(sources, merge, expected_sources_fn)`, otherwise `DirectInput` |
| `project_payload` | `construct_stage` → `Stage.project_payload` | per-target projection applied in `send_to_stage` |
| `stream_to`, `stream_done_to_fn`, `can_accept_stream_before_payload` | `Stage` | stream targets and stream-done targets; pre-payload stream acceptance |
| (pipeline) `entry_stage` or first stage, `terminal_stages`, `terminal_stages_fn` | `Coordinator` (`mp_runner.py:719`) | where requests enter; which completions finish a request |

Rule from `docs/developer_reference/config.md`: config files and CLI flags override settings on these stages but never add or remove stages. Topology lives only in the model's `config.py`.

## 2. Coordinator vs Scheduler

| | Coordinator | Scheduler (per stage) |
| --- | --- | --- |
| Scope | whole pipeline, one instance, HTTP process | one stage, one instance per stage (and per TP rank) |
| Decides | does this request exist, is it admitted, which terminals must finish, is it done/failed/aborted | which queued work runs next on this stage, in which batch, prefill or decode, how much KV |
| Knows the model? | no (only names and resolver functions) | yes (via factories, adapters, model runner) |
| State | `RequestInfo`, futures, stream queues, backlogs | SGLang `waiting_queue` / `running_batch`, KV pools, request builds, per-request stream state |
| Concurrency | asyncio loop | dedicated thread (plus build pool for AR) |
| Talks via | ZMQ to entry and terminal stages, PUB abort to all | `inbox` / `outbox` queues with its own Stage |

The Coordinator never sees a batch. A scheduler never sees another stage.

## 3. Why many stages and not one inference loop

Visible in the code:

- **Different execution models in one request:** CPU tokenization (`SimpleScheduler`), batched encoder forwards (`SimpleScheduler` with `batch_compute_fn`), two independent AR engines (thinker `OmniScheduler`, talker `QwenTalkerScheduler`) with their own KV pools and running-request caps (64 vs 32), and a windowed vocoder (`Code2WavScheduler`).
- **Pipelining inside one request:** the talker starts after `partial_start_min_chunks` thinker tokens (`talker_scheduler.py:97`), and code2wav after a 10-frame window. A single loop would have to interleave three models by hand.
- **Placement freedom:** thinker and talker on different GPUs (`Qwen3OmniSpeechPipelineConfig`), or all on one (`...ColocatedPipelineConfig`), without changing stage code.
- **Per-request skipping:** a text request never touches the encoders, talker or code2wav.

The cost: every hop is a queue hand-off, and cross-process hops add serialization and a relay. A failure in one stage must be propagated (fail-fast plus abort broadcast).

## 4. Stage-local scheduling: the three scheduler families on the core path

### SimpleScheduler (`scheduling/simple_scheduler.py:35`)

```text
start_serial: loop { msg = inbox.get(); collect_batch(msg); run_batch → fn / batch_fn → outbox.put(result | error) }
start_concurrent (max_concurrency > 1): N worker coroutines → compute thread pool of exactly N threads
```

- Batching is opt-in: `batch_compute_fn` + `max_batch_size` + `max_batch_wait_ms` + optional `request_cost_fn` / `max_batch_cost`. Non-`new_request` messages found while collecting are parked in `pending_messages`.
- Aborts are a set checked before and after compute (`consume_if_aborted`), so an aborted request's result is dropped, not cancelled mid-compute.

### OmniScheduler (`scheduling/omni_scheduler.py:331`)

One iteration of `event_loop_async_decode` (`:5059`), the thinker default when not speculative:

```text
process_admin_requests()
recv_requests()                     # drain inbox (TP>1: broadcast to ranks); stream_chunk/stream_done → on_stream_chunk/on_stream_done
process_input_requests(new + deferred)
    ├─ is_request_build_ready?      # talker: partial-start gate; otherwise defer
    ├─ waiting_queue_is_full?       # → QueueFullError (503)
    ├─ submit request build         # request-build thread pool (or early build from the stage thread)
    └─ drain builds → enqueue_built_request → limits, KV capacity, decode path → waiting_queue.append
batch = get_next_batch_to_run()     # upstream SGLang via __getattr__
if decode batch (≥ async_decode_min_batch_size) and runner.lookahead_eligible:
    launch step N (run_batch_launch) ; resolve + process step N-1   # two decode steps in flight
else:
    resolve pending; drop_stale_overrun(batch); run_batch(batch) sync; process_batch_result
```

- **Admission:** `queued_admission_count` (`:1755`) counts waiting + building + deferred requests against `max_queued_requests`. `request_kv_capacity_error` (`:2310`) rejects a request whose prompt plus `max_new_tokens` can never fit in KV.
- **Prefill vs decode:** upstream picks. Thinker defaults `enable_mixed_chunk=True` and `chunked_prefill_size=8192` (`stages.py:1230`), so running decodes ride along in chunk-prefill steps. With mixed chunk, a pending async decode step is resolved before a mixed prefill is built (see the note in `event_loop_async_decode`).
- **Optional prefill coalescing:** `prefill_coalesce_requests` / `prefill_coalesce_wait_ms` (`prefill_coalesce_holds`, `:2841`) hold a prefill briefly to batch more arrivals. Off by default (`0`).
- **Output:** per step, `emit_stream_output` (`:3128`) → `stream_output_builder` → stream messages. On finish, `stream_output` (`:3361`) → `result_adapter` → result. Both go to the same outbox, so ordering is preserved.
- **Failures:** `run_batch` catches an exception and calls `handle_batch_failure` (`:3271`), which fails only that batch's requests. The scheduler thread keeps running.

### Model-specific subclasses on the speech path

- `QwenTalkerScheduler` (`models/qwen3_omni/talker_scheduler.py:56`): partial-start build readiness, `complete_without_generation` for replies too short to speak, and `update_running_batch` that excludes rows with no next text (they keep KV and rejoin later).
- `Code2WavScheduler` (`components/code2wav_scheduler.py:222`, on `StreamingVocoderBase`): per-request code buffers. `run_ready_step` (`:1081`) decodes, in one replay, the ready windows of the same length across requests once the inbox is drained, and pinned host slots overlap the device-to-host copy with the next window.

## 5. How SGLang's autoregressive engine is integrated

```text
             sglang_omni                                    SGLang (upstream)
Stage ──inbox──► OmniScheduler.recv_requests                 
                 process_input_requests ── request_builder ──► Req (QwenThinkerRequest)
                 waiting_queue.append ───────────────────────► waiting_queue (upstream state, on self)
                 get_next_batch_to_run ── __getattr__ ──────► Scheduler.get_next_batch_to_run(self)
                 _run_batch ── ModelRunner.execute ─────────► ForwardBatch.init_new / TpModelWorker.forward_batch_generation
                 process_batch_result ──────────────────────► Scheduler.process_batch_result(self)
                                       ◄── calls back ──────  self.stream_output(reqs)   (overridden)
Stage ◄─outbox── OutgoingMessage(result | stream)
```

- `OmniScheduler` does not inherit from SGLang's `Scheduler`. `__getattr__` (`omni_scheduler.py:1183`) looks names up on the upstream class and binds them to the `OmniScheduler` instance, so upstream methods read and write `self.waiting_queue`, `self.running_batch`, `self.tree_cache` and so on, all initialized by `init_upstream_scheduler_components`.
- It overrides upstream's ZMQ intake (`recv_requests`), its forward call (`run_batch` → sglang-omni `ModelRunner`, `_run_batch` bridges `ModelRunnerOutput` to `GenerationBatchResult`), and its detokenizer output (`stream_output`).
- Infrastructure (model worker, tree cache, req-to-token pool, KV allocator, model config) comes from `create_sglang_infrastructure` (`scheduling/bootstrap.py:109`) inside the model's bootstrap (`create_thinker_scheduler`, `models/qwen3_omni/bootstrap.py:22`).
- Overlap scheduling is refused (`event_loop_overlap`), per `docs/developer_reference/pipeline.md`. The async-decode lookahead is sglang-omni's own launch/resolve split (`ModelRunner.execute_launch` / `execute_resolve`).

## 6. KV cache and GPU memory

- **One KV pool per AR stage.** The thinker's and talker's KV live in separate pools, sized by each stage's `mem_fraction_static` (or `engine.kv_cache_bytes`). The `OmniKVCacheConfigurator` in `model_runner/sglang_model_runner.py` adapts SGLang's profiling to a GPU shared with other stages.
- **Per-request KV lifetime:** allocated by upstream batch selection; freed when `stream_output` closes a finished request (`close_completed_request`), or by `abort` (`omni_scheduler.py:3814`).
- **Radix (prefix) cache:** upstream's `tree_cache`. Repeated system prompts can hit it. `prompt_cache_epoch` is advanced on weight updates.
- **Colocation budgets:** the thinker reserves `encoder_mem_reserve` (0.05) for encoders on the same GPU (`apply_qwen_thinker_encoder_reserve`). Code2wav takes `gpu_memory_fraction=0.02`. The colocated config takes explicit fractions from its config file.
- **Non-KV memory:** encoder activations, the code2wav model and windows, and relay pools (CUDA IPC slots are sender-owned GPU memory, `relay/cuda_ipc.py`).

## 7. Batch, queue and streaming working together

```text
Coordinator      max_in_flight ───────────────► QueueFullError(503) before submit
Stage            receive lanes (per request × source, in order)
Scheduler inbox  unbounded queue.Queue
OmniScheduler    deferred (not build-ready) → building → waiting_queue (max_queued_requests) → running_batch (max_running_requests)
Batch            upstream picks prefill/decode; talker excludes rows lacking input
Outbox           unbounded; stream + result for one request stay ordered
Stage drain      batches up to _OUTBOX_DRAIN_BATCH_SIZE messages; groups stream runs per target
Coordinator      per-request stream queue (unbounded) + global max_total_backlog_bytes
```

There is no credit-based flow control between stages. Overload is handled by admission caps at the Coordinator and the AR waiting queue, by bounded relay resources on the sender side, and by failing the slowest-reading streams at the Coordinator.

## 8. What moves TTFT, TPOT and throughput (where to look, not numbers)

| Metric | Structural contributors in code | Knobs |
| --- | --- | --- |
| TTFT (text) | serial preprocessing (`max_concurrency=1`), encoder batching wait, fan-in, request build + admission wait (`request_build_admission_wait_s`), waiting-queue position, prefill chunking | preprocessing `max_concurrency`, encoder batch wait, `chunked_prefill_size`, `max_running_requests`, prefill coalescing |
| Time to first audio | the above, plus talker partial start (`partial_start_min_chunks`), talker prefill, early codec frames (`codec_coalesce_early_frames`), code2wav window (`stream_chunk_size`, `initial_codec_chunk_frames`), cross-GPU codec transfer | those factory args; colocated vs split placement |
| TPOT (text) | thinker decode step (CUDA graphs, async-decode lookahead, mixed-chunk interference from new prefills), per-token hops to decode and on to the Coordinator | `enable_mixed_chunk`, `async_decode_min_batch_size`, `max_running_requests` |
| Audio smoothness | talker rows excluded while waiting for thinker text; coalesce size vs window size | `codec_coalesce_frames` (aligned with the code2wav window per the config note) |
| Throughput | thinker/talker batch size caps, KV pool size, GIL contention when stages share a process (see the note in `event_loop_normal`), relay copies | `process=` grouping, `mem_fraction_static`, replicas (`processes.<name>.num_replicas`) |

Measure with the request-level profiler (`docs/developer_reference/profiler.md`): `scheduler_queue_enter` → `scheduler_prefill_start` is queueing, `scheduler_first_emit` is the first token at the thinker, `stage_first_stream_chunk_sent` with `to_stage="coordinator"` is the first byte toward the client, and `code2wav_first_audio` is the first audio.
