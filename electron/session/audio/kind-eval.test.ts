/**
 * The audio kind classifier on the real library.
 *
 *   AUDIO_KIND_EVAL=1 npx vitest run electron/session/audio/kind-eval.test.ts
 *
 * Writes `test-results/audio-sfx.md`: per track, what the sound said, how far
 * apart the two queries were, and how long the embedding took. Opt-in because it
 * embeds 43 tracks at a few seconds each; the pure tests cover the rest.
 *
 * Truth is the rule the product already trusts, not the model's opinion: a track
 * is an effect when it is at most 20 s or tagged `Sound Effects`, music otherwise.
 *
 * @vitest-environment node
 */

import fs from 'node:fs'
import os, { homedir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { audioAvailable, type Embedder, loadEmbedder } from '../embedder'
import { cosine } from '../embedding'
import { decideKindFor, KIND_MARGIN, KIND_QUERIES, type KindAnchors } from '../kindDecision'
import { clipWindow, decodePcm, loadKindAnchors } from './track'

const MODELS = join(homedir(), '.doty', 'models', 'embeddinggemma-2')
const DB = join(homedir(), '.doty', 'doty.db')
const CONFIG = join(homedir(), 'Library', 'Application Support', 'doty', 'config.json')
const RESULTS = join(process.cwd(), 'test-results')
const REPORT = join(RESULTS, 'audio-sfx.md')

interface Row {
  path: string
  genre: string | null
  duration: number | null
}

interface Measured extends Row {
  kind: string
  margin: number
  music: number
  sfx: number
  decodeMs: number
  modelMs: number
  vector?: Float32Array
  error?: string
}

const enabled = process.env.AUDIO_KIND_EVAL === '1' && audioAvailable(MODELS) && fs.existsSync(DB)
const truth = (row: Row) => ((row.duration ?? 0) <= 20 || row.genre === 'Sound Effects' ? 'sfx' : 'music')
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}
const label = (row: Row) => (truth(row) === 'sfx' ? 'effect' : 'music')
const pad = (value: number, width = 5) => value.toFixed(3).padStart(width)

async function measure(
  rows: Row[],
  embedAudio: (pcm: Float32Array) => Promise<Float32Array>,
  anchors: KindAnchors,
  folder: string,
): Promise<Measured[]> {
  const measured: Measured[] = []
  for (const row of rows) {
    const started = performance.now()
    try {
      const pcm = await decodePcm(join(folder, row.path), clipWindow(row.duration))
      const decoded = performance.now()
      const vector = await embedAudio(pcm)
      const embedded = performance.now()
      const decision = decideKindFor(vector, anchors)
      measured.push({
        ...row,
        kind: decision.kind,
        margin: decision.margin,
        music: cosine(vector, anchors.music),
        sfx: cosine(vector, anchors.sfx),
        decodeMs: decoded - started,
        modelMs: embedded - decoded,
        vector,
      })
    } catch (error) {
      measured.push({
        ...row,
        kind: 'uncertain',
        margin: 0,
        music: 0,
        sfx: 0,
        decodeMs: 0,
        modelMs: 0,
        error: String(error),
      })
    }
  }
  return measured
}

function separation(measured: Measured[]) {
  const decided = measured.filter((m) => m.kind !== 'uncertain')
  const right = decided.filter((m) => m.kind === truth(m))
  const wrong = decided.filter((m) => m.kind !== truth(m))
  const onSide = measured.filter((m) => (m.music > m.sfx ? 'music' : 'sfx') === truth(m))
  const short = measured.filter((m) => (m.duration ?? 0) <= 45)
  const shortDecided = short.filter((m) => m.kind !== 'uncertain')
  const mid = measured.filter((m) => (m.duration ?? 0) > 45 && (m.duration ?? 0) < 92)
  const midWrong = mid.filter((m) => m.kind !== 'uncertain' && m.kind !== truth(m))
  return {
    onSide: onSide.length,
    decided,
    right,
    wrong,
    short,
    mid,
    midWrong,
    shortRight: shortDecided.filter((m) => m.kind === truth(m)),
    shortDecided,
  }
}

/** Nearest-neighbour sanity: same kind of cue must be nearer than a different bed. */
function neighbours(measured: Measured[], pairs: string[][]) {
  const find = (part: string) => measured.find((m) => m.path.includes(part))
  return pairs.flatMap(([a, b, c]) => {
    const [va, vb, vc] = [find(a)?.vector, find(b)?.vector, find(c)?.vector]
    if (!va || !vb || !vc) return []
    return [{ a: find(a)!, b: find(b)!, c: find(c)!, near: cosine(va, vb), far: cosine(va, vc) }]
  })
}

