import { useEffect, useState, type ReactNode } from 'react'
import { Section, Slider, Toggle } from '../control/ui'
import { FrameThumb } from './ImportStep'
import { ImageEditor, type Tool } from './ImageEditor'
import { crop, erodeEdges, featherEdges, flip, hasTransparentBorder, opaqueBounds, removeBackground, resize, rotate, type Rect } from './imageOps'
import { applyGeometry, pushHistory, redo, resetFrame, undo, type StudioDoc, type StudioFrame } from './model'

interface Props {
  doc: StudioDoc
  selected: string | null
  onSelect(id: string): void
  onChange(): void
}

/** Stage 2: isolate the character — background removal, brushes, crop, rotate, resize, edges. */
export function PrepareStep({ doc, selected, onSelect, onChange }: Props): ReactNode {
  const frame = doc.frames.find((f) => f.id === selected) ?? doc.frames[0]
  const [tool, setTool] = useState<Tool>('erase')
  const [brush, setBrush] = useState(24)
  const [hardness, setHardness] = useState(0.6)
  const [tolerance, setTolerance] = useState(28)
  const [softness, setSoftness] = useState(30)
  const [allFrames, setAllFrames] = useState(doc.frames.length > 1)
  const [cropRect, setCropRect] = useState<Rect | null>(null)
  const [angle, setAngle] = useState(0)
  const [scalePct, setScalePct] = useState(100)
  const [busy, setBusy] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => setCropRect(null), [frame?.id])
  if (!frame) return <p className="muted">Import an image first.</p>

  const targets = (): StudioFrame[] => (allFrames ? doc.frames : [frame])
  const changed = (): void => {
    setVersion((v) => v + 1)
    onChange()
  }

  /** Run a heavy pixel operation after the UI has had a chance to show the busy state. */
  function heavy(label: string, fn: () => void): void {
    setBusy(label)
    setTimeout(() => {
      try {
        fn()
      } finally {
        setBusy(null)
        changed()
      }
    }, 30)
  }

  function autoRemove(): void {
    heavy('Removing background…', () => {
      let total = 0
      let skipped = 0
      for (const f of targets()) {
        if (hasTransparentBorder(f.work)) {
          skipped++
          continue
        }
        pushHistory(f)
        total += removeBackground(f.work, tolerance, softness)
      }
      const n = targets().length - skipped
      setNotice(
        n === 0
          ? 'These images already have a transparent background, so nothing was removed.'
          : total / Math.max(1, n) < 0.05
            ? 'Very little was removed. Try raising the tolerance, or use the eraser for busy backgrounds.'
            : `Removed the background from ${n} image${n > 1 ? 's' : ''}. Check the edges and touch up with the eraser or restore brush.`
      )
    })
  }

  const hist = frame.history

  return (
    <div className="studio-grid">
      <div>
        <div className="editor-toolbar">
          {(['pan', 'erase', 'restore', 'wand', 'crop'] as Tool[]).map((t) => (
            <button key={t} className={`tool${tool === t ? ' on' : ''}`} onClick={() => setTool(t)}>
              {{ pan: '✋ Pan', erase: '⌫ Eraser', restore: '✚ Restore', wand: '✦ Magic wand', crop: '⛶ Crop', anchor: '' }[t]}
            </button>
          ))}
          <span className="sep" />
          <button className="tool" disabled={!hist.undo.length} onClick={() => undo(frame) && changed()}>↶ Undo</button>
          <button className="tool" disabled={!hist.redo.length} onClick={() => redo(frame) && changed()}>↷ Redo</button>
          <button className="tool" onClick={() => { resetFrame(frame); changed() }}>Reset</button>
          <span className="grow" />
          {busy && <span className="muted small">{busy}</span>}
        </div>
        <ImageEditor
          frame={frame}
          tool={tool}
          brush={brush}
          hardness={hardness}
          version={version}
          cropRect={tool === 'crop' ? cropRect : null}
          onCropRect={setCropRect}
          onStrokeStart={() => pushHistory(frame)}
          onStrokeEnd={changed}
          onWand={(pt) => {
            pushHistory(frame)
            const cleared = removeBackground(frame.work, tolerance, softness, pt)
            if (cleared === 0) frame.history.undo.pop()
            setNotice(cleared === 0 ? 'Nothing to clear there. Click inside a background area.' : 'Cleared that area. Undo if it took too much.')
            changed()
          }}
        />
        <p className="muted small">Hold Space to pan while using a brush. Pinch or ⌘-scroll to zoom. {frame.work.width}×{frame.work.height}px.</p>
        {doc.frames.length > 1 && (
          <div className="frames">
            {doc.frames.map((f, i) => (
              <button key={f.id} className={`frame${f.id === frame.id ? ' on' : ''}`} onClick={() => onSelect(f.id)}>
                <span className="idx">{i + 1}</span>
                <FrameThumb canvas={f.work} size={64} />
              </button>
            ))}
          </div>
        )}
      </div>

      <aside className="studio-side">
        <Section title="Background removal" description="Runs on this Mac. Best on plain or simple backgrounds.">
          <Slider label="Tolerance" value={tolerance} min={0} max={100} onChange={setTolerance} />
          <Slider label="Edge softness" value={softness} min={0} max={100} onChange={setSoftness} />
          {doc.frames.length > 1 && <Toggle label="Apply to all frames" checked={allFrames} onChange={setAllFrames} />}
          <button className="btn primary" disabled={!!busy} onClick={autoRemove}>Remove background</button>
          {notice && <p className="notice" style={{ marginTop: 8 }}>{notice}</p>}
        </Section>

        {(tool === 'erase' || tool === 'restore') && (
          <Section title={tool === 'erase' ? 'Eraser' : 'Restore brush'} description={tool === 'restore' ? 'Paints the original pixels back.' : undefined}>
            <Slider label="Size" value={brush} min={2} max={200} format={(v) => `${v}px`} onChange={setBrush} />
            <Slider label="Hardness" value={hardness} min={0} max={0.95} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={setHardness} />
          </Section>
        )}

        {tool === 'wand' && (
          <Section title="Magic wand" description="Click an area to clear it, such as background showing through a gap the automatic removal can’t reach. Uses the tolerance above." >
            <Slider label="Tolerance" value={tolerance} min={0} max={100} onChange={setTolerance} />
          </Section>
        )}

        {tool === 'crop' && (
          <Section title="Crop" description="Drag a box on the image.">
            <div className="row gap wrap">
              <button
                className="btn primary small"
                disabled={!cropRect || cropRect.w < 2 || cropRect.h < 2}
                onClick={() => {
                  const r = cropRect!
                  for (const f of allFrames ? doc.frames.filter((x) => x.work.width === frame.work.width && x.work.height === frame.work.height) : [frame]) {
                    applyGeometry(f, (c) => crop(c, r))
                  }
                  setCropRect(null)
                  changed()
                }}
              >
                Apply crop
              </button>
              <button
                className="btn small"
                onClick={() =>
                  heavy('Trimming…', () => {
                    // Frames of the same size share one box (their union), so the animation doesn't jitter.
                    const groups = new Map<string, StudioFrame[]>()
                    for (const f of targets()) {
                      const k = `${f.work.width}x${f.work.height}`
                      groups.set(k, [...(groups.get(k) ?? []), f])
                    }
                    for (const list of groups.values()) {
                      const boxes = list.map((f) => opaqueBounds(f.work)).filter((b): b is Rect => !!b)
                      if (!boxes.length) continue
                      const x0 = Math.min(...boxes.map((b) => b.x))
                      const y0 = Math.min(...boxes.map((b) => b.y))
                      const x1 = Math.max(...boxes.map((b) => b.x + b.w))
                      const y1 = Math.max(...boxes.map((b) => b.y + b.h))
                      for (const f of list) applyGeometry(f, (c) => crop(c, { x: x0 - 2, y: y0 - 2, w: x1 - x0 + 4, h: y1 - y0 + 4 }))
                    }
                  })
                }
              >
                Trim transparent edges
              </button>
            </div>
            {allFrames && doc.frames.length > 1 && <p className="muted small">The crop box applies to every frame of the same size, so the animation stays aligned.</p>}
          </Section>
        )}

        <Section title="Refine edges">
          <div className="row gap wrap">
            <button className="btn small" onClick={() => heavy('Refining…', () => targets().forEach((f) => { pushHistory(f); erodeEdges(f.work, 1) }))}>Shrink edge 1px</button>
            <button className="btn small" onClick={() => heavy('Feathering…', () => targets().forEach((f) => { pushHistory(f); featherEdges(f.work, 2) }))}>Feather 2px</button>
          </div>
        </Section>

        <Section title="Transform">
          <div className="row gap wrap">
            <button className="btn small" onClick={() => { targets().forEach((f) => applyGeometry(f, (c) => rotate(c, -90))); changed() }}>⟲ 90°</button>
            <button className="btn small" onClick={() => { targets().forEach((f) => applyGeometry(f, (c) => rotate(c, 90))); changed() }}>⟳ 90°</button>
            <button className="btn small" onClick={() => { targets().forEach((f) => applyGeometry(f, flip)); changed() }}>⇋ Flip</button>
          </div>
          <Slider label="Rotate" value={angle} min={-180} max={180} format={(v) => `${v}°`} onChange={setAngle} />
          <button className="btn small" disabled={angle === 0} onClick={() => { targets().forEach((f) => applyGeometry(f, (c) => rotate(c, angle))); setAngle(0); changed() }}>Apply rotation</button>
          <Slider label="Resize" value={scalePct} min={10} max={200} format={(v) => `${v}%`} onChange={setScalePct} />
          <button
            className="btn small"
            disabled={scalePct === 100}
            onClick={() => {
              targets().forEach((f) => applyGeometry(f, (c) => resize(c, scalePct / 100)))
              setScalePct(100)
              changed()
            }}
          >
            Apply resize
          </button>
        </Section>
      </aside>
    </div>
  )
}
