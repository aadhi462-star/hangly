import 'pixi.js/unsafe-eval'
import { BUILT_IN_CHARACTERS } from '../../shared/defaults'
import { FOODS } from '../../shared/food'
import { characterAssetUrl } from '../../shared/ipc'
import type { AppState, CharacterDefinition, OverlayInit } from '../../shared/types'
import { Stage } from '../engine/Stage'

// The transparent desktop overlay for one display. It only renders and reports
// status; every change to characters goes through the main process.

const api = window.screenly
const displayId = Number(new URLSearchParams(location.search).get('display'))
let init: OverlayInit | null = null
let state: AppState | null = null
let windowRects: { id: number; x: number; y: number; w: number; h: number }[] = []

const stage = new Stage({
  resolve: (def, path) => characterAssetUrl(def, path),
  onStatus: (s) => api.overlay.reportStatus(s),
  onDragEnd: (s) => api.overlay.reportStatus([s]),
  onHoverChange: (h) => {
    api.overlay.setInteractive(h)
    if (!stage.isPressing()) stage.app.canvas.style.cursor = h ? 'grab' : ''
  },
  onAdapt: (id, behaviour, x, y) => api.overlay.adapt(id, behaviour, x, y),
  onFed: (id) => api.overlay.fed(id),
  onAffection: (id, delta) => api.overlay.affection(id, delta)
})

/** App windows in this overlay's canvas coordinates (global → window-local). */
function applySurfaces(): void {
  if (!init) return
  const b = init.windowBounds
  stage.setSurfaces(windowRects.map((r) => ({ ...r, x: r.x - b.x, y: r.y - b.y })))
}

function layout(): void {
  if (!init) return
  const wb = init.windowBounds
  const wa = init.display.workArea
  // Characters live in the work area (below the menu bar, above the Dock).
  stage.setArea(wa.x - wb.x, wa.y - wb.y, wa.width, wa.height)
  applySurfaces()
  apply()
}

function apply(): void {
  if (!state || !init) return
  const defs = new Map<string, CharacterDefinition>()
  for (const d of BUILT_IN_CHARACTERS) defs.set(d.id, d)
  for (const d of state.customCharacters) defs.set(d.id, d)
  const mine = state.instances.filter((i) => i.displayId === init!.display.id)
  stage.sync(mine, defs, state.settings)
}

async function start(): Promise<void> {
  await stage.init(document.body, window)
  api.overlay.onInit((i) => {
    if (i.display.id !== displayId && !Number.isNaN(displayId)) return
    init = i
    layout()
  })
  api.overlay.onSurfaces((rects) => {
    windowRects = rects
    applySurfaces()
  })
  api.onState((s) => {
    state = s
    apply()
  })
  api.overlay.onCursor((p) => {
    if (!init) return
    const b = init.windowBounds
    const x = p.x - b.x
    const y = p.y - b.y
    const inside = x >= 0 && y >= 0 && x < b.width && y < b.height
    if (stage.isPressing()) stage.pointerMove(x, y)
    else stage.setCursor(inside ? { x, y } : null)
  })

  // Real pointer events only arrive while main has made this window interactive.
  const canvas = stage.app.canvas
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    if (stage.pointerDown(e.clientX, e.clientY)) {
      canvas.setPointerCapture(e.pointerId)
      canvas.style.cursor = 'grabbing'
    }
  })
  canvas.addEventListener('pointermove', (e) => stage.pointerMove(e.clientX, e.clientY))
  canvas.addEventListener('pointerup', (e) => {
    stage.pointerUp(e.clientX, e.clientY)
    canvas.style.cursor = stage.hitAt(e.clientX, e.clientY) ? 'grab' : ''
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId)
  })
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    const id = stage.hitAt(e.clientX, e.clientY)
    if (id) api.overlay.menu(id)
  })
  api.overlay.onFeed(({ instanceId, foodId }) => {
    const food = FOODS[foodId]
    if (food) stage.feed(instanceId, food)
  })

  state = await api.getState()
  apply()
  api.overlay.ready()
}

void start()
