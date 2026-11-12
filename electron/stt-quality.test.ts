/**
 * STT quality gate — measures what users actually experience.
 *
 * Runs the shipped decision logic (FlushTracker for streaming models,
 * ChunkBuffer + batch decode for offline models) against Portuguese fixtures
 * and fails on accuracy or speed regressions.
 *
 *   pnpm stt:eval                      # gate (needs downloaded models)
 *   STT_UPDATE_BASELINE=1 pnpm stt:eval  # accept current numbers as baseline
 *
 * Models are skipped when the GGUF is not in ~/.doty/models. Set STT_MODELS to
 * a comma-separated id list to narrow the run.
 *
 * @vitest-environment node
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveLanguage } from './stt-language'
import { addWhiteNoise } from './stt-quality/augment'
import { ChunkBuffer, LiveWriter } from './stt-quality/text-flow'
import { charErrorRate, wordErrorRate } from './stt-quality/wer'

const FIXTURES_DIR = join(__dirname, '..', 'test-fixtures', 'stt')
const MANIFEST_PATH = join(FIXTURES_DIR, 'manifest.json')
const BASELINE_PATH = join(FIXTURES_DIR, 'baseline.json')
const REPORT_PATH = join(__dirname, '..', 'test-results', 'stt-quality.md')
const MODELS_DIR = join(process.env.HOME ?? os.homedir(), '.doty', 'models')
const ffmpegPath: string = require('ffmpeg-static')

/**
 * Kept in sync with `electron/model-paths.ts`. The registry itself imports
 * Electron, which cannot load in a plain Node test.
 */
interface GateModel {
  id: string
  ggufFile: string
  /** Codes the fixture language resolves against ("pt-PT" -> "pt"). */
  languages: string[]
  streaming: boolean
  /** The shipped default must clear the absolute WER bar. */
  absolute: boolean
}

const GATE_MODELS: GateModel[] = [
  {
    id: 'nemotron-3.5-streaming',
    ggufFile: 'nemotron-3.5-asr-streaming-0.6b-Q8_0.gguf',
    languages: ['pt-PT'],
    streaming: true,
    absolute: true,
  },
  {
    id: 'parakeet-ultra',
    ggufFile: 'parakeet-ultra-Q8_0.gguf',
    languages: ['pt'],
    streaming: false,
    absolute: false,
  },
]

/** A regression larger than this (absolute WER) fails the gate. */
const WER_TOLERANCE = 0.03
/**
 * Synthetic noise is the least stable fixture: streaming decoders differ by a
 * few points between Metal implementations (M4 Pro vs the M1 CI runner).
 */
const NOISE_TOLERANCE = 0.05
/** Streaming must decode faster than realtime even on a loaded laptop. */
const MIN_RTF = 1.0
/** Silence must not hallucinate: at most this many words per 5s of silence. */
const MAX_SILENCE_WORDS = 0

interface Fixture {
  file: string
  language: string
  expected: string
  description: string
  /** Absolute WER ceiling for any model offered as the default. */
  maxWer: number
  /** Machine-sensitive fixture: hold a ceiling, not a regression bar. */
  stress?: boolean
  /** Optional legacy field for the older word-overlap test. */
  minOverlap?: number
}

interface BaselineFile {
  generatedAt: string
  machine: string
  results: Record<string, Record<string, { wer: number; cer: number; rtf: number }>>
}

