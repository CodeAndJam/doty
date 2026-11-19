/**
 * Footprint: what Doty holds on an Apple Silicon Mac once every model is
 * resident, and what it holds while it decides.
 *
 * Opt-in and separate from the other specs: it needs the real 1.5 GB graph and
 * the 380 MB embedder on disk, it takes minutes, and it measures the machine,
 * so it must not share a runner with anything else.
 *
 *   pnpm build && pnpm footprint
 *
 * Stages, sampled once a second:
 *   1. cold    — one `sessionEvaluate`; the graph loads and the kernels warm
 *   2. idle    — every model resident, the loop asleep
 *   3. decide  — 20 real passes over 20 candidates, one at a time
 *   4. search  — semantic queries through the embedder for 10 s
 *
 * Numbers are taken the way Activity Monitor takes them: `phys_footprint` per
 * process, summed over the app's process tree. Apple Silicon has unified
 * memory, so that number already contains the model's Metal buffers. GPU
 * *utilisation* has no per-process attribution on macOS — `ioreg` reports the
 * machine — so read the stage delta against idle.
 *
 * Writes `test-results/footprint.{json,md}` and gates the numbers against the
 * last baseline recorded on the same Mac (`test-fixtures/footprint/baseline.json`)
 * so a release cannot quietly cost more memory or time. A machine with no
 * baseline is measured but not gated; a machine busier than half its cores is
 * not judged at all.
 *
 *   DOTY_FOOTPRINT_UPDATE=1 pnpm footprint:baseline   # on a quiet Mac
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { cpus as cpuList, homedir, loadavg, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'

const RUN = process.env.DOTY_FOOTPRINT === '1'
const MODELS = join(process.env.DOTY_MODELS ?? join(homedir(), '.doty', 'models'))
const RANKER = join(MODELS, 'd1-omni-text.onnx')
const EMBEDDER = join(MODELS, 'embeddinggemma-2', 'model_q4.onnx')
const RESULTS = resolve(__dirname, '../test-results')
const FIXTURES = resolve(__dirname, 'fixtures')
const BASE = resolve(__dirname, '../test-fixtures/footprint/baseline.json')

/**
 * Budgets are per machine: a Mac is judged against the last quiet run on the
 * same model, RAM and core count. Memory is tight because a second resident
 * model is what a regression looks like; latency and CPU move with thermals and
 * background work, so they get more room.
 */
const TOLERANCE = { memory: 0.15, latency: 0.4, tail: 0.75, cpu: 6 }

type Budget = {
  recordedAt: string
  coldMs: number
  idleMB: number
  idleCpu: number
  decideP50Ms: number
  decideP95Ms: number
  decideCpu: number
  searchP50Ms: number
}

type Baselines = { note?: string; machines: Record<string, Budget> }

test.skip(!RUN, 'footprint run is opt-in: pnpm footprint')
test.skip(process.platform !== 'darwin', 'phys_footprint and ioreg are macOS-only')
test.skip(!fs.existsSync(RANKER) || !fs.existsSync(EMBEDDER), 'needs the ranker and embedder models on disk')
test.setTimeout(600_000)

type Metric = {
  pid: number
  type: string
  cpu: { percentCPUUsage: number }
  memory: { workingSetSize: number }
}

type Snapshot = {
  at: number
  procs: Array<{ pid: number; type: string; physMB: number; rssMB: number; cpu: number }>
  gpu: number | null
  swapMB: number
  compressorMB: number
}