function report(measured: Measured[], anchorMs: number): string {
  const s = separation(measured)
  const times = measured.filter((m) => !m.error)
  const lines = [
    '# Audio embeddings: music vs effect on the real library',
    '',
    `- Model: \`${MODELS}\` (fused \`model_q4\` + \`audio_encoder_q4\`)`,
    `- Library: \`${JSON.parse(fs.readFileSync(CONFIG, 'utf8')).musicFolder}\`, ${measured.length} tracks, ${measured.length - times.length} failed to decode`,
    `- Queries: "${KIND_QUERIES.music}" vs "${KIND_QUERIES.sfx}", margin ${KIND_MARGIN}`,
    '- Clip: one 30 s window, from the start when ≤45 s, else 10 % in',
    `- Anchors embedded in ${anchorMs.toFixed(0)} ms; no vector was cached between runs`,
    `- Host: ${os.platform()} ${os.arch()}, ${os.cpus().length} cores, load average ${os.loadavg()[0].toFixed(1)} — timings are an upper bound when it is busy`,
    '',
    '## Separation',
    '',
    `- Right side of the comparison (any margin): **${s.onSide}/${measured.length}**`,
    `- Confident (≥ ${KIND_MARGIN}): **${s.decided.length}**, right **${s.right.length}**, wrong **${s.wrong.length}** (${((s.right.length / (s.decided.length || 1)) * 100).toFixed(0)} % precision)`,
    `- Tracks ≤ 45 s (where duration is not decisive): **${s.shortRight.length}/${s.shortDecided.length}** confident decisions right, ${s.short.length - s.shortDecided.length} uncertain, ${s.shortDecided.length - s.shortRight.length} wrong`,
    `- Tracks 45–92 s: ${s.mid.length}, confident ${s.mid.length - s.mid.filter((m) => m.kind === 'uncertain').length}, wrong ${s.midWrong.length}`,
    '',
    '### Confident mistakes',
    '',
    ...(s.wrong.length === 0
      ? ['- none']
      : s.wrong.map((m) => `- \`${m.path}\` (${m.duration}s, truth ${truth(m)}, margin ${m.margin.toFixed(3)})`)),
    '',
    '## Nearest neighbours',
    '',
    '| track | vs | cosine | vs | cosine |',
    '|---|---|---|---|---|',
    ...neighbours(measured, [
      ['Combat/Boss/The Enemy', 'Combat/Regular Combat/Trailer', 'Exploration/Campfire Peace/Campfire'],
      ['Combat/Boss/Ignition', 'Combat/Regular Combat/Near End Action', 'Walking/Night/Weather - Light Wind'],
    ]).map(
      (n) =>
        `| ${n.a.path.split('/').pop()} | ${n.b.path.split('/').pop()} | ${n.near.toFixed(3)} | ${n.c.path.split('/').pop()} | ${n.far.toFixed(3)} |`,
    ),
    '',
    '## Runtime per track',
    '',
    `- per track (decode + mel + encoder + fused graph): median **${median(times.map((m) => m.decodeMs + m.modelMs)).toFixed(0)} ms**, min ${Math.min(...times.map((m) => m.decodeMs + m.modelMs)).toFixed(0)} ms, max ${Math.max(...times.map((m) => m.decodeMs + m.modelMs)).toFixed(0)} ms`,
    `- of which ffmpeg decode: median ${median(times.map((m) => m.decodeMs)).toFixed(0)} ms; model (mel, encoder, fused graph): median ${median(times.map((m) => m.modelMs)).toFixed(0)} ms`,
    `- total ${(times.reduce((a, m) => a + m.decodeMs + m.modelMs, 0) / 1000).toFixed(1)} s for ${times.length} tracks, one CPU execution provider`,
    '',
    '## Every track',
    '',
    '| truth | kind | margin | music | sfx | decode ms | model ms | track |',
    '|---|---|---|---|---|---|---|---|',
    ...measured.map(
      (m) =>
        `| ${label(m)} | ${m.kind} | ${pad(m.margin)} | ${pad(m.music)} | ${pad(m.sfx)} | ${m.decodeMs.toFixed(0)} | ${m.modelMs.toFixed(0)} | ${m.path} |`,
    ),
    '',
  ]
  return lines.join('\n')
}

describe.skipIf(!enabled)('audio kind evaluation', () => {
  it('measures separation, nearest neighbours and runtime on the library', async () => {
    const folder = JSON.parse(fs.readFileSync(CONFIG, 'utf8')).musicFolder as string
    const db = new Database(DB, { readonly: true })
    const rows = db.prepare('select path, genre, duration from tracks order by path').all() as Row[]
    db.close()

    const model: Embedder = await loadEmbedder(MODELS)
    const embedAudio = model.embedAudio
    if (!embedAudio) throw new Error('the audio encoder is not installed')
    const startedAnchors = performance.now()
    const anchors = (await loadKindAnchors(model)) as KindAnchors
    const anchorMs = performance.now() - startedAnchors

    const measured = await measure(rows, embedAudio, anchors, folder)
    fs.mkdirSync(RESULTS, { recursive: true })
    fs.writeFileSync(REPORT, report(measured, anchorMs))

    // The evaluation must produce a report; the numbers themselves are recorded,
    // not asserted, because they are what a future change is measured against.
    expect(measured.length).toBe(rows.length)
    expect(measured.some((m) => !m.error)).toBe(true)
  }, 1_800_000)
})
