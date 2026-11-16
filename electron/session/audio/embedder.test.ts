/**
 * The audio path against the real model. Skips when the encoder is not installed,
 * so a machine that never downloaded it still runs the pure tests.
 *
 * The first test is the one that matters: our log-mel has to be the extractor's
 * log-mel, down to the frame mask. A frontend that is merely close produces
 * vectors that look fine and mean nothing.
 *
 * @vitest-environment node
 */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { audioAvailable, loadEmbedder } from '../embedder'
import { cosine } from '../embedding'
import { decideKindFor, KIND_QUERIES } from '../kindDecision'
import { logMelSpectrogram } from './mel'
import { decodePcm, embedTrackAudio, loadKindAnchors } from './track'

const DIR = join(homedir(), '.doty', 'models', 'embeddinggemma-2')
const MUSIC = join(homedir(), 'Documents', 'Music')
const EXTRACTOR = join(
  process.cwd(),
  'node_modules/@huggingface/transformers/src/models/gemma4/feature_extraction_gemma4.js',
)
const COMBAT = join(MUSIC, 'Combat/Boss/The Enemy.mp3')
const COMBAT2 = join(MUSIC, 'Combat/Regular Combat/Trailer.mp3')
const CAMPFIRE = join(MUSIC, 'Exploration/Campfire Peace/Campfire.mp3')
const ROAR = join(MUSIC, 'Combat/Regular Combat/Massive Creature Roar.mp3')
const SPEECH = join(process.cwd(), 'test-fixtures/stt/dm-portuguese.wav')

const ready =
  audioAvailable(DIR) && existsSync(COMBAT) && existsSync(COMBAT2) && existsSync(CAMPFIRE) && existsSync(ROAR)

describe.skipIf(!ready)('audio embedder', () => {
  it.skipIf(!existsSync(EXTRACTOR))(
    'computes the same log-mel as the model’s feature extractor',
    async () => {
      // The extractor's own config, not a copy of ours: if they agree, the
      // contract in mel.ts is the contract the graph was exported with.
      const { Gemma4AudioFeatureExtractor } = await import(EXTRACTOR)
      const extractor = new Gemma4AudioFeatureExtractor({
        feature_extractor_type: 'Gemma4AudioFeatureExtractor',
        feature_size: 128,
        fft_length: 512,
        frame_length: 320,
        hop_length: 160,
        min_frequency: 0,
        max_frequency: 8000,
        mel_floor: 0.001,
        sampling_rate: 16000,
        padding_value: 0,
        preemphasis: 0,
        preemphasis_htk_flavor: true,
        dither: 0,
        input_scale_factor: 1,
        padding_side: 'right',
        return_attention_mask: true,
      })
      const pcm = await decodePcm(COMBAT, { seconds: 5, offset: 20 })
      const theirs = await extractor(pcm)
      const mine = logMelSpectrogram(pcm)

      expect(mine.frames).toBe(theirs.input_features.dims[1])
      expect(Array.from(mine.mask)).toEqual(Array.from(theirs.input_features_mask.data as Uint8Array))
      const expected = theirs.input_features.data as Float32Array
      let worst = 0
      for (let i = 0; i < expected.length; i++) worst = Math.max(worst, Math.abs(expected[i] - mine.data[i]))
      expect(worst).toBeLessThan(1e-3)
    },
    120_000,
  )

  it('puts two combat cues nearer each other than a campfire bed', async () => {
    const model = await loadEmbedder(DIR)
    const [combat, combat2, campfire] = await Promise.all([
      embedTrackAudio(model, COMBAT),
      embedTrackAudio(model, COMBAT2),
      embedTrackAudio(model, CAMPFIRE),
    ])
    expect(combat).not.toBeNull()
    expect(combat).toHaveLength(768)
    expect(cosine(combat!, combat2!)).toBeGreaterThan(cosine(combat!, campfire!))
    expect(cosine(combat2!, campfire!)).toBeLessThan(cosine(combat!, combat2!))
  }, 180_000)

  it('lands speech nearer a speech description than the music query', async () => {
    const model = await loadEmbedder(DIR)
    const vector = await embedTrackAudio(model, SPEECH)
    const speaking = await model.embedQuery('a person speaking Portuguese')
    const music = await model.embedQuery(KIND_QUERIES.music)
    expect(cosine(vector!, speaking)).toBeGreaterThan(cosine(vector!, music))
  }, 180_000)

  it('classifies a real effect and refuses a vector from another space', async () => {
    const model = await loadEmbedder(DIR)
    const anchors = await loadKindAnchors(model)
    expect(anchors).not.toBeNull()
    const effect = decideKindFor((await embedTrackAudio(model, ROAR))!, anchors!)
    expect(['sfx', 'uncertain']).toContain(effect.kind)

    const wrongSpace = new Float32Array(64)
    expect(decideKindFor(wrongSpace, anchors!).kind).toBe('uncertain')
  }, 180_000)
})
