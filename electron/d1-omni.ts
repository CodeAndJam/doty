/**
 * d1-omni.ts — the decision model that ranks the candidate tracks.
 *
 * The graph is fixed-shape (see `scripts/export-d1-omni.py`): 1024 tokens, 20
 * option markers, right-padded. This module reproduces the author's `prompt.py`
 * byte for byte, so a row built here gets the same answer PyTorch gave it.
 * `d1-omni.test.ts` replays the export's fixture to prove that.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Tokenizer } from '@huggingface/tokenizers'
import * as ort from 'onnxruntime-node'

/**
 * The question every plan is ranked against. Portuguese because the table talks
 * Portuguese: the model reads the options in the language it answers in.
 */
export const RANK_INSTRUCTIONS = 'Qual destas músicas se adequa melhor ao momento atual da sessão?'

/** The second question: what is happening, in the vocabulary the scene machine uses. */
export const MOOD_INSTRUCTIONS = 'Que tipo de cena está a acontecer agora?'

export const MOODS = [
  'combat',
  'chase',
  'tense',
  'horror',
  'mystery',
  'exploration',
  'tavern',
  'celebration',
  'sad',
  'epic',
  'peaceful',
  'voyage',
  'stealth',
] as const

export interface D1Manifest {
  family: string
  context_length: number
  /** What the checkpoint reads. A session outside this list is not ranked by it. */
  languages?: string[]
  per_option_tokens: number
  shape: { seq: number; options: number }
  temperatures: Record<string, number>
  tokens: Record<'state' | 'q' | 'opt' | 'opt_end' | 'decide' | 'mask' | 'bos', number>
  graphs: Record<string, { bytes: number; sha256: string }>
}

export interface D1Row {
  ids: number[]
  markers: number[]
}

/** `<|name|>` -> `<¦name¦>`, so a transcript can never forge a delimiter or marker. */
export function escapeDelimiters(text: string): string {
  return text.replace(/<\|([A-Za-z0-9_]+)\|>/g, '<¦$1¦>')
}

function serialize(state: unknown): string {
  return typeof state === 'string' ? state : JSON.stringify(state)
}

/**
 * One question over one state, exactly as `prompt.encode` builds it: the option
 * block takes at most 24 tokens per option, and the state is truncated to what
 * is left. `maxLen` is the graph's fixed sequence length, not the model's
 * advertised context.
 */
export function buildRow(
  tokenize: (text: string) => number[],
  state: string,
  instructions: string,
  options: string[],
  tokens: D1Manifest['tokens'],
  maxLen: number,
  perOption = 24,
): D1Row {
  const budget = Math.max(96, Math.min(options.length * perOption + 32, Math.floor(maxLen / 2)))
  const per = Math.max(2, Math.floor((budget - 3 * options.length) / options.length))

  const question = [tokens.q, ...tokenize(instructions)].slice(0, Math.max(16, budget))
  const markers: number[] = []
  for (const text of options) {
    markers.push(question.length + 1)
    question.push(tokens.opt, tokens.mask, ...tokenize(` ${text}`).slice(0, per), tokens.opt_end)
  }
  question.push(tokens.decide)

  const room = Math.max(0, maxLen - question.length - 2)
  const stateIds = [tokens.state, ...tokenize(serialize(state)).slice(0, room)]
  const ids = [tokens.bos, ...stateIds, ...question].slice(0, maxLen)

  return { ids, markers: markers.map((m) => m + 1 + stateIds.length) }
}

/** The author's per-question-type temperature; choice with 11+ options is the 20-candidate case. */
export function temperatureFor(temperatures: Record<string, number>, optionCount: number, type = 'choice'): number {
  const bucket = optionCount <= 2 ? '2' : optionCount <= 5 ? '3-5' : optionCount <= 10 ? '6-10' : '11+'
  return temperatures[`${type}:${bucket}`] ?? temperatures[type] ?? 1
}

/** Logits over the real options, temperature-scaled and softmaxed. */
export function toProbabilities(logits: number[], optionCount: number, temperature: number): number[] {
  const z = logits.slice(0, optionCount).map((v) => v / temperature)
  const top = Math.max(...z)
  const e = z.map((v) => Math.exp(v - top))
  const sum = e.reduce((a, b) => a + b, 0)
  return e.map((v) => v / sum)
}