/** A process's Activity Monitor "Memory" number, in KB. */
function physKB(pid: number): number {
  try {
    const out = execFileSync('footprint', ['-p', String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    const match = out.match(/phys_footprint:\s+([\d.]+)\s+(B|KB|MB|GB)/)
    if (!match) return 0
    const scale: Record<string, number> = { B: 1 / 1024, KB: 1, MB: 1024, GB: 1024 * 1024 }
    return Math.round(Number(match[1]) * scale[match[2]])
  } catch {
    return 0
  }
}

/** Machine-wide GPU utilisation. No per-process attribution exists without root. */
function gpuUtil(): number | null {
  try {
    const out = execFileSync('ioreg', ['-r', '-d', '1', '-w', '0', '-c', 'IOAccelerator'], { encoding: 'utf8' })
    const match = out.match(/"Device Utilization %"\s*=\s*(\d+)/)
    return match ? Number(match[1]) : null
  } catch {
    return null
  }
}

function hostMemory(): { swapMB: number; compressorMB: number } {
  const swap = execFileSync('sysctl', ['-n', 'vm.swapusage'], { encoding: 'utf8' })
  const vm = execFileSync('vm_stat', { encoding: 'utf8' })
  const pageSize = Number(vm.match(/page size of (\d+) bytes/)?.[1] ?? 16384)
  const compressed = Number(vm.match(/Pages occupied by compressor:\s+(\d+)/)?.[1] ?? 0)
  return {
    swapMB: Math.round(Number(swap.match(/used = ([\d.]+)M/)?.[1] ?? 0)),
    compressorMB: Math.round((compressed * pageSize) / 1e6),
  }
}

async function snapshot(app: ElectronApplication): Promise<Snapshot> {
  const metrics = (await app.evaluate(({ app: electronApp }) => electronApp.getAppMetrics())) as unknown as Metric[]
  return {
    at: Date.now(),
    procs: metrics.map((m) => {
      const phys = physKB(m.pid)
      return {
        pid: m.pid,
        type: m.type,
        physMB: Math.round((phys || m.memory.workingSetSize) / 1024),
        rssMB: Math.round(m.memory.workingSetSize / 1024),
        cpu: m.cpu.percentCPUUsage,
      }
    }),
    gpu: gpuUtil(),
    ...hostMemory(),
  }
}

/** Sample the app while `run` works, so idle and load are measured the same way. */
async function sampleWhile(app: ElectronApplication, run: () => Promise<void>): Promise<Snapshot[]> {
  const samples: Snapshot[] = []
  let running = true
  const sampler = (async () => {
    while (running) {
      samples.push(await snapshot(app))
      await new Promise((r) => setTimeout(r, 1_000))
    }
  })()
  try {
    await run()
  } finally {
    running = false
    await sampler
  }
  return samples
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))] ?? 0
}

function machineKey(machine: { model: string; memoryGB: number; cpus: number }): string {
  return `${machine.model}|${machine.memoryGB}|${machine.cpus}`
}

type Stage = {
  name: string
  samples: number
  totalMB: number
  cpu: number
  gpu: number | null
  gpuDelta: number | null
  swapMB: number
  compressorMB: number
  procs: Snapshot['procs']
}

type Baseline = { gpu: number | null; swapMB: number; compressorMB: number; load1: number }

/** The machine's own load, taken before Doty starts, so a busy Mac is visible. */
async function baseline(): Promise<Baseline> {
  const gpus: number[] = []
  for (let i = 0; i < 5; i++) {
    const util = gpuUtil()
    if (util !== null) gpus.push(util)
    await new Promise((r) => setTimeout(r, 1_000))
  }
  return {
    gpu: gpus.length ? gpus.reduce((a, b) => a + b, 0) / gpus.length : null,
    ...hostMemory(),
    load1: loadavg()[0] ?? 0,
  }
}

