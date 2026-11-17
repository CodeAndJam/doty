/**
 * The bundled ffmpeg binary, moved out of app.asar.
 *
 * Electron's fs can read a path inside the archive, but `spawn` cannot execute
 * one (ENOTDIR), and the two callers that decode audio use `spawn`. The
 * electron-builder config unpacks ffmpeg-static next to the archive, so the
 * binary lives in `app.asar.unpacked`; this is the one place that mapping lives.
 *
 * Deliberately free of Electron imports: the analysis worker runs in a worker
 * thread, where `require('electron').app` does not exist.
 */
export function unpackedBinaryPath(resolved: string | null): string {
  // ffmpeg-static returns null for an unsupported platform/arch.
  if (!resolved) return 'ffmpeg'
  // Segment-aware so an already-unpacked path is left alone and a sibling such
  // as `app.asar.bak` is not rewritten.
  return resolved.replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2')
}

export function ffmpegBinary(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return unpackedBinaryPath(require('ffmpeg-static') as string | null)
}
