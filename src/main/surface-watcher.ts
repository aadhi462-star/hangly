import { app } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export interface WindowRect {
  id: number
  x: number
  y: number
  w: number
  h: number
}

/**
 * Runs the native helper that reports other apps' window rectangles (front to
 * back) so characters can stand on window tops. Geometry only: no titles,
 * contents or screenshots.
 */
export class SurfaceWatcher {
  private child: ChildProcess | null = null
  private buffer = ''
  rects: WindowRect[] = []

  constructor(private onChange: (rects: WindowRect[]) => void) {}

  private binary(): string | null {
    if (process.platform !== 'darwin') return null
    const p = app.isPackaged ? join(process.resourcesPath, 'window-surfaces') : join(app.getAppPath(), 'resources', 'window-surfaces')
    return existsSync(p) ? p : null
  }

  start(): void {
    if (this.child) return
    const bin = this.binary()
    if (!bin) {
      console.warn('[surfaces] helper not found; characters will use screen edges only')
      return
    }
    // Screenly' own panel counts as a surface too; the overlays are never included (they aren't normal-level windows).
    const child = spawn(bin, ['-1'], { stdio: ['pipe', 'pipe', 'ignore'] })
    this.child = child
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      this.buffer += chunk
      let nl: number
      while ((nl = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, nl)
        this.buffer = this.buffer.slice(nl + 1)
        try {
          const parsed = JSON.parse(line) as WindowRect[]
          if (Array.isArray(parsed)) {
            this.rects = parsed.filter((r) => [r.id, r.x, r.y, r.w, r.h].every(Number.isFinite)).slice(0, 80)
            this.onChange(this.rects)
          }
        } catch {
          /* partial or malformed line: ignore */
        }
      }
    })
    child.on('exit', () => {
      if (this.child === child) this.child = null
    })
  }

  stop(): void {
    // Closing stdin makes the helper exit on its own.
    this.child?.stdin?.end()
    this.child?.kill()
    this.child = null
    this.rects = []
    this.onChange([])
  }
}
