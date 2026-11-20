/**
 * The updater: one quiet GitHub check, one DMG, one swap after quit.
 *
 * Not electron-updater. Squirrel validates the update's code signature against
 * the running app's designated requirement, and an ad-hoc signature is a cdhash
 * that changes with every build, so every update would be rejected. This path
 * replaces the bundle with `ditto` after the process exits instead, and never
 * writes `com.apple.quarantine` (that attribute comes from the downloading app,
 * i.e. a browser, not from an https stream to disk), so the new build launches
 * without the `xattr -cr` dance the first install still needs.
 */

import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { dirname, join } from 'node:path'

/** Only arm64 DMGs are published: the app itself is arm64-only. */
const RELEASES_URL = 'https://api.github.com/repos/CodeAndJam/doty/releases?per_page=10'

export interface Release {
  /** Normalised, without the `v`: what the UI shows. */
  version: string
  url: string
  sizeMB: number
  /** `sha256:…` from the GitHub asset digest; required before installing. */
  sha256?: string
}

interface ReleaseAsset {
  name: string
  browser_download_url: string
  size?: number
  digest?: string
}

/** `5.4.0`, `v5.4.0`, `5.4.0-beta.1` → `[5, 4, 0]`; anything else → null. */
export function parseVersion(version: string): [number, number, number] | null {
  // Anchored: a `v5.5.0-rc1` tag is not a stable release and must not be offered
  // as 5.5.0.
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version.trim())
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

/** True only for a strictly later release: the same build never nags twice. */
export function isNewer(remote: string, current: string): boolean {
  const a = parseVersion(remote)
  const b = parseVersion(current)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]
  return false
}

/**
 * The DMG for this architecture. A lone DMG is accepted (only arm64 is
 * published, and a Rosetta process reports `x64`); two DMGs with no match means
 * the arch is unsupported, and guessing is how the wrong binary gets installed.
 */
export function pickDmg(assets: ReleaseAsset[], arch: string): { url: string; sizeMB: number; sha256?: string } | null {
  const dmgs = assets.filter((asset) => asset.name.endsWith('.dmg'))
  const asset = dmgs.find((a) => a.name.includes(`-${arch}.dmg`)) ?? (dmgs.length === 1 ? dmgs[0] : null)
  if (!asset) return null
  const digest = asset.digest?.startsWith('sha256:') ? asset.digest.slice('sha256:'.length) : undefined
  return { url: asset.browser_download_url, sizeMB: Math.round((asset.size ?? 0) / 1024 / 1024), sha256: digest }
}

/** The .app a given executable lives in; null outside a bundle (`pnpm dev`). */
export function bundleFromExecutable(executable: string): string | null {
  const bundle = dirname(dirname(dirname(executable)))
  return bundle.endsWith('.app') ? bundle : null
}

/** The release to offer, or null when this build is current. Throws when offline. */
export async function checkForUpdate(
  currentVersion: string,
  arch: string,
  fetchJson: (url: string) => Promise<unknown>,
): Promise<Release | null> {
  const releases = (await fetchJson(RELEASES_URL)) as Array<{
    tag_name?: unknown
    assets?: ReleaseAsset[]
    draft?: boolean
    prerelease?: boolean
  }>
  // The repo also publishes model bundles (`models-v1`). `/releases/latest` would
  // hand one back and hide the next app release until a newer tag exists, so the
  // newest tag that parses as a version wins instead. A draft or prerelease is
  // not a release a DM should be handed unasked.
  const apps = (Array.isArray(releases) ? releases : []).filter(
    (release) => !release?.draft && !release?.prerelease && parseVersion(String(release?.tag_name)),
  )
  if (apps.length === 0) return null
  const newest = apps.reduce((best, release) =>
    isNewer(String(release.tag_name), String(best.tag_name)) ? release : best,
  )
  const tag = String(newest.tag_name)
  if (!isNewer(tag, currentVersion)) return null
  const dmg = pickDmg(newest.assets ?? [], arch)
  // No digest, no offer: an install that can only fail is a dead end.
  return dmg?.sha256 ? { version: parseVersion(tag)?.join('.') ?? tag, ...dmg } : null
}

export interface InstallOptions {
  dmgUrl: string
  /** Version the image must contain, and the digest it must match. */
  version: string
  sha256?: string
  /** The .app being replaced. */
  targetApp: string
  /** Scratch space for the DMG, the mount point and the swap script. */
  workDir: string
  onProgress(percent: number): void
  download(url: string, dest: string, onProgress: (percent: number) => void): Promise<void>
  /** Checked after the mount, before quitting is armed: a take may have begun. */
  canSwap?: () => boolean
}

