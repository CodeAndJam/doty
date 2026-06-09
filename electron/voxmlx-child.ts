/**
 * voxmlx-child.ts — MLX Voxtral bridge via Python subprocess.
 *
 * Spawns voxmlx-bridge.py, pipes PCM audio to stdin, reads JSON lines from stdout.
 * Uses Apple Silicon GPU (Metal) via MLX for fast inference.
 *
 * Runs as an Electron utilityProcess (same pattern as voxtral-child.ts).
 */
import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? ''
const VENV_PYTHON = join(HOME, '.doty', 'voxmlx-env', 'bin', 'python3')
const SYSTEM_PYTHON = 'python3'
const PYTHON = existsSync(VENV_PYTHON) ? VENV_PYTHON : SYSTEM_PYTHON

// In packaged app: process.resourcesPath points to .app/Contents/Resources
// In dev: fall back to the source file
const PACKAGED_BRIDGE = join(process.resourcesPath ?? '', 'voxmlx-bridge.py')
const DEV_BRIDGE = join(__dirname, '..', '..', 'electron', 'voxmlx-bridge.py')
const BRIDGE_SCRIPT = existsSync(PACKAGED_BRIDGE) ? PACKAGED_BRIDGE : DEV_BRIDGE
const MODEL = 'mlx-community/Voxtral-Mini-4B-Realtime-6bit'

let python: ChildProcess | null = null
let ready = false

function startPython() {
  if (python) return

  python = spawn(PYTHON, [BRIDGE_SCRIPT, '--model', MODEL], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  })

  console.log(`[voxmlx] Spawned Python: ${PYTHON} ${BRIDGE_SCRIPT}`)
  console.log(`[voxmlx] VENV exists: ${existsSync(VENV_PYTHON)}, using: ${PYTHON}`)

  const rl = createInterface({ input: python.stdout! })
  rl.on('line', (line) => {
    try {
      const msg = JSON.parse(line)
      if (msg.type === 'status') {
        ready = msg.text === 'ready'
        process.parentPort.postMessage({ type: 'status', status: msg.text })
      } else if (msg.type === 'text') {
        process.parentPort.postMessage({ type: 'flush', text: msg.text })
      } else if (msg.type === 'interim') {
        process.parentPort.postMessage({ type: 'interim', text: msg.text })
      }
    } catch {}
  })

  python.stderr?.on('data', (data) => {
    console.error('[voxmlx]', data.toString().trim())
  })

  python.on('exit', (code) => {
    console.log(`[voxmlx] Python exited with code ${code}`)
    python = null
    ready = false
  })
}

startPython()

// Handle audio chunks from main process
let chunkCount = 0
process.parentPort.on('message', (e: Electron.MessageEvent) => {
  const { id, buffer, type } = e.data as { id?: number; buffer?: ArrayBuffer; type?: string }

  if (type === 'flush') {
    // Signal the bridge to flush remaining text by closing stdin
    python?.stdin?.end()
    return
  }

  if (buffer && python?.stdin?.writable) {
    // Convert Float32 to Int16 PCM for the bridge
    const float32 = new Float32Array(buffer)
    const int16 = new Int16Array(float32.length)
    for (let i = 0; i < float32.length; i++) {
      int16[i] = Math.max(-32768, Math.min(32767, Math.round(float32[i] * 32768)))
    }
    python.stdin.write(Buffer.from(int16.buffer))
    chunkCount++
    if (chunkCount % 50 === 1) console.log(`[voxmlx] Piped chunk #${chunkCount}, ${float32.length} samples`)
  } else {
    if (chunkCount === 0) console.log('[voxmlx] stdin not writable, dropping audio')
  }

  // Respond immediately — text comes via 'flush'/'interim' messages
  process.parentPort.postMessage({ id, text: '' })
})
