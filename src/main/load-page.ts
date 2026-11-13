import type { BrowserWindow } from 'electron'
import { join } from 'node:path'

/** Load one of the renderer HTML entries, from the Vite dev server in dev or from disk when built. */
export async function loadPage(win: BrowserWindow, page: 'control' | 'overlay', query = ''): Promise<void> {
  const dev = process.env.ELECTRON_RENDERER_URL
  if (dev) await win.loadURL(`${dev}/${page}.html${query ? `?${query}` : ''}`)
  else await win.loadFile(join(__dirname, `../renderer/${page}.html`), { search: query })
}
