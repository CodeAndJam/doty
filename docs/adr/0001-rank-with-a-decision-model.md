# Rank tracks with a decision model, not a generative one

Doty's recommendation used two models: a Qwen3-0.6B scene interpreter that wrote a prose scene
description, a mood, an intensity and keywords from the last 3000 characters of transcript, and a
MiniLM cross-encoder that ordered tracks. Both were replaced by one decision model — Liquid AI's
d1-omni-600M, self-exported to ONNX at build time from the weights and reference code in its
Hugging Face repo — asked a single `choice` question: which of these 20 candidates best fits this
transcript. It runs on the `onnxruntime-node` dependency the app already had, in a worker thread,
against a file we host and download into `~/.doty/models/`. The generative stack it replaced was
deleted rather than kept dormant.

Status: accepted

## Considered Options

- **Keep the scene interpreter, swap only the cross-encoder.** Rejected: two models, two runtimes,
  and the scene interpreter's only consumer was a vector search that the ranker now answers directly.
- **Bundle the Ollaya daemon, which hosts these models.** Rejected: a second native binary, a
  loopback HTTP hop, and a second listening port, to gain nothing — no Ollaya model ships a runnable
  ONNX file (every `*.graph.onnx` in their registry is a 2–5 MB decision head pointing at the
  author's safetensors; the encoder lives in their Rust binary), so their daemon buys no head start
  on the export we needed anyway.
- **DeBERTa-v3 zero-shot NLI through the already-installed `@huggingface/transformers`.** Kept as the
  fallback if the export blocks. Rejected as the default: 512-token limit, one forward pass per
  candidate, and ~2.3 s per request on a CPU.
- **MLX on Apple silicon.** Rejected: no Node binding; it would mean a native addon over `mlx-c` or a
  Swift sidecar, for hardware reach that `onnxruntime-node`'s CoreML EP already covers.
- **ONNX Runtime Web with WebGPU in the renderer.** Rejected: a 1.2 GB fp16 encoder exceeds WebGPU's
  default `maxBufferSize` and needs split buffers plus a full re-upload on every renderer reload, all
  to duplicate a GPU path the main process already has.
- **Let the decision model score the whole library (it takes up to 255 options).** Rejected: the
  keyword/tag/BPM prefilter is the cheap part, it keeps the model call short, and it is what works
  while the model is still downloading.

## Consequences

- The app no longer contains a generative model. `node-llama-cpp`, the nomic embedding model,
  `sqlite-vec` track vectors, the scene interpreter, and the mood/intensity display all go with it.
- The shipped artifact is now ours to build and host: an export script, a parity gate against the
  PyTorch reference, and an int8 or fp16 file of roughly 600 MB – 1.2 GB as a release asset.
- Ranking happens on a terse description of each candidate, not prose. d1-omni gives every option 24
  tokens, so the track description is a budget, not a paragraph.
- An override by hand silences the ranker rather than competing with it — there is no track to
  resume from, and a recommendation nobody would act on is a wasted pass.
- The LFM Open License v1.0 on the weights requires a separate agreement with Liquid AI for
  commercial use by an organisation with US$10M or more in annual revenue. Doty is open source, so
  this is recorded, not blocking.
