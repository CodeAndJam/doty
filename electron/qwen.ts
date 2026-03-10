import { join } from 'path'
import { app } from 'electron'

// Use the Node.js CJS build of transformers.js directly
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { pipeline, env } = require(
  join(app.getAppPath(), 'node_modules/@huggingface/transformers/dist/transformers.node.cjs')
)

// Cache models in ~/.doty/hf-cache
env.cacheDir = join(app.getPath('home'), '.doty', 'hf-cache')
env.allowRemoteModels = true

// Use a small ONNX-compatible Qwen2.5 instruct model (~500MB)
const MODEL_ID = 'Xenova/Qwen2.5-0.5B-Instruct'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let generator: any = null

async function loadGenerator() {
  if (generator) return generator
  console.log('[qwen] Loading recommendation model...')
  generator = await pipeline('text-generation', MODEL_ID, {
    dtype: 'q4',
    device: 'cpu',
  })
  console.log('[qwen] Model ready')
  return generator
}

export class QwenManager {
  async recommend(transcript: string, files: string[]): Promise<string[]> {
    if (files.length === 0) return []

    try {
      const gen = await loadGenerator()

      const numbered = files
        .slice(0, 100) // cap list to avoid huge prompts
        .map((f, i) => `${i + 1}. ${f}`)
        .join('\n')

      const messages = [
        {
          role: 'system',
          content:
            'You are a music mood matcher. Given a conversation transcript, pick the 10 best matching songs. Return ONLY a valid JSON array of exactly 10 filenames from the provided list. No explanation, no markdown, no code block.',
        },
        {
          role: 'user',
          content: `Transcript:\n"${transcript.slice(0, 600)}"\n\nSong list:\n${numbered}\n\nReturn a JSON array of 10 filenames.`,
        },
      ]

      const output = await gen(messages, {
        max_new_tokens: 400,
        temperature: 0.3,
        do_sample: true,
      })

      const text: string =
        output?.[0]?.generated_text?.at(-1)?.content ?? ''

      const match = text.match(/\[[\s\S]*?\]/)
      if (!match) return files.slice(0, 10)

      const parsed: string[] = JSON.parse(match[0])
      const valid = parsed.filter((f) => files.includes(f)).slice(0, 10)
      return valid.length > 0 ? valid : files.slice(0, 10)
    } catch (e) {
      console.error('[qwen] recommend error:', e)
      return files.slice(0, 10)
    }
  }
}
