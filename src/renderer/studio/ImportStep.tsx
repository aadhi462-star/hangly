import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useUi } from '../control/store'
import { Section } from '../control/ui'
import { decodeFrames, detectGrid, sliceGrid } from './imageOps'
import { newFrame, type StudioDoc } from './model'

const ACCEPT = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
const MAX_BYTES = 40 * 1024 * 1024

interface Props {
  doc: StudioDoc
  selected: string | null
  onSelect(id: string): void
  onChange(): void
}

/** Stage 1: bring images in — single images, multiple frames, animated GIF/WebP or a sprite sheet. */
export function ImportStep({ doc, selected, onSelect, onChange }: Props): ReactNode {
  const toast = useUi((s) => s.toast)
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [sheet, setSheet] = useState<{ canvas: HTMLCanvasElement; name: string; original: Uint8Array; ext: string } | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const replaceInput = useRef<HTMLInputElement>(null)

  async function readFile(file: File): Promise<{ frames: { canvas: HTMLCanvasElement; duration: number }[]; bytes: Uint8Array; ext: string } | null> {
    if (!ACCEPT.includes(file.type)) {
      toast(`${file.name}: only PNG, JPEG, WebP and GIF are supported.`, 'error')
      return null
    }
    if (file.size > MAX_BYTES) {
      toast(`${file.name} is larger than 40 MB.`, 'error')
      return null
    }
    try {
      const frames = await decodeFrames(file, file.type)
      const ext = file.type === 'image/jpeg' ? 'jpg' : file.type.split('/')[1]
      return { frames, bytes: new Uint8Array(await file.arrayBuffer()), ext }
    } catch {
      toast(`Couldn’t read ${file.name}. Is it a valid image?`, 'error')
      return null
    }
  }

  async function addFiles(files: FileList | File[], asSheet: boolean): Promise<void> {
    setBusy(true)
    try {
      const list = [...files]
      if (asSheet && list[0]) {
        const r = await readFile(list[0])
        if (r) setSheet({ canvas: r.frames[0].canvas, name: list[0].name, original: r.bytes, ext: r.ext })
        return
      }
      let first: string | null = null
      for (const file of list) {
        const r = await readFile(file)
        if (!r) continue
        r.frames.forEach((fr, i) => {
          const label = r.frames.length > 1 ? `${file.name} #${i + 1}` : file.name
          // Keep the original bytes once per file, on its first frame.
          const f = newFrame(fr.canvas, label, fr.duration, i === 0 ? { bytes: r.bytes, ext: r.ext } : undefined)
          doc.frames.push(f)
          const idle = (doc.sequences.idle ??= { frameIds: [], loop: true })
          idle.frameIds.push(f.id)
          first ??= f.id
        })
      }
      if (!selected && first) onSelect(first)
      onChange()
    } finally {
      setBusy(false)
    }
  }

  async function replace(file: File): Promise<void> {
    const f = doc.frames.find((x) => x.id === selected)
    if (!f) return
    const r = await readFile(file)
    if (!r) return
    const fresh = newFrame(r.frames[0].canvas, file.name, f.duration, { bytes: r.bytes, ext: r.ext })
    Object.assign(f, { work: fresh.work, source: fresh.source, original: fresh.original, label: fresh.label, history: fresh.history })
    onChange()
  }

  function remove(id: string): void {
    doc.frames = doc.frames.filter((f) => f.id !== id)
    for (const s of Object.values(doc.sequences)) if (s) s.frameIds = s.frameIds.filter((x) => x !== id)
    onChange()
  }

  return (
    <div className="studio-grid">
      <div className="col gap">
        {sheet ? (
          <SpriteSheetSlicer
            sheet={sheet}
            onCancel={() => setSheet(null)}
            onImport={(canvases, duration) => {
              canvases.forEach((c, i) => {
                const f = newFrame(c, `${sheet.name} #${i + 1}`, duration, i === 0 ? { bytes: sheet.original, ext: sheet.ext } : undefined)
                doc.frames.push(f)
                ;(doc.sequences.idle ??= { frameIds: [], loop: true }).frameIds.push(f.id)
              })
              if (!selected && doc.frames[0]) onSelect(doc.frames[0].id)
              setSheet(null)
              onChange()
            }}
          />
        ) : (
          <div
            className={`dropzone${over ? ' over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault()
              setOver(true)
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setOver(false)
              void addFiles(e.dataTransfer.files, false)
            }}
          >
            <div className="big" aria-hidden>🖼️</div>
            <h3>{busy ? 'Reading images…' : 'Drop images here'}</h3>
            <p className="muted">
              PNG, JPEG, WebP or GIF, up to 40 MB each. Drop several files to make animation frames; animated GIF and WebP are split into frames
              automatically.
            </p>
            <div className="row gap">
              <button className="btn primary" disabled={busy} onClick={() => input.current?.click()}>Choose images</button>
              <label className="btn">
                Import sprite sheet
                <input type="file" hidden accept={ACCEPT.join(',')} onChange={(e) => e.target.files && void addFiles(e.target.files, true)} />
              </label>
            </div>
            <input ref={input} type="file" hidden multiple accept={ACCEPT.join(',')} onChange={(e) => e.target.files && void addFiles(e.target.files, false)} />
          </div>
        )}
        <p className="muted small">Your images stay on this Mac. Originals are stored untouched next to the edited versions.</p>
      </div>

      <aside className="studio-side">
        <Section title={`Frames (${doc.frames.length})`}>
          {doc.frames.length === 0 ? (
            <p className="muted small">Nothing imported yet.</p>
          ) : (
            <div className="col gap-s">
              {doc.frames.map((f, i) => (
                <div key={f.id} className={`frame-row${f.id === selected ? ' on' : ''}`} onClick={() => onSelect(f.id)}>
                  <FrameThumb canvas={f.work} />
                  <span className="grow">
                    <strong className="ellipsis">{i + 1}. {f.label}</strong>
                    <span className="muted small">{f.work.width}×{f.work.height}px</span>
                  </span>
                  <button className="icon-btn danger" aria-label="Remove frame" onClick={(e) => { e.stopPropagation(); remove(f.id) }}>✕</button>
                </div>
              ))}
              <button className="btn small" disabled={!selected} onClick={() => replaceInput.current?.click()}>Replace selected image</button>
              <input ref={replaceInput} type="file" hidden accept={ACCEPT.join(',')} onChange={(e) => e.target.files?.[0] && void replace(e.target.files[0])} />
            </div>
          )}
        </Section>
      </aside>
    </div>
  )
}

export function FrameThumb({ canvas, size = 56 }: { canvas: HTMLCanvasElement; size?: number }): ReactNode {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const k = Math.min(size / canvas.width, size / canvas.height)
    c.width = size * 2
    c.height = size * 2
    const g = c.getContext('2d')!
    g.clearRect(0, 0, c.width, c.height)
    const w = canvas.width * k * 2
    const h = canvas.height * k * 2
    g.drawImage(canvas, (c.width - w) / 2, (c.height - h) / 2, w, h)
  })
  return <canvas ref={ref} className="checker frame-thumb" style={{ width: size, height: size, borderRadius: 6 }} />
}

function SpriteSheetSlicer(props: {
  sheet: { canvas: HTMLCanvasElement; name: string }
  onCancel(): void
  onImport(frames: HTMLCanvasElement[], duration: number): void
}): ReactNode {
  const { canvas } = props.sheet
  const [grid, setGrid] = useState(() => detectGrid(canvas))
  const [picked, setPicked] = useState<Set<number>>(() => new Set(Array.from({ length: grid.rows * grid.cols }, (_, i) => i)))
  const [fps, setFps] = useState(10)
  const ref = useRef<HTMLCanvasElement>(null)
  const total = grid.rows * grid.cols

  useEffect(() => setPicked(new Set(Array.from({ length: total }, (_, i) => i))), [grid.rows, grid.cols])

  useEffect(() => {
    const c = ref.current
    if (!c) return
    const k = Math.min(1, 700 / canvas.width, 420 / canvas.height)
    c.width = canvas.width * k
    c.height = canvas.height * k
    const g = c.getContext('2d')!
    g.drawImage(canvas, 0, 0, c.width, c.height)
    const cw = c.width / grid.cols
    const ch = c.height / grid.rows
    for (let i = 0; i < total; i++) {
      const x = (i % grid.cols) * cw
      const y = Math.floor(i / grid.cols) * ch
      if (!picked.has(i)) {
        g.fillStyle = 'rgba(0,0,0,0.45)'
        g.fillRect(x, y, cw, ch)
      }
      g.strokeStyle = 'rgba(240,112,46,0.9)'
      g.lineWidth = 1
      g.strokeRect(x + 0.5, y + 0.5, cw - 1, ch - 1)
      g.fillStyle = '#fff'
      g.font = '11px -apple-system'
      g.fillText(String(i + 1), x + 4, y + 13)
    }
  }, [grid, picked, canvas, total])

  return (
    <Section title={`Slice sprite sheet — ${props.sheet.name}`} description={`${canvas.width}×${canvas.height}px. Click cells to include or skip them; frames import in reading order.`}>
      <div className="row gap wrap" style={{ marginBottom: 10 }}>
        <label className="field inline"><span className="field-label">Rows</span>
          <input type="number" min={1} max={32} value={grid.rows} onChange={(e) => setGrid({ ...grid, rows: Math.max(1, Math.min(32, Number(e.target.value) || 1)) })} />
        </label>
        <label className="field inline"><span className="field-label">Columns</span>
          <input type="number" min={1} max={32} value={grid.cols} onChange={(e) => setGrid({ ...grid, cols: Math.max(1, Math.min(32, Number(e.target.value) || 1)) })} />
        </label>
        <button className="btn small" onClick={() => setGrid(detectGrid(canvas))}>Auto-detect</button>
        <label className="field inline"><span className="field-label">Frame rate</span>
          <input type="number" min={1} max={60} value={fps} onChange={(e) => setFps(Math.max(1, Math.min(60, Number(e.target.value) || 10)))} />
        </label>
      </div>
      <canvas
        ref={ref}
        className="checker"
        style={{ maxWidth: '100%', borderRadius: 8, cursor: 'pointer' }}
        onClick={(e) => {
          const r = (e.target as HTMLCanvasElement).getBoundingClientRect()
          const col = Math.floor(((e.clientX - r.left) / r.width) * grid.cols)
          const row = Math.floor(((e.clientY - r.top) / r.height) * grid.rows)
          const i = row * grid.cols + col
          const next = new Set(picked)
          if (next.has(i)) next.delete(i)
          else next.add(i)
          setPicked(next)
        }}
      />
      <div className="row gap end" style={{ marginTop: 10 }}>
        <span className="muted small grow">{picked.size} of {total} frames selected</span>
        <button className="btn" onClick={props.onCancel}>Cancel</button>
        <button
          className="btn primary"
          disabled={picked.size === 0}
          onClick={() => props.onImport(sliceGrid(canvas, grid.rows, grid.cols, [...picked].sort((a, b) => a - b)), Math.round(1000 / fps))}
        >
          Import {picked.size} frames
        </button>
      </div>
    </Section>
  )
}