const RUN = process.env.STT_QUALITY === '1'
const UPDATE_BASELINE = process.env.STT_UPDATE_BASELINE === '1'
const only = (process.env.STT_MODELS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

function readWav16k(path: string): Float32Array {
  const out = join(os.tmpdir(), `stt-eval-${process.pid}-${Math.random().toString(36).slice(2)}.wav`)
  try {
    execFileSync(ffmpegPath, ['-y', '-loglevel', 'error', '-i', path, '-ar', '16000', '-ac', '1', '-f', 'wav', out])
    const buf = fs.readFileSync(out)
    let offset = 12
    while (offset < buf.length - 8) {
      const id = buf.toString('ascii', offset, offset + 4)
      const size = buf.readUInt32LE(offset + 4)
      if (id === 'data') {
        const n = size / 2
        const samples = new Float32Array(n)
        for (let i = 0; i < n; i++) samples[i] = buf.readInt16LE(offset + 8 + i * 2) / 32768
        return samples
      }
      offset += 8 + size + (size % 2)
    }
    throw new Error(`No data chunk in ${path}`)
  } finally {
    fs.rmSync(out, { force: true })
  }
}

interface ModelRun {
  text: string
  rtf: number
  /** Latency from audio arriving to text being appended (streaming only). */
  firstTextMs: number | null
}

/**
 * Mirrors transcribe-worker.ts: streaming models use a FlushTracker over
 * 500ms chunks; offline models accumulate 10s chunks and batch-decode them.
 */
async function runModel(
  session: any,
  pcm: Float32Array,
  language: string | undefined,
  streaming: boolean,
): Promise<ModelRun> {
  const started = performance.now()
  const parts: string[] = []
  let firstTextMs: number | null = null

  if (streaming) {
    const stream = await session.stream({
      commitPolicy: 'stable_prefix',
      ...(language ? { language } : {}),
    })
    const writer = new LiveWriter()
    writer.reset(0)
    const hop = 8000
    let lastChangeMs = 0
    for (let i = 0; i < pcm.length; i += hop) {
      await stream.feed(pcm.subarray(i, Math.min(i + hop, pcm.length)))
      const nowMs = (Math.min(i + hop, pcm.length) / 16000) * 1000
      const full: string = stream.text.full ?? ''
      if (full) lastChangeMs = nowMs
      let delta = writer.onHypothesis(full, nowMs)
      if (!delta && nowMs - lastChangeMs >= 1500) delta = writer.onSilence(full, nowMs)
      if (delta) {
        parts.push(delta)
        if (firstTextMs === null) firstTextMs = performance.now() - started
      }
    }
    await stream.finalize()
    const tail = writer.onFinal(stream.text.full ?? '')
    if (tail) parts.push(tail)
    try {
      stream.reset()
    } catch {
      /* ignore */
    }
  } else {
    const chunks = new ChunkBuffer({ maxSamples: 16000 * 10 })
    const hop = 8000
    for (let i = 0; i < pcm.length; i += hop) {
      chunks.push(pcm.subarray(i, Math.min(i + hop, pcm.length)))
      if (chunks.ready()) {
        const chunk = chunks.take()
        const result = await session.run(chunk, language ? { language } : undefined)
        if (result.text.trim()) {
          parts.push(result.text.trim())
          if (firstTextMs === null) firstTextMs = performance.now() - started
        }
      }
    }
    if (chunks.pendingSamples > 1600) {
      while (chunks.pendingSamples > 1600) {
        const result = await session.run(chunks.take(), language ? { language } : undefined)
        if (result.text.trim()) parts.push(result.text.trim())
      }
    }
  }

  const elapsed = (performance.now() - started) / 1000
  return { text: parts.join(' ').trim(), rtf: pcm.length / 16000 / elapsed, firstTextMs }
}

function loadBaseline(): BaselineFile {
  try {
    return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf-8'))
  } catch {
    return { generatedAt: '', machine: '', results: {} }
  }
}

describe.skipIf(!RUN)('STT quality gate', { timeout: 900_000 }, () => {
  const fixtures: Fixture[] = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'))
  const baseline = loadBaseline()
  const models = GATE_MODELS.filter((m) => !only.length || only.includes(m.id))
  const report: string[] = [
    `# STT quality gate`,
    '',
    `Machine: ${os.cpus()[0]?.model ?? 'unknown'} · ${new Date().toISOString()}`,
    '',
    '| model | fixture | WER | CER | xRT | first text | baseline WER |',
    '|---|---|---:|---:|---:|---:|---:|',
  ]

  for (const info of models) {
    const modelPath = join(MODELS_DIR, info.ggufFile)
    const ready = fs.existsSync(modelPath)

    for (const fixture of fixtures) {
      it(`${info.id} / ${fixture.file}`, async () => {
        if (!ready) return
        const { TranscribeModel } = await import('transcribe-cpp')
        const model = await TranscribeModel.load(modelPath, { backend: 'auto' })
        try {
          const session = model.createSession()
          const caps = model.capabilities
          const language = resolveLanguage(fixture.language, info.languages)
          const pcm = readWav16k(join(FIXTURES_DIR, fixture.file))
          const run = await runModel(session, pcm, language, Boolean(caps.supportsStreaming))
          const wer = wordErrorRate(fixture.expected, run.text)
          const cer = charErrorRate(fixture.expected, run.text)

          const prev = baseline.results[info.id]?.[fixture.file]
          const latency = !info.streaming
            ? 'chunked ≤10s'
            : run.firstTextMs === null
              ? 'at finalize'
              : `${Math.round(run.firstTextMs)}ms`
          report.push(
            `| ${info.id} | ${fixture.file} | ${(wer.rate * 100).toFixed(1)}% | ${(cer.rate * 100).toFixed(1)}% | ${run.rtf.toFixed(1)} | ${
              latency
            } | ${prev ? `${(prev.wer * 100).toFixed(1)}%` : 'new'} |`,
          )

          if (UPDATE_BASELINE) {
            baseline.results[info.id] ??= {}
            baseline.results[info.id][fixture.file] = { wer: wer.rate, cer: cer.rate, rtf: run.rtf }
          } else {
            // Absolute ceiling: the default must be good enough to ship, and
            // every model must stay under a stress fixture's loose ceiling.
            if (info.absolute || fixture.stress) {
              expect(
                wer.rate,
                `${info.id} on ${fixture.file} must be <= ${fixture.maxWer * 100}% WER`,
              ).toBeLessThanOrEqual(fixture.maxWer)
            }
            // Regression: no worse than the accepted baseline.
            if (prev && !fixture.stress) {
              expect(
                wer.rate,
                `${info.id} on ${fixture.file} regressed from ${(prev.wer * 100).toFixed(1)}%`,
              ).toBeLessThanOrEqual(prev.wer + WER_TOLERANCE)
            }
          }
          // Speed matters over a session, not on a 4s clip where first-decode
          // warmup dominates; only gate long audio.
          if (pcm.length >= 16000 * 20) {
            expect(run.rtf, `${info.id} must decode faster than realtime`).toBeGreaterThanOrEqual(MIN_RTF)
          }
        } finally {
          model.dispose()
        }
      })
    }

    it(`${info.id} / conference mic + background noise`, async () => {
      if (!ready) return
      const dm = fixtures.find((f) => f.file === 'dm-portuguese.wav')
      if (!dm) return
      const { TranscribeModel } = await import('transcribe-cpp')
      const model = await TranscribeModel.load(modelPath, { backend: 'auto' })
      try {
        const session = model.createSession()
        const language = resolveLanguage(dm.language, info.languages)
        // 12 dB SNR white noise: a far-field conference mic in a room with HVAC
        // and chair noise. Real recordings should replace this (docs/QUALITY.md).
        const pcm = addWhiteNoise(readWav16k(join(FIXTURES_DIR, dm.file)), 12, 42)
        const run = await runModel(session, pcm, language, Boolean(model.capabilities.supportsStreaming))
        const wer = wordErrorRate(dm.expected, run.text)
        const key = 'dm-noise-12db'
        const prev = baseline.results[info.id]?.[key]
        report.push(
          `| ${info.id} | ${key} | ${(wer.rate * 100).toFixed(1)}% | ${(charErrorRate(dm.expected, run.text).rate * 100).toFixed(1)}% | ${run.rtf.toFixed(1)} | ${
            info.streaming ? 'live' : 'chunked ≤10s'
          } | ${prev ? `${(prev.wer * 100).toFixed(1)}%` : 'new'} |`,
        )
        if (UPDATE_BASELINE) {
          baseline.results[info.id] ??= {}
          baseline.results[info.id][key] = {
            wer: wer.rate,
            cer: charErrorRate(dm.expected, run.text).rate,
            rtf: run.rtf,
          }
        } else {
          if (info.absolute) {
            expect(wer.rate, `${info.id} on a noisy room must be <= 32% WER`).toBeLessThanOrEqual(0.32)
          }
          if (prev) {
            expect(wer.rate, `${info.id} got worse in noise`).toBeLessThanOrEqual(prev.wer + NOISE_TOLERANCE)
          }
        }
      } finally {
        model.dispose()
      }
    })

    it(`${info.id} / silence must not hallucinate`, async () => {
      if (!ready) return
      const { TranscribeModel } = await import('transcribe-cpp')
      const model = await TranscribeModel.load(modelPath, { backend: 'auto' })
      try {
        const session = model.createSession()
        const language = resolveLanguage('pt-PT', info.languages)
        const silence = new Float32Array(16000 * 5)
        const run = await runModel(session, silence, language, Boolean(model.capabilities.supportsStreaming))
        const words = run.text.split(/\s+/).filter(Boolean)
        expect(words.length, `${info.id} invented text on silence: "${run.text}"`).toBeLessThanOrEqual(
          MAX_SILENCE_WORDS,
        )
      } finally {
        model.dispose()
      }
    })
  }

  it('writes the report', () => {
    if (UPDATE_BASELINE) {
      baseline.generatedAt = new Date().toISOString()
      baseline.machine = os.cpus()[0]?.model ?? 'unknown'
      fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`)
    }
    fs.mkdirSync(join(__dirname, '..', 'test-results'), { recursive: true })
    fs.writeFileSync(REPORT_PATH, `${report.join('\n')}\n`)
  })
})
