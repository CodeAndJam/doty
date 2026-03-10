import { app } from 'electron'
import { join } from 'path'
import fs from 'fs'

interface StoreData {
  musicFolder?: string
  modelPath?: string
}

const storePath = join(app.getPath('userData'), 'config.json')

function read(): StoreData {
  try {
    return JSON.parse(fs.readFileSync(storePath, 'utf-8'))
  } catch {
    return {}
  }
}

function write(data: StoreData): void {
  fs.mkdirSync(join(storePath, '..'), { recursive: true })
  fs.writeFileSync(storePath, JSON.stringify(data, null, 2))
}

export const store = {
  get<K extends keyof StoreData>(key: K, fallback: StoreData[K]): StoreData[K] {
    return read()[key] ?? fallback
  },
  set<K extends keyof StoreData>(key: K, value: StoreData[K]): void {
    write({ ...read(), [key]: value })
  },
}
