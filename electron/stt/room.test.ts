/**
 * Room-mode STT gate: what a laptop mic in a real D&D room has to survive.
 *
 * These are the model-backed checks behind `test-results/stt-room.md`. They skip
 * cleanly when the GGUFs are not in ~/.doty/models, so the unit suite still runs
 * on a fresh checkout. Fixtures come from `test-fixtures/stt`; the non-speech
 * signals are generated with ffmpeg, so no audio is committed to measure the
 * case that matters (music playing through the same speakers as the mic).
 *
 *   npx vitest run electron/stt/room.test.ts
 *
 * @vitest-environment node
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { type LanguageGuess, preferredCodes, rejectsLanguage } from '../stt-language'
import { SpeechGate } from '../stt-quality/vad-gate'

const FIXTURES = join(__dirname, '..', '..', 'test-fixtures', 'stt')
const MODELS = join(homedir(), '.doty', 'models')
const VAD_MODEL = join(MODELS, 'silero-vad-v6.2-F32.gguf')
const LANGID_MODEL = join(MODELS, 'lang-id-voxlingua107-ecapa-Q8_0.gguf')
const ASR_MODEL = join(MODELS, 'parakeet-ultra-Q8_0.gguf')
const ffmpegPath: string = require('ffmpeg-static')

const haveVad = fs.existsSync(VAD_MODEL)
const haveLangid = fs.existsSync(LANGID_MODEL)
const haveAsr = fs.existsSync(ASR_MODEL)

/** 500 ms chunks, the size `asr.ts` feeds the worker. */
const HOP = 8000

function readWav16k(path: string): Float32Array {
  const out = join(fs.mkdtempSync(join(process.env.TMPDIR ?? '/tmp', 'room-')), 'a.wav')
  execFileSync(ffmpegPath, ['-y', '-loglevel', 'error', '-i', path, '-ar', '16000', '-ac', '1', '-f', 'wav', out])
  const buf = fs.readFileSync(out)
  fs.rmSync(join(out, '..'), { recursive: true, force: true })
  let offset = 12
  while (offset < buf.length - 8) {
    const id = buf.toString('ascii', offset, offset + 4)
    const size = buf.readUInt32LE(offset + 4)
    if (id === 'data') {
      const samples = new Float32Array(size / 2)
      for (let i = 0; i < samples.length; i++) samples[i] = buf.readInt16LE(offset + 8 + i * 2) / 32768
      return samples
    }
    offset += 8 + size + (size % 2)
  }
  throw new Error(`No data chunk in ${path}`)
}

/**
 * A music bed through the same speakers as the mic: loud, harmonic, no speech.
 * Not a substitute for a real recording, but it is deterministic and it is what
 * the RMS gate cannot tell apart from the DM.
 */
function musicOnly(seconds = 10): Float32Array {
  const out = join(fs.mkdtempSync(join(process.env.TMPDIR ?? '/tmp', 'room-')), 'music.wav')
  const chord = '0.25*sin(2*PI*220*t)+0.2*sin(2*PI*277*t)+0.2*sin(2*PI*330*t)'
  const beat = '0.15*sin(2*PI*110*t)*(1+0.9*sin(2*PI*1.9*t))'
  execFileSync(ffmpegPath, [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    `aevalsrc='${chord}+${beat}':s=16000:d=${seconds}`,
    '-ar',
    '16000',
    '-ac',
    '1',
    out,
  ])
  const pcm = readWav16k(out)
  fs.rmSync(join(out, '..'), { recursive: true, force: true })
  return pcm
}

/** Fan noise from the laptop's own cooling: broadband, no harmonic structure. */
function roomNoise(seconds = 10): Float32Array {
  const out = join(fs.mkdtempSync(join(process.env.TMPDIR ?? '/tmp', 'room-')), 'noise.wav')
  execFileSync(ffmpegPath, [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    `anoisesrc=color=pink:amplitude=0.2:d=${seconds}:seed=3`,
    '-ar',
    '16000',
    '-ac',
    '1',
    out,
  ])
  const pcm = readWav16k(out)
  fs.rmSync(join(out, '..'), { recursive: true, force: true })
  return pcm
}

/** Feed a whole clip through the live VAD path, exactly as the worker does. */
async function liveGate(vadSession: any, pcm: Float32Array, batch = false): Promise<Float32Array[]> {
  const gate = new SpeechGate(batch ? { maxSamples: 16000 * 10 } : { emitSamples: 16000 * 0.16 })
  await vadSession.streamReset()
  const chunks: Float32Array[] = []
  for (let i = 0; i < pcm.length; i += HOP) {
    const chunk = pcm.subarray(i, Math.min(i + HOP, pcm.length))
    const { probs } = await vadSession.streamFeed(chunk)
    gate.push(chunk, probs)
    chunks.push(...gate.drain().chunks)
  }
  const tail = await vadSession.streamFlush()
  gate.push(new Float32Array(0), tail.probs)
  chunks.push(...gate.flush().chunks)
  return chunks
}

