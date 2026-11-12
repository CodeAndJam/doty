import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import { join } from 'node:path'

/**
 * Download a file from a URL with progress reporting. Follows up to 10 redirects.
 * Writes to `<dest>.part` and renames on success so an interrupted download never
 * leaves a truncated file that looks installed.
 */
export function downloadFile(
  url: string,
  destPath: string,
  onProgress?: (percent: number, downloadedMB: number, totalMB: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(join(destPath, '..'), { recursive: true })
    const tmpPath = `${destPath}.part`
    const file = fs.createWriteStream(tmpPath)
    const cleanup = () => {
      file.destroy()
      try {
        fs.unlinkSync(tmpPath)
      } catch {
        /* already gone */
      }
    }
    let redirectCount = 0
    const get = (u: string) => {
      if (redirectCount++ > 10) return reject(new Error('Too many redirects'))
      const mod = u.startsWith('https') ? https : http
      const req = mod
        .get(u, (res) => {
          if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 303 || res.statusCode === 307) {
            res.resume()
            return get(res.headers.location!)
          }
          if (res.statusCode !== 200) {
            res.resume()
            cleanup()
            return reject(new Error(`HTTP ${res.statusCode} for ${u}`))
          }
          const total = parseInt(res.headers['content-length'] || '0', 10)
          let downloaded = 0
          res.on('data', (chunk: Buffer) => {
            downloaded += chunk.length
            file.write(chunk)
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
              cleanup()
              reject(new Error(`Incomplete download (${downloaded}/${total || '?'} bytes)`))
              return
            }
            file.close(() => {
              try {
                fs.renameSync(tmpPath, destPath)
                resolve()
              } catch (e) {
                cleanup()
                reject(e)
              }
            })
          })
          res.on('error', (e: Error) => {
            cleanup()
            reject(e)
          })
        })
        .on('error', (e: Error) => {
          cleanup()
          reject(e)
        })
      // Fail stalled sockets so a dead transfer cannot block every retry for the session.
      req.setTimeout(30_000, () => req.destroy(new Error('Download stalled')))
    }
    file.on('error', (e) => {
      cleanup()
      reject(e)
    })
    get(url)
  })
}
