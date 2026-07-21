/**
 * llm-child.ts — Electron utilityProcess for scene interpretation + track embedding.
 * Runs node-llama-cpp in a separate process to avoid ggml symbol conflicts with transcribe-cpp.
 *
 * Messages IN:
 *   { type: 'load-scene-model', modelPath: string }
 *   { type: 'load-embedding-model', modelPath: string }
 *   { type: 'interpret-scene', transcript: string }
 *   { type: 'embed', id: number, text: string }
 *   { type: 'embed-batch', id: number, texts: string[] }
 *   { type: 'dispose' }
 *
 * Messages OUT:
 *   { type: 'scene-model-ready' }
 *   { type: 'embedding-model-ready' }
 *   { type: 'scene-result', scene: SceneResult }
 *   { type: 'embedding', id: number, vector: number[] }
 *   { type: 'embeddings', id: number, vectors: number[][] }
 *   { type: 'error', error: string }
 *   { type: 'status', status: string }
 */

const SCENE_SYSTEM_PROMPT = `You are a D&D scene analyst. Given a transcript from a tabletop RPG session, describe the current scene for music selection.

Output JSON only:
{"scene":"<1-2 sentence description>","mood":"<one of: combat,chase,tense,horror,mystery,exploration,tavern,celebration,sad,epic,peaceful,voyage,stealth>","intensity":<0.0-1.0>,"keywords":["<word>","<word>","<word>"]}

Rules:
- Focus on the DM's narration, not player chatter
- Describe what is HAPPENING NOW, not what happened before
- intensity: 0.0=calm, 0.5=moderate, 1.0=peak action
- keywords: 3-5 words describing setting/action/atmosphere`

interface SceneResult {
  scene: string
  mood: string
  intensity: number
  keywords: string[]
}

const VALID_MOODS = [
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
]

let getLlama: any = null
let llama: any = null
let sceneModel: any = null
let sceneContext: any = null
let embeddingModel: any = null
let embeddingContext: any = null

function send(msg: Record<string, unknown>) {
  process.parentPort?.postMessage(msg)
}

async function initLlama() {
  if (llama) return
  const lib = await import('node-llama-cpp')
  getLlama = lib.getLlama
  llama = await getLlama()
}

async function loadSceneModel(modelPath: string) {
  try {
    await initLlama()
    send({ type: 'status', status: 'loading-scene-model' })

    if (sceneContext) {
      await sceneContext.dispose()
      sceneContext = null
    }
    if (sceneModel) {
      await sceneModel.dispose()
      sceneModel = null
    }

    sceneModel = await llama.loadModel({ modelPath })
    sceneContext = await sceneModel.createContext({ contextSize: 4096 })
    send({ type: 'scene-model-ready' })
    send({ type: 'status', status: 'ready' })
  } catch (e: any) {
    send({ type: 'error', error: `Scene model load failed: ${e.message}` })
  }
}

async function loadEmbeddingModel(modelPath: string) {
  try {
    await initLlama()
    send({ type: 'status', status: 'loading-embedding-model' })

    if (embeddingContext) {
      await embeddingContext.dispose()
      embeddingContext = null
    }
    if (embeddingModel) {
      await embeddingModel.dispose()
      embeddingModel = null
    }

    embeddingModel = await llama.loadModel({ modelPath })
    embeddingContext = await embeddingModel.createEmbeddingContext()
    send({ type: 'embedding-model-ready' })
  } catch (e: any) {
    send({ type: 'error', error: `Embedding model load failed: ${e.message}` })
  }
}

async function interpretScene(transcript: string) {
  if (!sceneModel || !sceneContext) {
    send({ type: 'error', error: 'Scene model not loaded' })
    return
  }

  try {
    const { LlamaChatSession } = await import('node-llama-cpp')
    const session = new LlamaChatSession({ context: sceneContext })

    const response = await session.prompt(transcript, {
      systemPrompt: SCENE_SYSTEM_PROMPT,
      maxTokens: 150,
    })

    // Parse JSON response (grammar enforcement should make this reliable)
    let result: SceneResult
    try {
      result = JSON.parse(response)
    } catch {
      // Fallback: try to extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[0])
      } else {
        send({ type: 'error', error: `Failed to parse scene JSON: ${response.slice(0, 100)}` })
        return
      }
    }

    // Validate and clamp
    if (!VALID_MOODS.includes(result.mood)) result.mood = 'exploration'
    result.intensity = Math.max(0, Math.min(1, result.intensity ?? 0.5))
    if (!Array.isArray(result.keywords)) result.keywords = []

    send({ type: 'scene-result', scene: result })

    // Dispose session to free context for next call
    session.dispose()
  } catch (e: any) {
    send({ type: 'error', error: `Scene interpretation failed: ${e.message}` })
  }
}

async function embed(id: number, text: string) {
  if (!embeddingContext) {
    send({ type: 'error', error: 'Embedding model not loaded' })
    return
  }
  try {
    const result = await embeddingContext.getEmbeddingFor(text)
    send({ type: 'embedding', id, vector: Array.from(result.vector) })
  } catch (e: any) {
    send({ type: 'error', error: `Embedding failed: ${e.message}` })
  }
}

async function embedBatch(id: number, texts: string[]) {
  if (!embeddingContext) {
    send({ type: 'error', error: 'Embedding model not loaded' })
    return
  }
  try {
    const vectors: number[][] = []
    for (const text of texts) {
      const result = await embeddingContext.getEmbeddingFor(text)
      vectors.push(Array.from(result.vector))
    }
    send({ type: 'embeddings', id, vectors })
  } catch (e: any) {
    send({ type: 'error', error: `Batch embedding failed: ${e.message}` })
  }
}

async function dispose() {
  if (sceneContext) {
    await sceneContext.dispose()
    sceneContext = null
  }
  if (sceneModel) {
    await sceneModel.dispose()
    sceneModel = null
  }
  if (embeddingContext) {
    await embeddingContext.dispose()
    embeddingContext = null
  }
  if (embeddingModel) {
    await embeddingModel.dispose()
    embeddingModel = null
  }
  if (llama) {
    /* llama instance persists */
  }
  send({ type: 'status', status: 'disposed' })
}

process.parentPort?.on('message', async ({ data }: { data: any }) => {
  try {
    switch (data.type) {
      case 'load-scene-model':
        await loadSceneModel(data.modelPath)
        break
      case 'load-embedding-model':
        await loadEmbeddingModel(data.modelPath)
        break
      case 'interpret-scene':
        await interpretScene(data.transcript)
        break
      case 'embed':
        await embed(data.id, data.text)
        break
      case 'embed-batch':
        await embedBatch(data.id, data.texts)
        break
      case 'dispose':
        await dispose()
        break
      default:
        send({ type: 'error', error: `Unknown message: ${data.type}` })
    }
  } catch (e: any) {
    send({ type: 'error', error: e.message })
  }
})
