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
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))))
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

  it('rejects and leaves no file when the connection drops mid-body', async () => {
    const url = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Length': '100' })
      res.write('short')
      setTimeout(() => res.destroy(), 10)
    })
    const dir = tempDir()
    const dest = join(dir, 'model.gguf')

    await expect(downloadFile(url, dest)).rejects.toThrow()

    expect(fs.existsSync(dest)).toBe(false)
    expect(fs.existsSync(`${dest}.part`)).toBe(false)
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