function summarise(name: string, samples: Snapshot[], before: Baseline): Stage {
  const last = samples[samples.length - 1]
  const totalMB = Math.max(...samples.map((s) => s.procs.reduce((sum, p) => sum + p.physMB, 0)))
  const gpus = samples.map((s) => s.gpu).filter((v): v is number => v !== null)
  const gpu = gpus.length ? Math.round(gpus.reduce((a, b) => a + b, 0) / gpus.length) : null

  // Peak memory and mean CPU per process: a single sample at the end misses the
  // transient analyze worker and whatever the loop was doing a second ago.
  const agg = new Map<number, { pid: number; type: string; physMB: number; rssMB: number; cpu: number; n: number }>()
  for (const sample of samples) {
    for (const p of sample.procs) {
      const cur = agg.get(p.pid)
      if (cur) {
        cur.physMB = Math.max(cur.physMB, p.physMB)
        cur.cpu += p.cpu
        cur.n++
      } else {
        agg.set(p.pid, { ...p, cpu: p.cpu, n: 1 })
      }
    }
  }

  return {
    name,
    samples: samples.length,
    totalMB,
    cpu: samples.reduce((sum, s) => sum + s.procs.reduce((a, p) => a + p.cpu, 0), 0) / samples.length,
    gpu,
    gpuDelta: gpu !== null && before.gpu !== null ? Math.round(gpu - before.gpu) : null,
    swapMB: last.swapMB,
    compressorMB: last.compressorMB,
    procs: [...agg.values()]
      .map((p) => ({ pid: p.pid, type: p.type, physMB: p.physMB, rssMB: p.rssMB, cpu: p.cpu / p.n }))
      .sort((a, b) => b.physMB - a.physMB),
  }
}

function markdown(
  stages: Stage[],
  before: Baseline,
  cpus: number,
  latencies: number[],
  searchMs: number[],
  coldMs: number,
  searchMode: string,
  gate: string,
): string {
  const lines = [
    '# Footprint',
    '',
    `cold load: **${coldMs} ms** · decide p50 **${Math.round(percentile(latencies, 0.5))} ms**, p95 **${Math.round(percentile(latencies, 0.95))} ms** · search p50 **${Math.round(percentile(searchMs, 0.5))} ms** · search mode **${searchMode}**`,
    `baseline before launch: GPU **${before.gpu === null ? '—' : Math.round(before.gpu)}%**, swap **${before.swapMB} MB**, compressor **${before.compressorMB} MB**, 1-min load **${before.load1.toFixed(1)}** on ${cpus} cores`,
    ...(before.load1 > cpus / 2
      ? [`> **The machine was busy before Doty started** (load ${before.load1.toFixed(1)}): treat this run as noisy.`]
      : []),
    `gate: ${gate}`,
    '',
    '| stage | n | total MB | CPU % | GPU % | GPU Δ | swap Δ MB | compressor Δ MB |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...stages.map(
      (s) =>
        `| ${s.name} | ${s.samples} | ${s.totalMB} | ${s.cpu.toFixed(0)} | ${s.gpu === null ? '—' : s.gpu} | ${s.gpuDelta === null ? '—' : s.gpuDelta} | ${s.swapMB - before.swapMB} | ${s.compressorMB - before.compressorMB} |`,
    ),
    '',
    'Per process during the decide stage (peak memory, mean CPU):',
    '',
    '| pid | type | phys MB | rss MB | CPU % |',
    '| ---: | --- | ---: | ---: | ---: |',
    ...(stages.find((s) => s.name === 'decide')?.procs ?? []).map(
      (p) => `| ${p.pid} | ${p.type} | ${p.physMB} | ${p.rssMB} | ${p.cpu.toFixed(1)} |`,
    ),
    '',
    '> GPU % is machine-wide (ioreg); the Δ column is against the pre-launch baseline.',
    '> swap and compressor are system-wide too; the Δ columns are the signal.',
    '',
  ]
  return lines.join('\n')
}

