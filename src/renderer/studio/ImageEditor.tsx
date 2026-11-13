import { useEffect, useRef, useState, type ReactNode } from 'react'
import { dab, type Rect } from './imageOps'
import type { StudioFrame } from './model'

export type Tool = 'pan' | 'erase' | 'restore' | 'crop' | 'anchor' | 'wand'

interface Props {
  frame: StudioFrame
  tool: Tool
  brush: number
  hardness: number
  /** Bumped by the parent whenever the frame's pixels change outside the editor. */
  version: number
  cropRect: Rect | null
  onCropRect(r: Rect | null): void
  /** Called once at the start of every brush stroke, before pixels change. */
  onStrokeStart(): void
  onStrokeEnd(): void
  /** Suspension point, as a fraction of the image (anchor tool). */
  anchor?: { x: number; y: number }
  onAnchor?(p: { x: number; y: number }): void
  /** Magic wand click, in image pixels. */
  onWand?(p: { x: number; y: number }): void
  height?: number
}

/** Zoomable, pannable canvas view with brush, crop and anchor-point tools. */
export function ImageEditor(p: Props): ReactNode {
  const wrap = useRef<HTMLDivElement>(null)
  const view = useRef<HTMLCanvasElement>(null)
  const [vt, setVt] = useState({ zoom: 1, x: 0, y: 0 })
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)
  const drag = useRef<{ kind: 'pan' | 'paint' | 'crop'; sx: number; sy: number; ox: number; oy: number; last?: { x: number; y: number } } | null>(null)
  const space = useRef(false)

  const fit = (): void => {
    const el = wrap.current
    if (!el) return
    const { clientWidth: W, clientHeight: H } = el
    const z = Math.min((W - 40) / p.frame.work.width, (H - 40) / p.frame.work.height, 4)
    setVt({ zoom: z, x: (W - p.frame.work.width * z) / 2, y: (H - p.frame.work.height * z) / 2 })
  }

  useEffect(fit, [p.frame.id, p.frame.work.width, p.frame.work.height])
  // Refit when the view is resized or shown again (e.g. returning to the Studio page).
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      if (el.clientWidth > 0) fit()
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [p.frame.id])

  useEffect(() => {
    const down = (e: KeyboardEvent): void => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement)) {
        space.current = true
        e.preventDefault()
      }
    }
    const up = (e: KeyboardEvent): void => {
      if (e.code === 'Space') space.current = false
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  // Redraw
  useEffect(() => {
    const c = view.current
    const el = wrap.current
    if (!c || !el) return
    const dpr = window.devicePixelRatio || 1
    c.width = el.clientWidth * dpr
    c.height = el.clientHeight * dpr
    c.style.width = `${el.clientWidth}px`
    c.style.height = `${el.clientHeight}px`
    const g = c.getContext('2d')!
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, c.width, c.height)
    const { work } = p.frame
    g.imageSmoothingEnabled = vt.zoom < 2
    g.drawImage(work, vt.x, vt.y, work.width * vt.zoom, work.height * vt.zoom)
    g.strokeStyle = 'rgba(127,127,127,0.5)'
    g.setLineDash([4, 4])
    g.strokeRect(vt.x - 0.5, vt.y - 0.5, work.width * vt.zoom + 1, work.height * vt.zoom + 1)
    g.setLineDash([])
    if (p.cropRect) {
      const r = p.cropRect
      const x = vt.x + r.x * vt.zoom
      const y = vt.y + r.y * vt.zoom
      const w = r.w * vt.zoom
      const h = r.h * vt.zoom
      g.fillStyle = 'rgba(0,0,0,0.45)'
      g.fillRect(vt.x, vt.y, work.width * vt.zoom, y - vt.y)
      g.fillRect(vt.x, y + h, work.width * vt.zoom, vt.y + work.height * vt.zoom - y - h)
      g.fillRect(vt.x, y, x - vt.x, h)
      g.fillRect(x + w, y, vt.x + work.width * vt.zoom - x - w, h)
      g.strokeStyle = '#f0702e'
      g.lineWidth = 2
      g.strokeRect(x, y, w, h)
    }
    if (p.anchor && p.tool === 'anchor') {
      const ax = vt.x + p.anchor.x * work.width * vt.zoom
      const ay = vt.y + p.anchor.y * work.height * vt.zoom
      g.strokeStyle = '#e8e8f0'
      g.lineWidth = 1.5
      g.beginPath()
      g.moveTo(ax, 0)
      g.lineTo(ax, ay)
      g.stroke()
      g.fillStyle = '#f0702e'
      g.beginPath()
      g.arc(ax, ay, 6, 0, Math.PI * 2)
      g.fill()
      g.strokeStyle = '#fff'
      g.lineWidth = 2
      g.stroke()
    }
    if (cursor && (p.tool === 'erase' || p.tool === 'restore')) {
      g.strokeStyle = p.tool === 'erase' ? 'rgba(217,54,62,0.9)' : 'rgba(31,157,85,0.9)'
      g.lineWidth = 1.5
      g.beginPath()
      g.arc(cursor.x, cursor.y, p.brush * vt.zoom, 0, Math.PI * 2)
      g.stroke()
    }
  }, [vt, p.frame, p.frame.work, p.version, p.cropRect, cursor, p.tool, p.brush, p.anchor])

  const toImage = (cx: number, cy: number): { x: number; y: number } => ({ x: (cx - vt.x) / vt.zoom, y: (cy - vt.y) / vt.zoom })
  const local = (e: React.PointerEvent | React.WheelEvent): { x: number; y: number } => {
    const r = wrap.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  function paint(from: { x: number; y: number }, to: { x: number; y: number }): void {
    const mode = p.tool === 'erase' ? 'erase' : 'restore'
    const step = Math.max(1, p.brush * 0.3)
    const dist = Math.hypot(to.x - from.x, to.y - from.y)
    const n = Math.max(1, Math.ceil(dist / step))
    for (let i = 1; i <= n; i++) {
      const t = i / n
      dab(p.frame.work, p.frame.source, mode, from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t, p.brush, p.hardness)
    }
  }

  const cursorStyle = p.tool === 'pan' || space.current ? 'grab' : p.tool === 'crop' || p.tool === 'anchor' || p.tool === 'wand' ? 'crosshair' : 'none'

  return (
    <div
      ref={wrap}
      className="editor-view checker"
      style={{ cursor: cursorStyle, height: p.height }}
      onPointerDown={(e) => {
        const l = local(e)
        ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
        if (p.tool === 'pan' || space.current || e.button === 1) {
          drag.current = { kind: 'pan', sx: l.x, sy: l.y, ox: vt.x, oy: vt.y }
        } else if (p.tool === 'crop') {
          const im = toImage(l.x, l.y)
          drag.current = { kind: 'crop', sx: im.x, sy: im.y, ox: 0, oy: 0 }
          p.onCropRect({ x: im.x, y: im.y, w: 0, h: 0 })
        } else if (p.tool === 'wand') {
          p.onWand?.(toImage(l.x, l.y))
        } else if (p.tool === 'anchor') {
          const im = toImage(l.x, l.y)
          p.onAnchor?.({ x: Math.min(1, Math.max(0, im.x / p.frame.work.width)), y: Math.min(1, Math.max(0, im.y / p.frame.work.height)) })
        } else {
          p.onStrokeStart()
          const im = toImage(l.x, l.y)
          paint(im, im)
          drag.current = { kind: 'paint', sx: 0, sy: 0, ox: 0, oy: 0, last: im }
          setCursor({ ...l })
        }
      }}
      onPointerMove={(e) => {
        const l = local(e)
        setCursor(l)
        const d = drag.current
        if (!d) return
        if (d.kind === 'pan') setVt((v) => ({ ...v, x: d.ox + l.x - d.sx, y: d.oy + l.y - d.sy }))
        else if (d.kind === 'crop') {
          const im = toImage(l.x, l.y)
          const W = p.frame.work.width
          const H = p.frame.work.height
          const x0 = Math.max(0, Math.min(d.sx, im.x))
          const y0 = Math.max(0, Math.min(d.sy, im.y))
          const x1 = Math.min(W, Math.max(d.sx, im.x))
          const y1 = Math.min(H, Math.max(d.sy, im.y))
          p.onCropRect({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 })
        } else if (d.kind === 'paint' && d.last) {
          const im = toImage(l.x, l.y)
          paint(d.last, im)
          d.last = im
        }
      }}
      onPointerUp={() => {
        if (drag.current?.kind === 'paint') p.onStrokeEnd()
        drag.current = null
      }}
      onPointerLeave={() => setCursor(null)}
      onWheel={(e) => {
        const l = local(e)
        if (e.ctrlKey || e.metaKey) {
          const k = Math.exp(-e.deltaY * 0.01)
          setVt((v) => {
            const z = Math.min(16, Math.max(0.05, v.zoom * k))
            return { zoom: z, x: l.x - ((l.x - v.x) * z) / v.zoom, y: l.y - ((l.y - v.y) * z) / v.zoom }
          })
        } else {
          setVt((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }))
        }
      }}
    >
      <canvas ref={view} />
      <div className="zoom-controls">
        <button className="tool" onClick={() => setVt((v) => zoomAt(v, wrap.current!, 1.25))}>+</button>
        <span className="small">{Math.round(vt.zoom * 100)}%</span>
        <button className="tool" onClick={() => setVt((v) => zoomAt(v, wrap.current!, 0.8))}>−</button>
        <button className="tool" onClick={fit}>Fit</button>
      </div>
    </div>
  )
}

function zoomAt(v: { zoom: number; x: number; y: number }, el: HTMLElement, k: number): { zoom: number; x: number; y: number } {
  const cx = el.clientWidth / 2
  const cy = el.clientHeight / 2
  const z = Math.min(16, Math.max(0.05, v.zoom * k))
  return { zoom: z, x: cx - ((cx - v.x) * z) / v.zoom, y: cy - ((cy - v.y) * z) / v.zoom }
}