const seconds = (chunks: Float32Array[]) => chunks.reduce((n, c) => n + c.length, 0) / 16000

describe.skipIf(!haveVad)('Silero VAD — speech gating', { timeout: 120_000 }, () => {
  const load = async () =>
    (await import('transcribe-cpp')).TranscribeModel.load(VAD_MODEL, { backend: 'cpu' }) as Promise<any>

  it.skipIf(!haveVad)('never lets music, fan noise or silence reach a decoder', async () => {
    const model = await load()
    try {
      const vad = model.createVadSession()
      const cases = [
        { name: 'music only', pcm: musicOnly() },
        { name: 'pink room noise', pcm: roomNoise() },
        { name: 'digital silence', pcm: new Float32Array(16000 * 10) },
      ]
      for (const c of cases) {
        const offline = await vad.run(c.pcm)
        const live = await liveGate(vad, c.pcm)
        const peak = offline.probs.reduce((n: number, p: number) => Math.max(n, p), 0)
        console.log(
          `[vad] ${c.name}: ${c.pcm.length / 16000}s → ${offline.segments.length} segments, ${seconds(live).toFixed(2)}s gated speech, max p ${peak.toFixed(3)}`,
        )
        expect(offline.segments, `${c.name} must not be segmented as speech`).toHaveLength(0)
        expect(live, `${c.name} must not be emitted to the decoder`).toHaveLength(0)
      }
      vad.dispose()
    } finally {
      model.dispose()
    }
  })

  it.skipIf(!haveVad)('keeps speech while dropping the music-masked bed', async () => {
    const model = await load()
    try {
      const vad = model.createVadSession()
      for (const file of ['dm-portuguese.wav', 'dragon-portuguese.wav', 'gato-portuguese.wav']) {
        const pcm = readWav16k(join(FIXTURES, file))
        const offline = await vad.run(pcm)
        const live = await liveGate(vad, pcm)
        const speech = offline.segments.reduce((n: number, s: any) => n + (s.endSample - s.startSample), 0) / 16000
        console.log(
          `[vad] ${file}: ${(pcm.length / 16000).toFixed(1)}s → ${offline.segments.length} segments = ${speech.toFixed(2)}s, live gate ${seconds(live).toFixed(2)}s`,
        )
        expect(offline.segments.length, `${file} has speech and must be kept`).toBeGreaterThan(0)
        // The live gate must see the same speech, minus sub-segment granularity.
        expect(seconds(live)).toBeGreaterThan(speech * 0.8)
        expect(seconds(live)).toBeLessThanOrEqual(pcm.length / 16000)
      }
      vad.dispose()
    } finally {
      model.dispose()
    }
  })
})

/**
 * LANGID is deliberately NOT wired into the live path: measured on the fixtures,
 * it labels 5 of 17 real Portuguese VAD segments as Albanian/Catalan with
 * p >= 0.82, so the veto in `stt-language.ts` would delete a third of the DM's
 * narration. This test records that evidence; if it ever stops holding, the veto
 * can be reconsidered.
 */