export class D1Omni {
  private constructor(
    private readonly session: ort.InferenceSession,
    private readonly tokenize: (text: string) => number[],
    readonly manifest: D1Manifest,
  ) {}

  static async load(
    dir: string,
    graph = 'd1-omni-text.onnx',
    providers: string[] = ['coreml', 'cpu'],
  ): Promise<D1Omni> {
    const manifest = JSON.parse(readFileSync(join(dir, 'd1-omni-text-manifest.json'), 'utf8')) as D1Manifest
    if (!manifest.graphs[graph]) throw new Error(`d1-omni: ${graph} is not in the manifest`)

    // transformers.js is not imported here on purpose: it pins its own onnxruntime-node,
    // and two ORT copies in one thread terminates the process with a Napi::Error.
    // The delimiter ids come from the manifest, so the tokenizer is all we need.
    const src = join(dir, 'd1-omni-src')
    const tokenizer = new Tokenizer(
      JSON.parse(readFileSync(join(src, 'tokenizer.json'), 'utf8')),
      JSON.parse(readFileSync(join(src, 'tokenizer_config.json'), 'utf8')),
    )
    const tokenize = (text: string): number[] =>
      tokenizer.encode(escapeDelimiters(text), { add_special_tokens: false }).ids

    // CoreML runs fp16 internally, so it drifts ~3e-3 from the fp32 reference. That is
    // far inside the margin the 0.9 autopilot threshold needs; pass ['cpu'] to compare
    // against PyTorch exactly.
    const session = await ort.InferenceSession.create(join(dir, graph), {
      executionProviders: providers,
      graphOptimizationLevel: 'all',
    })
    return new D1Omni(session, tokenize, manifest)
  }

  /** The token row for a question, exposed so the fixture test can compare it to Python's. */
  build(state: string, instructions: string, options: string[]): D1Row {
    return buildRow(
      this.tokenize,
      state,
      instructions,
      options,
      this.manifest.tokens,
      this.manifest.shape.seq,
      this.manifest.per_option_tokens,
    )
  }

  /**
   * One model request, two questions: which track fits, and which mood the scene
   * is in. The mood feeds the scene machine's hysteresis, so the score stops
   * flickering on a single misread.
   */
  async evaluate(
    state: string,
    options: string[],
    moods: readonly string[] = MOODS,
  ): Promise<{ tracks: number[]; moods: number[] }> {
    const tracks = options.length > 0 ? await this.rank(state, RANK_INSTRUCTIONS, options) : []
    const moodProbabilities = moods.length > 0 ? await this.rank(state, MOOD_INSTRUCTIONS, [...moods]) : []
    return { tracks, moods: moodProbabilities }
  }

  /** Probabilities over `options`, ordered as given. */
  async rank(state: string, instructions: string, options: string[]): Promise<number[]> {
    const { seq, options: maxOptions } = this.manifest.shape
    if (options.length === 0) return []
    if (options.length > maxOptions)
      throw new Error(`d1-omni: ${options.length} options, the graph takes ${maxOptions}`)

    const row = this.build(state, instructions, options)
    if (row.ids.length > seq) throw new Error('d1-omni: the row does not fit the graph')

    const pad = seq - row.ids.length
    const k = options.length
    const feeds = {
      input_ids: new ort.Tensor('int64', BigInt64Array.from([...row.ids, ...new Array(pad).fill(0)].map(BigInt)), [
        1,
        seq,
      ]),
      attention_mask: new ort.Tensor(
        'int64',
        BigInt64Array.from([...row.ids.map(() => 1), ...new Array(pad).fill(0)].map(BigInt)),
        [1, seq],
      ),
      marker_pos: new ort.Tensor(
        'int64',
        BigInt64Array.from([...row.markers, ...new Array(maxOptions - k).fill(0)].map(BigInt)),
        [1, maxOptions],
      ),
      marker_mask: new ort.Tensor(
        'bool',
        [...row.markers.map(() => true), ...new Array(maxOptions - k).fill(false)],
        [1, maxOptions],
      ),
      qtype: new ort.Tensor('int64', BigInt64Array.from([0n]), [1]),
    }

    const out = await this.session.run(feeds)
    const logits = Array.from((out.logits.data as Float32Array).slice(0, k))
    return toProbabilities(logits, k, temperatureFor(this.manifest.temperatures, k))
  }
}
