import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import { join } from 'node:path'

export interface DownloadOptions {
  /** Abort the transfer. The `.part` file is kept so the next attempt can resume. */
  signal?: AbortSignal
}

/**
 * Download a file from a URL with progress reporting. Follows up to 10 redirects.
 * Writes to `<dest>.part` and renames on success so an interrupted download never
 * leaves a truncated file that looks installed. A kept `.part` is resumed with an
 * HTTP Range request on the next attempt.
 */
export function downloadFile(
  url: string,
  destPath: string,
  onProgress?: (percent: number, downloadedMB: number, totalMB: number) => void,
  options: DownloadOptions = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(join(destPath, '..'), { recursive: true })
    const tmpPath = `${destPath}.part`
    let file: fs.WriteStream | null = null
    let activeReq: http.ClientRequest | null = null
    let settled = false
    let redirectCount = 0
    let restarted = false

    const cleanup = (keepPartial: boolean) => {
      if (!keepPartial) {
        file?.destroy()
        try {
          fs.unlinkSync(tmpPath)
        } catch {
          /* already gone */
        }
      }
    }

    const fail = (err: Error, keepPartial = true) => {
      if (settled) return
      settled = true
      options.signal?.removeEventListener('abort', onAbort)
      if (file && keepPartial) {
        // Flush buffered bytes before rejecting so the next attempt can resume.
        try {
          file.end(() => reject(err))
        } catch {
          reject(err)
        }
        return
      }
      cleanup(keepPartial)
      reject(err)
    }

    const succeed = () => {
      if (settled) return
      settled = true
      options.signal?.removeEventListener('abort', onAbort)
      resolve()
    }

    const onAbort = () => {
      // Stop the socket first, then flush the bytes already received.
      activeReq?.destroy()
      fail(new Error('Download cancelled'), true)
    }

    if (options.signal?.aborted) {
      onAbort()
      return
    }
    options.signal?.addEventListener('abort', onAbort, { once: true })

    let existingBytes = (() => {
      try {
        return fs.statSync(tmpPath).size
      } catch {
        return 0
      }
    })()

    const get = (u: string) => {
      if (settled) return
      if (redirectCount++ > 10) return fail(new Error('Too many redirects'), false)
      const mod = u.startsWith('https') ? https : http
      const headers = existingBytes > 0 ? { Range: `bytes=${existingBytes}-` } : undefined
      const req = mod
        .get(u, { headers }, (res) => {
          if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 303 || res.statusCode === 307) {
            res.resume()
            return get(res.headers.location!)
          }
          if (res.statusCode === 416 && existingBytes > 0 && !restarted) {
            // The partial file is at least as large as the remote object — start clean.
            restarted = true
            res.resume()
            fs.rmSync(tmpPath, { force: true })
            existingBytes = 0
            return get(u)
          }
          if (res.statusCode !== 200 && res.statusCode !== 206) {
            res.resume()
            return fail(new Error(`HTTP ${res.statusCode} for ${u}`), false)
          }

          const resuming = res.statusCode === 206 && existingBytes > 0
          if (resuming) {
            const start = /bytes (\d+)-/.exec(String(res.headers['content-range'] ?? ''))
            const startByte = start ? parseInt(start[1], 10) : existingBytes
            if (startByte !== existingBytes) {
              // A server that honours Range from the wrong offset would corrupt
              // the file; restart from zero instead.
              res.resume()
              if (restarted) return fail(new Error('Server returned an unexpected range'), false)
              restarted = true
              fs.rmSync(tmpPath, { force: true })
              existingBytes = 0
              return get(u)
            }
          }
          file = fs.createWriteStream(tmpPath, { flags: resuming ? 'a' : 'w' })
          file.on('error', (e) => fail(e, true))

          let downloaded = resuming ? existingBytes : 0
          let total = 0
          if (resuming) {
            const range = /bytes (\d+)-\d+\/(\d+)/.exec(String(res.headers['content-range'] ?? ''))
            const remaining = parseInt(String(res.headers['content-length'] ?? '0'), 10)
            total = range ? parseInt(range[2], 10) : downloaded + remaining
          } else {
            total = parseInt(String(res.headers['content-length'] ?? '0'), 10)
          }

          if (total > 0 && onProgress) {
            onProgress(
              Math.round((downloaded / total) * 100),
              Math.round(downloaded / 1024 / 1024),
              Math.round(total / 1024 / 1024),
            )
          }

          res.on('data', (chunk: Buffer) => {
            downloaded += chunk.length
            file?.write(chunk)
            if (total > 0 && onProgress) {
              onProgress(
                Math.round((downloaded / total) * 100),
                Math.round(downloaded / 1024 / 1024),
                Math.round(total / 1024 / 1024),
              )
            }
          })

          res.on('end', () => {
            // A clean FIN with a short body still yields 'end'. Never promote an
            // incomplete file to a "ready" model.
            if (!res.complete || (total > 0 && downloaded < total)) {
              return fail(new Error(`Incomplete download (${downloaded}/${total || '?'} bytes)`), true)
            }
            file?.close(() => {
              try {
                fs.renameSync(tmpPath, destPath)
                succeed()
              } catch (e) {
                fail(e as Error, true)
              }
            })
          })
          res.on('error', (e: Error) => fail(e, true))
        })
        .on('error', (e: Error) => fail(e, true))
      // Fail stalled sockets so a dead transfer cannot block every retry for the session.
      req.setTimeout(30_000, () => req.destroy(new Error('Download stalled')))
      activeReq = req
    }
    get(url)
  })
}