describe.skipIf(!haveLangid)('VoxLingua107 — why the language veto is off', { timeout: 120_000 }, () => {
  it.skipIf(!haveLangid)('mislabels real Portuguese segments often enough to be unusable as a filter', async () => {
    const { TranscribeModel } = await import('transcribe-cpp')
    const model = (await TranscribeModel.load(LANGID_MODEL, { backend: 'auto' })) as any
    const vadModel = haveVad ? ((await TranscribeModel.load(VAD_MODEL, { backend: 'cpu' })) as any) : null
    const guessOf = (r: any): LanguageGuess => ({ code: r.code ?? null, probability: r.candidates?.[0]?.p ?? 0 })
    const preferred = preferredCodes('pt-PT')

    const segmentsOf = async (
      lid: any,
      pcm: Float32Array,
    ): Promise<Array<{ guess: LanguageGuess; seconds: number }>> => {
      if (!vadModel) return []
      const vad = vadModel.createVadSession()
      try {
        const { segments } = await vad.run(pcm)
        const out: Array<{ guess: LanguageGuess; seconds: number }> = []
        for (const s of segments as any[]) {
          const piece = pcm.subarray(s.startSample, s.endSample)
          if (piece.length < 16000 * 0.6) continue
          out.push({ guess: guessOf(await lid.run(piece)), seconds: piece.length / 16000 })
        }
        return out
      } finally {
        vad.dispose()
      }
    }

    try {
      const lid = model.createLangIdSession()
      const rows: string[] = []
      let segments = 0
      let rejectable = 0
      for (const file of ['dm-portuguese.wav', 'dragon-portuguese.wav', 'gato-portuguese.wav']) {
        const pcm = readWav16k(join(FIXTURES, file))
        const whole = guessOf(await lid.run(pcm))
        rows.push(`${file} → ${whole.code} ${whole.probability.toFixed(2)}`)
        // The whole utterance is the only shape LANGID gets right.
        expect(rejectsLanguage(whole, preferred), `${file} is Portuguese and cannot be deleted`).toBe(false)

        for (const { guess, seconds: secondsLong } of await segmentsOf(lid, pcm)) {
          segments++
          if (!rejectsLanguage(guess, preferred)) continue
          rejectable++
          rows.push(`${secondsLong.toFixed(1)}s segment → ${guess.code} ${guess.probability.toFixed(2)}`)
        }
      }

      console.log(`[langid] ${rows.join(' | ')}`)
      console.log(`[langid] the veto would have deleted ${rejectable} of ${segments} real Portuguese segments`)
      expect(segments, 'the fixtures must produce decodable segments').toBeGreaterThan(10)
      expect(rejectable, 'if this is 0, reconsider enabling the langid veto').toBeGreaterThan(0)
      lid.dispose()
    } finally {
      model.dispose()
      vadModel?.dispose()
    }
  })
})

describe.skipIf(!haveVad || !haveAsr)('room microphone → transcript', { timeout: 300_000 }, () => {
  it.skipIf(!haveVad || !haveAsr)('decodes no words from a music bed alone', async () => {
    const { TranscribeModel } = await import('transcribe-cpp')
    const asr = (await TranscribeModel.load(ASR_MODEL, { backend: 'auto' })) as any
    const vadModel = (await TranscribeModel.load(VAD_MODEL, { backend: 'cpu' })) as any
    try {
      const vad = vadModel.createVadSession()
      const session = asr.createSession()
      const pcm = musicOnly(10)
      const speech = await liveGate(vad, pcm, true)
      const texts: string[] = []
      for (const chunk of speech) {
        const text = ((await session.run(chunk, { language: 'pt' })).text ?? '').trim()
        if (text) texts.push(text)
      }
      // The old path decoded this clip into a whole sentence, in whichever
      // language the forced hint was.
      const ungated = ((await session.run(pcm, { language: 'pt' })).text ?? '').trim()
      console.log(`[room] music 10s → gated speech ${seconds(speech).toFixed(2)}s → "${texts.join(' ')}"`)
      console.log(`[room] music 10s → ungated text: "${ungated}"`)
      expect(texts.join(' ')).toBe('')
      vad.dispose()
    } finally {
      asr.dispose()
      vadModel.dispose()
    }
  })

  it.skipIf(!haveVad || !haveAsr)('still transcribes a Portuguese monologue through the gate', async () => {
    const { TranscribeModel } = await import('transcribe-cpp')
    const asr = (await TranscribeModel.load(ASR_MODEL, { backend: 'auto' })) as any
    const vadModel = (await TranscribeModel.load(VAD_MODEL, { backend: 'cpu' })) as any
    try {
      const vad = vadModel.createVadSession()
      const session = asr.createSession()
      const pcm = readWav16k(join(FIXTURES, 'dm-portuguese.wav'))
      const speech = await liveGate(vad, pcm, true)
      const texts: string[] = []
      for (const chunk of speech) {
        const text = ((await session.run(chunk, { language: 'pt' })).text ?? '').trim()
        if (text) texts.push(text)
      }
      const gated = texts.join(' ')
      const ungated = ((await session.run(pcm, { language: 'pt' })).text ?? '').trim()
      const words = (s: string) => s.split(/\s+/).filter(Boolean)
      console.log(`[room] dm ${seconds(speech).toFixed(1)}s gated → ${words(gated).length} words`)
      console.log(`[room] dm ${(pcm.length / 16000).toFixed(1)}s ungated → ${words(ungated).length} words`)
      // Gating must not cost most of the transcript: the reference is 76 words.
      expect(words(gated).length).toBeGreaterThan(40)
      vad.dispose()
    } finally {
      asr.dispose()
      vadModel.dispose()
    }
  })
})