/**
 * Download the DMG, mount it, and start the swap script. Resolves once the
 * script is running detached; the caller quits so the script can take over.
 */
export async function installUpdate(options: InstallOptions): Promise<void> {
  const { dmgUrl, targetApp, workDir, onProgress, download } = options
  const dmg = join(workDir, 'Doty.dmg')
  const mountPoint = join(workDir, 'mnt')
  const script = join(workDir, 'install.sh')

  fs.mkdirSync(mountPoint, { recursive: true })
  // A half-downloaded DMG belongs to another release; a mounted image from a
  // failed run would make the mount point unusable. Clear both.
  fs.rmSync(dmg, { force: true })
  fs.rmSync(`${dmg}.part`, { force: true })
  await run('hdiutil', ['detach', mountPoint, '-quiet']).catch(() => {})
  await download(dmgUrl, dmg, onProgress)
  if (!options.sha256) {
    fs.rmSync(dmg, { force: true })
    throw new Error('This release has no checksum; download it from GitHub by hand')
  }
  const digest = await sha256File(dmg)
  if (digest !== options.sha256) {
    fs.rmSync(dmg, { force: true })
    throw new Error('The downloaded update failed its checksum')
  }
  await run('hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mountPoint, dmg])

  // Refuse to quit into a swap that would replace a working app with a broken
  // one: the copy on the image must carry a valid (ad-hoc) seal before we go.
  try {
    const staged = fs.readdirSync(mountPoint).find((name) => name.endsWith('.app'))
    if (!staged) throw new Error('The downloaded image has no Doty.app in it')
    await run('codesign', ['--verify', '--deep', '--strict', join(mountPoint, staged)])
    // The image must hold the release it claims: otherwise the bar re-offers the
    // same version forever.
    const plist = join(mountPoint, staged, 'Contents', 'Info.plist')
    const stagedVersion = (
      await runCapture('plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', plist])
    ).trim()
    if (stagedVersion !== options.version) {
      throw new Error(`The image contains ${stagedVersion}, not ${options.version}`)
    }
  } catch (error) {
    // A rejected image is still mounted; leave nothing behind.
    await run('hdiutil', ['detach', mountPoint, '-quiet']).catch(() => {})
    throw error
  }

  // The download can take minutes; the DM may have started recording since.
  if (options.canSwap && !options.canSwap()) {
    await run('hdiutil', ['detach', mountPoint, '-quiet']).catch(() => {})
    throw new Error('A session started; finish it before updating')
  }

  fs.writeFileSync(script, SWAP_SCRIPT, { mode: 0o755 })
  const child = spawn('/bin/sh', [script, dmg, mountPoint, targetApp, String(process.pid)], {
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
}

function runCapture(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 60_000 }, (error, stdout, stderr) => {
      if (error) reject(new Error(`${command} failed: ${stderr.trim() || error.message}`))
      else resolve(stdout)
    })
  })
}

function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    fs.createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject)
  })
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    // A busy mount point or a licence prompt would otherwise pin the bar at 100%
    // for the rest of the process's life.
    execFile(command, args, { timeout: 60_000 }, (error, _stdout, stderr) => {
      if (error) reject(new Error(`${command} failed: ${stderr.trim() || error.message}`))
      else resolve()
    })
  })
}

/**
 * Runs after Doty exits. Paths arrive as arguments, so nothing here needs
 * quoting. The old bundle stays as `.old` until the next launch has proved the
 * new one runs; a failed swap puts it back and leaves the DMG open in Finder.
 */
const SWAP_SCRIPT = `#!/bin/sh
dmg=$1; mount=$2; target=$3; pid=$4
# Recover a swap interrupted by a crash or power loss before doing anything else.
if [ ! -d "$target" ] && [ -d "$target.old" ]; then mv "$target.old" "$target"; fi
while kill -0 "$pid" 2>/dev/null; do sleep 0.2; done
restore() {
  if [ ! -d "$target" ] && [ -d "$target.old" ]; then mv "$target.old" "$target"; fi
}
trap restore EXIT INT TERM
src=$(ls -d "$mount"/*.app 2>/dev/null | head -1)
rm -rf "$target.new"
if [ -n "$src" ] && ditto "$src" "$target.new" && mv "$target" "$target.old" && mv "$target.new" "$target"; then
  rm -rf "$target.old"
  hdiutil detach "$mount" -quiet
  rm -f "$dmg"
  open "$target"
  exit 0
fi
rm -rf "$target.new"
restore
hdiutil detach "$mount" -quiet
# Never leave the DM with nothing running after a failed update.
[ -d "$target" ] && open "$target" || open "$dmg"
`
