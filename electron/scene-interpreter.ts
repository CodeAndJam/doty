/**
 * scene-interpreter.ts — Main-process manager for the LLM scene interpreter.
 * Spawns a utilityProcess running llm-child.ts, manages the interpretation cycle,
 * and exposes results for the recommendation engine.
 */
import { join } from 'node:path'
import type { UtilityProcess } from 'electron'

export interface SceneResult {
  scene: string
  mood: string
  intensity: number
  keywords: string[]
}

const LLM_CHILD_PATH = join(__dirname, 'llm-child.js')
const INTERPRET_INTERVAL_MS = 7000 // run scene interpretation every 7s
const TRANSCRIPT_WINDOW = 3000 // characters of transcript to keep (~2-3 min of speech)

let child: UtilityProcess | null = null
let sceneModelReady = false
let embeddingModelReady = false
let interpreterTimer: ReturnType<typeof setInterval> | null = null
let transcriptBuffer = ''
let lastScene: SceneResult | null = null
let onSceneUpdate: ((scene: SceneResult) => void) | null = null
let onEmbedding: ((id: number, vector: number[]) => void) | null = null
let onEmbeddings: ((id: number, vectors: number[][]) => void) | null = null
let onStatus: ((status: string) => void) | null = null

export function setOnSceneUpdate(cb: (scene: SceneResult) => void) {
  onSceneUpdate = cb
}
export function setOnEmbedding(cb: (id: number, vector: number[]) => void) {
  onEmbedding = cb
}
export function setOnEmbeddings(cb: (id: number, vectors: number[][]) => void) {
  onEmbeddings = cb
}
export function setOnStatus(cb: (status: string) => void) {
  onStatus = cb
}
export function getLastScene(): SceneResult | null {
  return lastScene
}
export function isSceneModelReady(): boolean {
  return sceneModelReady
}
export function isEmbeddingModelReady(): boolean {
  return embeddingModelReady
}

function ensureChild(): UtilityProcess {
  if (child) return child

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { utilityProcess } = require('electron')
  child = utilityProcess.fork(LLM_CHILD_PATH, [], { serviceName: 'doty-llm' })

  child!.on('message', (msg: any) => {
    switch (msg.type) {
      case 'scene-model-ready':
        sceneModelReady = true
        if (onStatus) onStatus('scene-ready')
        break
      case 'embedding-model-ready':
        embeddingModelReady = true
        if (onStatus) onStatus('embedding-ready')
        break
      case 'scene-result':
        lastScene = msg.scene
        if (onSceneUpdate) onSceneUpdate(msg.scene)
        break
      case 'embedding':
        if (onEmbedding) onEmbedding(msg.id, msg.vector)
        break
      case 'embeddings':
        if (onEmbeddings) onEmbeddings(msg.id, msg.vectors)
        break
      case 'status':
        if (onStatus) onStatus(msg.status)
        break
      case 'error':
        console.error('[scene-interpreter] LLM error:', msg.error)
        break
    }
  })

  child!.on('exit', (code: number) => {
    console.log(`[scene-interpreter] LLM process exited with code ${code}`)
    child = null
    sceneModelReady = false
    embeddingModelReady = false
  })

  return child!
}

/** Load the scene interpreter model (GGUF path) */
export function loadSceneModel(modelPath: string): void {
  const proc = ensureChild()
  proc.postMessage({ type: 'load-scene-model', modelPath })
}

/** Load the embedding model (GGUF path) */
export function loadEmbeddingModel(modelPath: string): void {
  const proc = ensureChild()
  proc.postMessage({ type: 'load-embedding-model', modelPath })
}

/** Feed transcript text (appends to buffer, sliding window) */
export function feedTranscript(text: string): void {
  transcriptBuffer = `${transcriptBuffer} ${text}`.slice(-TRANSCRIPT_WINDOW)
}

/** Start the interpretation cycle (call after models are loaded) */
export function startInterpreting(): void {
  if (interpreterTimer) return
  interpreterTimer = setInterval(() => {
    if (!sceneModelReady || !child) return
    const text = transcriptBuffer.trim()
    if (!text || text.length < 50) return // not enough context yet
    child.postMessage({ type: 'interpret-scene', transcript: text })
  }, INTERPRET_INTERVAL_MS)
}

/** Stop the interpretation cycle */
export function stopInterpreting(): void {
  if (interpreterTimer) {
    clearInterval(interpreterTimer)
    interpreterTimer = null
  }
}

/** Request a single text embedding */
export function requestEmbedding(id: number, text: string): void {
  if (!child || !embeddingModelReady) return
  child.postMessage({ type: 'embed', id, text })
}

/** Request batch text embeddings */
export function requestEmbeddings(id: number, texts: string[]): void {
  if (!child || !embeddingModelReady) return
  child.postMessage({ type: 'embed-batch', id, texts })
}

/** Clean up */
export function disposeInterpreter(): void {
  stopInterpreting()
  if (child) {
    child.postMessage({ type: 'dispose' })
    setTimeout(() => {
      child?.kill()
      child = null
    }, 500)
  }
  transcriptBuffer = ''
  lastScene = null
  sceneModelReady = false
  embeddingModelReady = false
}