test('measures idle and decision footprint with every model resident', async () => {
  const profile = `footprint-${process.pid}-${test.info().testId}`.replace(/[^a-zA-Z0-9_-]+/g, '-')
  const root = fs.mkdtempSync(join(tmpdir(), 'doty-footprint-'))
  const music = join(root, 'music')
  fs.mkdirSync(music, { recursive: true })
  for (const file of ['Fantasy Tavern.mp3', 'Campfire.mp3']) {
    fs.copyFileSync(join(FIXTURES, file), join(music, file))
  }

  // One real harvested row: the same 20-option shape a live pass sees.
  const rows = JSON.parse(fs.readFileSync(resolve(__dirname, '../test-fixtures/ranker/rows.json'), 'utf8'))
  const row = rows[0]
  const candidates = row.candidates.slice(0, 20).map((c: { description: string }) => c.description)
  const paths = row.candidates.slice(0, 20).map((c: { path: string }) => c.path)

  const latencies: number[] = []
  const searchMs: number[] = []
  const modes = new Set<string>()
  let app: ElectronApplication | undefined
  let coldMs = 0

  const before = await baseline()

  try {
    app = await electron.launch({
      args: [join(__dirname, '../out/main/index.js')],
      env: { ...process.env, DOTY_PROFILE: profile, DOTY_E2E_MUTE: '1' },
    })
    const page: Page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    const skip = page.getByText('Skip for now — set it up later in Settings')
    if (await skip.isVisible().catch(() => false)) await skip.click()

    await page.evaluate((dir: string) => window.doty.setMusicFolder(dir), music)

    // Every model resident: the embedder loads with the first text-index pass,
    // the ranker with the first pass. Both are lazy by design.
    await page.waitForFunction(
      async () => {
        const status = await window.doty.embeddingStatus()
        // Idle only after both passes: the audio pass runs after the text one and
        // would otherwise be measured as "idle" work.
        return status.total > 0 && status.indexed === status.total && status.phase === 'idle'
      },
      undefined,
      { timeout: 240_000, polling: 1_000 },
    )

    const decideOnce = async () => {
      const started = performance.now()
      await page.evaluate(
        (request) => window.doty.sessionEvaluate(request),
        { state: row.transcript, candidates, paths, msUntilTrackEnd: 15_000, musicEnabled: true },
      )
      latencies.push(performance.now() - started)
    }

    // Cold: the 1.5 GB graph loads inside this pass. Sampled, so the memory the
    // loader holds during the read is visible too.
    const coldStart = performance.now()
    const cold = await sampleWhile(app, async () => {
      await decideOnce()
    })
    coldMs = Math.round(performance.now() - coldStart)

    const idle = await sampleWhile(app, () => new Promise<void>((r) => setTimeout(r, 15_000)))

    const decide = await sampleWhile(app, async () => {
      for (let i = 0; i < 20; i++) await decideOnce()
    })

    // Semantic search is one encoder pass per query; keep going until there are
    // enough samples for the CPU average to mean something.
    const search = await sampleWhile(app, async () => {
      const started = performance.now()
      while (performance.now() - started < 10_000) {
        const at = performance.now()
        const result = await page.evaluate(
          (query) => window.doty.librarySearch(query, 'music', 20),
          'música de taverna animada',
        )
        searchMs.push(performance.now() - at)
        modes.add(result.mode)
      }
    })

    const stages = [
      summarise('cold', cold, before),
      summarise('idle', idle, before),
      summarise('decide', decide, before),
      summarise('search', search, before),
    ]

    const machine = await app.evaluate(({ app: electronApp }) => ({
      app: electronApp.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
    }))
    const report = {
      machine: {
        ...machine,
        model: execFileSync('sysctl', ['-n', 'machdep.cpu.brand_string'], { encoding: 'utf8' }).trim(),
        // GiB, so the key reads as the number the Mac is sold as.
        memoryGB: Math.round(Number(execFileSync('sysctl', ['-n', 'hw.memsize'], { encoding: 'utf8' }).trim()) / 2 ** 30),
        cpus: Number(execFileSync('sysctl', ['-n', 'hw.ncpu'], { encoding: 'utf8' }).trim()),
        os: execFileSync('sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim(),
      },
      coldMs,
      latencies,
      searchMs,
      searchMode: modes.has('semantic') ? 'semantic' : 'text',
      baseline: before,
      stages,
      samples: { cold, idle, decide, search },
    }

    // The cold pass is the graph load, not a decision: keep it out of the p95.
    const warm = latencies.slice(1)
    const idleStage = stages.find((s) => s.name === 'idle')!
    const decideStage = stages.find((s) => s.name === 'decide')!
    const p50 = Math.round(percentile(warm, 0.5))
    const p95 = Math.round(percentile(warm, 0.95))
    const busy = before.load1 > cpuList().length / 2 && process.env.DOTY_FOOTPRINT_ALLOW_BUSY !== '1'
    const key = machineKey(report.machine)

    const baselines: Baselines = fs.existsSync(BASE)
      ? JSON.parse(fs.readFileSync(BASE, 'utf8'))
      : { machines: {} }

    let gate: string
    const violations: string[] = []
    if (process.env.DOTY_FOOTPRINT_UPDATE === '1') {
      // A busy Mac records a ceiling, not a baseline: the next quiet run would
      // look like a regression. Refuse unless someone says so.
      if (busy)
        throw new Error(
          `refusing to record a baseline at load ${before.load1.toFixed(1)}; quiet the Mac or set DOTY_FOOTPRINT_ALLOW_BUSY=1`,
        )
      baselines.machines[key] = {
        recordedAt: new Date().toISOString().slice(0, 10),
        coldMs,
        idleMB: idleStage.totalMB,
        idleCpu: Math.round(idleStage.cpu * 10) / 10,
        decideP50Ms: p50,
        decideP95Ms: p95,
        decideCpu: Math.round(decideStage.cpu * 10) / 10,
        searchP50Ms: Math.round(percentile(searchMs, 0.5)),
      }
      fs.mkdirSync(dirname(BASE), { recursive: true })
      fs.writeFileSync(BASE, `${JSON.stringify(baselines, null, 1)}\n`)
      gate = `baseline recorded for ${key}`
    } else {
      const budget = baselines.machines[key]
      if (!budget) {
        gate = `no baseline for ${key}; recorded, not gated (run DOTY_FOOTPRINT_UPDATE=1 pnpm footprint on this Mac)`
      } else if (busy) {
        gate = `skipped: machine busy (load ${before.load1.toFixed(1)}), numbers are not comparable`
      } else {
        // Collect now, assert after the report is written: a red gate is still a
        // run worth reading.
        if (idleStage.totalMB > budget.idleMB * (1 + TOLERANCE.memory))
          violations.push(
            `idle memory ${idleStage.totalMB} MB > ${budget.idleMB} MB + ${TOLERANCE.memory * 100}%`,
          )
        if (p50 > budget.decideP50Ms * (1 + TOLERANCE.latency))
          violations.push(`decide p50 ${p50} ms > ${budget.decideP50Ms} ms + ${TOLERANCE.latency * 100}%`)
        if (p95 > budget.decideP95Ms * (1 + TOLERANCE.tail))
          violations.push(`decide p95 ${p95} ms > ${budget.decideP95Ms} ms + ${TOLERANCE.tail * 100}%`)
        if (idleStage.cpu > budget.idleCpu + TOLERANCE.cpu)
          violations.push(`idle CPU ${idleStage.cpu.toFixed(1)}% > ${budget.idleCpu}% + ${TOLERANCE.cpu} pp`)
        if (decideStage.cpu > budget.decideCpu + TOLERANCE.cpu)
          violations.push(
            `decide CPU ${decideStage.cpu.toFixed(1)}% > ${budget.decideCpu}% + ${TOLERANCE.cpu} pp`,
          )
        gate = violations.length
          ? `**FAIL** against ${key} (recorded ${budget.recordedAt}): ${violations.join('; ')}`
          : `pass against ${key} (recorded ${budget.recordedAt})`
      }
    }

    fs.mkdirSync(RESULTS, { recursive: true })
    fs.writeFileSync(join(RESULTS, 'footprint.json'), `${JSON.stringify({ ...report, gate }, null, 1)}\n`)
    fs.writeFileSync(
      join(RESULTS, 'footprint.md'),
      markdown(stages, before, cpuList().length, warm, searchMs, coldMs, report.searchMode, gate),
    )

    console.log(markdown(stages, before, cpuList().length, warm, searchMs, coldMs, report.searchMode, gate))
    expect(violations, 'footprint regressed against the committed baseline').toEqual([])
  } finally {
    if (app) await app.close().catch(() => {})
    fs.rmSync(root, { recursive: true, force: true })
    fs.rmSync(join(homedir(), '.doty', 'profiles', profile), { recursive: true, force: true })
  }
})
