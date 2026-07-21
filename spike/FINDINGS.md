# Spike #79: transcribe-cpp in Electron Worker Thread

## Result: PASS

transcribe-cpp streaming transcription works in a Node.js Worker thread with Metal GPU acceleration on macOS.

## Key Findings

### Installation
- `pnpm add transcribe-cpp` — installs the main package + platform-specific `@transcribe-cpp/darwin-arm64-metal`
- `koffi` (FFI library) needs build scripts approved: add to `pnpm.onlyBuiltDependencies` in package.json
- No `electron-rebuild` needed — koffi is a standalone N-API addon, not Electron-version-dependent
- Platform package contains: `libtranscribe.dylib`, `libggml.dylib`, `libggml-base.dylib`, `libggml-cpu.dylib`, `libggml-metal.dylib`

### ESM Compatibility
- `transcribe-cpp` is **ESM-only** (no CJS exports)
- electron-vite builds main process as CJS
- **Solution**: use dynamic `import('transcribe-cpp')` from the worker — works from CJS context
- Worker file can be `.mjs` or use dynamic import in a `.ts` file compiled to CJS

### Metal Backend
- Auto-detected on Apple Silicon (M4 Pro confirmed)
- `getAvailableBackends()` returns `[{ kind: 'metal', name: 'MTL0', ... }, { kind: 'cpu', ... }]`
- `backendAvailable('metal')` → true
- `backend: 'auto'` selects Metal automatically

### Performance (parakeet-unified-en-0.6b-Q8_0, 731MB)
- Model load: **162ms**
- 6.17s audio batch transcription: **333ms** (18.5× realtime)
- Streaming (500ms chunks): committed text appears after ~2.5s of audio, grows incrementally
- Streaming finalize completes trailing text instantly

### Streaming API
```typescript
const model = await TranscribeModel.load(path, { backend: 'auto' });
const session = model.createSession();
const stream = await session.stream({ commitPolicy: 'stable_prefix' });

// Feed PCM chunks (Float32Array, 16kHz mono)
await stream.feed(chunk);
const { committed, tentative } = stream.text;
// committed = stable, won't change
// tentative = might be revised

await stream.finalize(); // flush remaining audio
stream.reset();          // release model lease
```

### Packaging for Electron
- `artifactDir()` returns path to native libs directory
- For electron-builder:
  ```json
  {
    "asarUnpack": ["node_modules/@transcribe-cpp/**", "node_modules/koffi/**"],
    "extraResources": [{
      "from": "node_modules/@transcribe-cpp/darwin-arm64-metal",
      "to": "transcribe-cpp",
      "filter": ["**/*"]
    }]
  }
  ```
- Alternative: libs stay in node_modules (already asarUnpacked), and the binding's loader finds them via the standard resolution path

### Worker Thread Cleanup
- Do NOT call `process.exit()` from the worker after `model.dispose()` — causes Metal assertion failure during GPU resource teardown
- Let the worker terminate naturally (close the message port, or let the main thread call `worker.terminate()`)

### Model Compatibility
- Streaming requires a streaming-capable model (e.g., `parakeet-unified-en-0.6b`, `nemotron-*-streaming-*`)
- Batch-only models (e.g., `parakeet-tdt_ctc-110m`) throw `NotImplementedByModel` on `stream()`
- Single GGUF file per model — no multi-file extraction needed

### What We Can Remove
- `sherpa-onnx-node` dependency + electron-rebuild for it
- `voxtral-child.ts` (transformers.js) — voxtral-realtime now runs via transcribe-cpp GGUF
- `voxmlx-child.ts` + `voxmlx-bridge.py` — MLX path no longer needed
- Silero VAD ONNX model — streaming models handle silence (emit nothing when no speech)
- GTCRN denoiser — models are robust to noise; Handy doesn't use a denoiser either
- Multiple model file formats (encoder.onnx, decoder.onnx, joiner.onnx, tokens.txt) → single .gguf

### electron-vite Config Change
Add new worker entry:
```typescript
rollupOptions: {
  input: {
    // ...existing entries...
    'transcribe-worker': resolve(__dirname, 'electron/transcribe-worker.ts'),
  },
}
```

### VAD Decision
With streaming transcription, traditional VAD (segment → transcribe) is unnecessary. The streaming model emits nothing during silence. For endpoint detection (knowing when to split text into session segments), a simple silence timeout on committed text works:
- If no new committed text for N seconds → segment boundary
- This replaces the entire Silero VAD + segment pipeline
