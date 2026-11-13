import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { vi } from 'vitest'

/** Minimal Electron stand-in so main-process modules can be tested in Node. */
export const userData = mkdtempSync(join(tmpdir(), 'screenly-test-'))

vi.mock('electron', () => ({
  app: { getPath: () => userData, isPackaged: false, getAppPath: () => process.cwd() },
  dialog: { showSaveDialog: vi.fn(), showOpenDialog: vi.fn() },
  net: { fetch: vi.fn() },
  protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() }
}))
