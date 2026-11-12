// @vitest-environment node
import fs from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { downloadFile } from './download-file'

const servers: http.Server[] = []
const dirs: string[] = []

function startServer(handler: http.RequestListener): Promise<string> {
  return new Promise((resolve) => {
    const server = http.createServer(handler)
    servers.push(server)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve(`http://127.0.0.1:${(address as { port: number }).port}`)
    })
  })
}

function tempDir(): string {
  const dir = fs.mkdtempSync(join(tmpdir(), 'doty-download-'))
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (s) =>
        new Promise((r) => {
          s.closeAllConnections()
          s.close(r)
        }),
    ),
  )
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('downloadFile', () => {
  it('writes the file atomically and reports progress', async () => {
    const body = Buffer.from('model-bytes')
    const url = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Length': String(body.length) })
      res.end(body)
    })
    const dir = tempDir()
    const dest = join(dir, 'model.gguf')
    const percents: number[] = []

    await downloadFile(url, dest, (percent) => percents.push(percent))

    expect(fs.readFileSync(dest)).toEqual(body)
    expect(fs.existsSync(`${dest}.part`)).toBe(false)
    expect(percents.at(-1)).toBe(100)
  })

  it('resumes from the existing .part with a Range request', async () => {
    const body = Buffer.from('model-bytes')
    let rangeHeader: string | undefined
    const url = await startServer((req, res) => {
      rangeHeader = req.headers.range
      const start = Number(req.headers.range?.match(/bytes=(\d+)-/)?.[1] ?? 0)
      res.writeHead(206, {
        'Content-Length': String(body.length - start),
        'Content-Range': `bytes ${start}-${body.length - 1}/${body.length}`,
      })
      res.end(body.subarray(start))
    })
    const dir = tempDir()
    const dest = join(dir, 'model.gguf')
    fs.writeFileSync(`${dest}.part`, body.subarray(0, 6))

    await downloadFile(url, dest)

    expect(rangeHeader).toBe('bytes=6-')
    expect(fs.readFileSync(dest)).toEqual(body)
    expect(fs.existsSync(`${dest}.part`)).toBe(false)
  })

  it('restarts from scratch when the server ignores the Range request', async () => {
    const body = Buffer.from('model-bytes')
    const url = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Length': String(body.length) })
      res.end(body)
    })
    const dir = tempDir()
    const dest = join(dir, 'model.gguf')
    fs.writeFileSync(`${dest}.part`, 'stale-')

    await downloadFile(url, dest)

    expect(fs.readFileSync(dest)).toEqual(body)
  })

  it('restarts from scratch when the server rejects the Range with 416', async () => {
    const body = Buffer.from('model-bytes')
    const ranges: Array<string | undefined> = []
    const url = await startServer((req, res) => {
      ranges.push(req.headers.range)
      if (req.headers.range) {
        res.writeHead(416)
        res.end()
        return
      }
      res.writeHead(200, { 'Content-Length': String(body.length) })
      res.end(body)
    })
    const dir = tempDir()
    const dest = join(dir, 'model.gguf')
    fs.writeFileSync(`${dest}.part`, body.subarray(0, 6))

    await downloadFile(url, dest)

    expect(ranges).toEqual(['bytes=6-', undefined])
    expect(fs.readFileSync(dest)).toEqual(body)
  })

  it('restarts from scratch when the server answers 206 from the wrong offset', async () => {
    const body = Buffer.from('model-bytes')
    let requests = 0
    const url = await startServer((req, res) => {
      requests++
      if (req.headers.range) {
        res.writeHead(206, {
          'Content-Length': String(body.length),
          'Content-Range': `bytes 0-${body.length - 1}/${body.length}`,
        })
        res.end(body)
        return
      }
      res.writeHead(200, { 'Content-Length': String(body.length) })
      res.end(body)
    })
    const dir = tempDir()
    const dest = join(dir, 'model.gguf')
    fs.writeFileSync(`${dest}.part`, body.subarray(0, 6))

    await downloadFile(url, dest)

    expect(requests).toBe(2)
    expect(fs.readFileSync(dest)).toEqual(body)
  })

  it('keeps the partial file for resume when the connection drops', async () => {
    const url = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Length': '100' })
      res.write('short')
      setTimeout(() => res.destroy(), 10)
    })
    const dir = tempDir()
    const dest = join(dir, 'model.gguf')

    await expect(downloadFile(url, dest)).rejects.toThrow()

    expect(fs.existsSync(dest)).toBe(false)
    expect(fs.readFileSync(`${dest}.part`).toString()).toBe('short')
  })

  it('stops on abort and keeps the partial file', async () => {
    const url = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Length': '1000' })
      res.write('partial')
    })
    const dir = tempDir()
    const dest = join(dir, 'model.gguf')
    const controller = new AbortController()

    const download = downloadFile(
      url,
      dest,
      (percent) => {
        if (percent > 0 && !controller.signal.aborted) controller.abort()
      },
      { signal: controller.signal },
    )

    await expect(download).rejects.toThrow(/cancelled/i)
    expect(fs.readFileSync(`${dest}.part`).toString()).toBe('partial')
  })

  it('rejects and cleans up on a non-200 response', async () => {
    const url = await startServer((_req, res) => {
      res.writeHead(404)
      res.end('nope')
    })
    const dir = tempDir()
    const dest = join(dir, 'model.gguf')

    await expect(downloadFile(url, dest)).rejects.toThrow('HTTP 404')

    expect(fs.existsSync(dest)).toBe(false)
    expect(fs.existsSync(`${dest}.part`)).toBe(false)
  })
})
