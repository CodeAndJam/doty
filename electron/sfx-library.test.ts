import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { listSfx } from './sfx-library'

const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'doty-sfx-'))
fs.mkdirSync(path.join(folder, 'Door'), { recursive: true })
fs.writeFileSync(path.join(folder, 'Door', 'slam.wav'), 'not really a wav')
fs.writeFileSync(path.join(folder, 'roar.mp3'), 'nor this')

afterAll(() => fs.rmSync(folder, { recursive: true, force: true }))

describe('listSfx', () => {
  it('reports a measured duration when the cache has one', () => {
    const items = listSfx(folder, { [path.join(folder, 'Door', 'slam.wav')]: 2.5 })
    const slam = items.find((item) => item.id === 'Door/slam.wav')
    const roar = items.find((item) => item.id === 'roar.mp3')
    expect(slam?.duration).toBe(2.5)
    // Unprobed stays 0, which the lane rule reads as "no evidence", not as zero.
    expect(roar?.duration).toBe(0)
  })
})
