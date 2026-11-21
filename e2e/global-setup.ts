import { execFile } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(__filename)

/**
 * Fail fast when the machine cannot run Electron at all.
 *
 * A broken desktop session — or Chromium's "unexpectedly quit while reopening
 * windows" dialog — leaves `app.whenReady()` unresolved, so every spec times out
 * in `firstWindow` and a whole suite reads as a branch failure. It cost forty
 * minutes once; one probe on a throwaway profile makes the cause say itself.
 */
export default async function globalSetup(): Promise<void> {
  const electronPath = require('electron') as unknown as string
  const dir = fs.mkdtempSync(join(tmpdir(), 'doty-preflight-'))
  const result = join(dir, 'result')
  const script = join(dir, 'probe.cjs')
  fs.writeFileSync(
    script,
    [
      "const { app, BrowserWindow } = require('electron')",
      "const fs = require('node:fs')",
      `const result = ${JSON.stringify(result)}`,
      "const timer = setTimeout(() => { fs.writeFileSync(result, 'timeout'); app.exit(2) }, 30000)",
      'app.whenReady().then(() => {',
      '  const win = new BrowserWindow({ show: false })',
      '  win.webContents.once("did-finish-load", () => { clearTimeout(timer); fs.writeFileSync(result, "ready"); app.exit(0) })',
      '  win.loadURL("data:text/html,ok")',
      '})',
    ].join('\n'),
  )

  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE

  const outcome = await new Promise<string>((resolve) => {
    execFile(
      electronPath,
      // Its own profile: the probe tests the host, not whatever state the last
      // run left in a shared Chromium profile.
      [script, `--user-data-dir=${join(dir, 'profile')}`],
      { timeout: 35_000, env },
      (err, _stdout, stderr) => {
        if (fs.existsSync(result)) resolve(fs.readFileSync(result, 'utf8'))
        else resolve(`no result: ${err?.message ?? 'exited'} ${stderr.slice(-300)}`.trim())
      },
    )
  })
  fs.rmSync(dir, { recursive: true, force: true })

  if (outcome !== 'ready') {
    throw new Error(
      `Electron could not open a window on this machine (${outcome}).\n` +
        'A minimal app with one hidden window fails the same way, so the cause is the host or this checkout\'s ' +
        'Electron install — not app code.\n' +
        'Usual causes: a locked or headless desktop session; a modal "unexpectedly quit while reopening windows" ' +
        'prompt in front of the app; a native rebuild missing (`pnpm rebuild`). Fix, then retry.',
    )
  }
}
