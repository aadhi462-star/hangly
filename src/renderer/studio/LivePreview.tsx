import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { DEFAULT_SETTINGS, newInstance } from '../../shared/defaults'
import type { Behaviour, CharacterDefinition, CharacterInstance } from '../../shared/types'
import { Stage } from '../engine/Stage'
import { releaseTextures } from '../engine/textures'
import { previewDefinition, type StudioDoc } from './model'

/** The preview always behaves like daytime, so walking can be tested at any hour. */
const PREVIEW_SETTINGS = { ...DEFAULT_SETTINGS, fps: 60 as const, dayNight: false, lively: false }

export type Backdrop = 'light' | 'dark' | 'sunset' | 'meadow'

interface Props {
  doc: StudioDoc
  /** Pixel version: bump only when frame images or sequences change. */
  version: number
  behaviour: Behaviour
  scale: number
  opacity: number
  speed: number
  animSpeed: number
  backdrop: Backdrop
  /** Bump to put the character back at its starting position. */
  resetKey: number
  height?: number
}

/**
 * A simulated desktop running the real overlay engine (same Stage and Entity
 * classes), so what you see here is what you get on the desktop.
 */
export function LivePreview(p: Props): ReactNode {
  const host = useRef<HTMLDivElement>(null)
  const stage = useRef<Stage | null>(null)
  const urls = useRef(new Map<string, string>())
  const [ready, setReady] = useState(false)
  const inst = useRef<CharacterInstance | null>(null)
  const posVersion = useRef(1)

  // Frames are re-encoded only when pixels change (`version`); other fields are read live.
  const preview = useMemo(() => previewDefinition(p.doc, p.version), [p.doc, p.version])
  urls.current = preview.urls
  const liveDef = (): CharacterDefinition => ({
    ...preview.def,
    behaviours: [p.behaviour],
    defaultBehaviour: p.behaviour,
    facing: p.doc.facing,
    baseSize: p.doc.baseSize,
    hanging: p.doc.hanging,
    legLine: p.doc.legLine || undefined
  })

  useEffect(() => {
    const el = host.current!
    const s = new Stage({ resolve: (_def, path) => urls.current.get(path) ?? '' })
    stage.current = s
    let alive = true
    void s.init(el, el).then(() => {
      if (!alive) return
      s.setArea(0, 0, el.clientWidth, el.clientHeight)
      const canvas = s.app.canvas
      const pos = (e: PointerEvent): [number, number] => {
        const r = canvas.getBoundingClientRect()
        return [e.clientX - r.left, e.clientY - r.top]
      }
      canvas.addEventListener('pointerdown', (e) => {
        if (s.pointerDown(...pos(e))) canvas.setPointerCapture(e.pointerId)
      })
      canvas.addEventListener('pointermove', (e) => s.pointerMove(...pos(e)))
      canvas.addEventListener('pointerup', (e) => s.pointerUp(...pos(e)))
      canvas.addEventListener('pointerleave', () => s.setCursor(null))
      setReady(true)
    })
    const ro = new ResizeObserver(() => s.setArea(0, 0, el.clientWidth, el.clientHeight))
    ro.observe(el)
    return () => {
      alive = false
      ro.disconnect()
      s.destroy()
      stage.current = null
      releaseTextures('data:image/png')
    }
  }, [])

  // (Re)build the preview instance whenever anything the user can change changes.
  useEffect(() => {
    const s = stage.current
    const el = host.current
    if (!ready || !s || !el || !preview.def.animations?.idle) return
    const def = liveDef()
    const prev = inst.current
    const base = prev && prev.behaviour === p.behaviour ? prev : newInstance(def, 0, el.clientWidth)
    if (!prev || prev.behaviour !== p.behaviour) posVersion.current++
    const i: CharacterInstance = {
      ...base,
      instanceId: 'preview',
      behaviour: p.behaviour,
      x: p.behaviour === 'hang' || p.behaviour === 'walk' ? el.clientWidth * 0.5 : el.clientWidth * 0.45,
      y: p.behaviour === 'stationary' ? el.clientHeight - 30 : el.clientHeight * 0.45,
      positionVersion: posVersion.current,
      appearance: { ...base.appearance, scale: p.scale, opacity: p.opacity, shadow: p.behaviour !== 'hang' },
      movement: {
        ...base.movement,
        walkSpeed: p.doc.defaultSpeed * p.speed,
        runSpeed: p.doc.defaultSpeed * 2.4 * p.speed,
        climbSpeed: p.doc.defaultSpeed * 0.8 * p.speed,
        flySpeed: Math.max(60, p.doc.defaultSpeed * 2) * p.speed,
        animSpeed: p.animSpeed,
        idleSeconds: 2.5,
        activity: 0.85,
        // When you pick Walking to test it, keep walking instead of idling at random.
        randomMovement: p.behaviour !== 'walk'
      },
      hanging: { ...p.doc.hanging, length: Math.min(p.doc.hanging.length, el.clientHeight * 0.45) }
    }
    inst.current = i
    s.sync([i], new Map([[def.id, def]]), PREVIEW_SETTINGS)
  }, [ready, preview, p.behaviour, p.scale, p.opacity, p.speed, p.animSpeed, p.doc.hanging, p.doc.defaultSpeed, p.doc.facing, p.doc.baseSize, p.doc.legLine])

  useEffect(() => {
    posVersion.current++
    if (inst.current) inst.current = { ...inst.current, positionVersion: posVersion.current }
    const s = stage.current
    if (s && inst.current && preview.def.animations?.idle) {
      const def = liveDef()
      s.sync([inst.current], new Map([[def.id, def]]), PREVIEW_SETTINGS)
    }
  }, [p.resetKey])

  return (
    <div className={`preview-stage bg-${p.backdrop}`} style={{ height: p.height ?? 460 }}>
      <div className="fake-menubar" />
      <div className="fake-window" style={{ left: '8%', top: '16%', width: '42%', height: '46%' }} />
      <div className="fake-window" style={{ left: '46%', top: '30%', width: '44%', height: '48%' }} />
      <div className="fake-dock" />
      <div ref={host} style={{ position: 'absolute', inset: 0 }} />
      {!preview.def.animations?.idle && <div className="preview-empty muted">Add at least one frame to the Idle sequence to preview.</div>}
    </div>
  )
}
