import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Where every downloaded model lives. Home-based rather than `app.getPath('home')`
 * so modules that only need this path stay importable without Electron (and in
 * tests). The two resolve to the same directory.
 */
export const MODELS_DIR = join(homedir(), '.doty', 'models')
