import { Application, Container } from 'pixi.js'
import { foodsFor, type Food } from '../../shared/food'
import type { CharacterDefinition, CharacterInstance, InstanceStatus, Settings } from '../../shared/types'
import { Entity, type AssetResolver, type Surface, type World } from './Entity'

export interface StageOptions {
  resolve: AssetResolver
  /** Called ~1/s with live states and positions. */
  onStatus?: (s: InstanceStatus[]) => void
  /** Called when the pointer starts or stops being over an interactive character. */
  onHoverChange?: (hovering: boolean) => void
  /** Called right after a drag ends, with that character's final status. */
  onDragEnd?: (s: InstanceStatus) => void
  /** Ask the owner to switch a character's behaviour after a drop. */
  onAdapt?: (instanceId: string, behaviour: CharacterInstance['behaviour'], x: number, y: number) => void
}

/**
 * Hosts a PixiJS application and the entities living in it. The same class
 * drives the transparent desktop overlay and the Studio's live preview.
 */
export class Stage {
  readonly app = new Application()
  private readonly world = new Container()
  private readonly threads = new Container()
  private readonly layer = new Container()
  private entities = new Map<string, Entity>()
  private area = { x: 0, y: 0, w: 800, h: 600 }
  private settings: Settings | null = null
  private cursor: { x: number; y: number } | null = null
  private hovered: Entity | null = null
  private press: { e: Entity; x: number; y: number; dragging: boolean } | null = null
  private petDist = 0
  private statusClock = 0
  private lastStatus = ''
  private ready = false
  private surfaces: Surface[] = []
  private destroyed = false

  constructor(private opts: StageOptions) {}

  async init(parent: HTMLElement, resizeTo: HTMLElement | Window): Promise<void> {
    await this.app.init({
      backgroundAlpha: 0,
      resizeTo,
      antialias: true,
      autoDensity: true,
      resolution: Math.max(1, window.devicePixelRatio || 1),
      preference: 'webgl',
      powerPreference: 'low-power'
    })
    // Destroyed while initialising (e.g. React StrictMode remount): clean up and bail.
    if (this.destroyed) {
      this.app.destroy(true, { children: true })
      return
    }
    parent.appendChild(this.app.canvas)
    this.world.addChild(this.threads, this.layer)
    this.app.stage.addChild(this.world)
    this.app.ticker.add((t) => this.tick(Math.min(0.1, t.deltaMS / 1000)))
    this.ready = true
  }

  /** The rectangle (canvas px) characters live in, e.g. the display's work area. */
  setArea(x: number, y: number, w: number, h: number): void {
    this.area = { x, y, w, h }
    this.world.position.set(x, y)
    this.wake()
  }

  /** Window rectangles in canvas px (front to back); converted to area coordinates here. */
  setSurfaces(rects: Surface[]): void {
    this.surfaces = rects
      .map((r) => ({ ...r, x: r.x - this.area.x, y: r.y - this.area.y }))
      .filter((r) => r.x + r.w > 0 && r.x < this.area.w && r.y < this.area.h && r.y + r.h > 0)
    this.wake()
  }

  sync(instances: CharacterInstance[], defs: Map<string, CharacterDefinition>, settings: Settings): void {
    this.settings = settings
    this.app.ticker.maxFPS = settings.fps
    this.world.alpha = settings.globalOpacity
    const keep = new Set<string>()
    for (const inst of instances) {
      const def = defs.get(inst.characterId)
      if (!def) continue
      keep.add(inst.instanceId)
      let e = this.entities.get(inst.instanceId)
      if (!e) {
        e = new Entity(inst, def, this.opts.resolve)
        this.entities.set(inst.instanceId, e)
        this.layer.addChild(e.root)
        this.threads.addChild(e.thread)
        this.layer.addChild(e.foodView)
      } else {
        if (e.def !== def && (e.def.updatedAt !== def.updatedAt || e.def.id !== def.id)) e.setDefinition(def)
        e.def = def
        e.setInstance(inst)
      }
    }
    for (const [id, e] of this.entities) {
      if (keep.has(id)) continue
      if (this.hovered === e) this.setHovered(null)
      if (this.press?.e === e) this.press = null
      e.destroy()
      this.entities.delete(id)
    }
    this.wake()
  }

  private world_(): World {
    const s = this.settings!
    const focus = s.focus.active
    return {
      w: this.area.w,
      h: this.area.h,
      top: -this.area.y,
      cursor: this.cursor ? { x: this.cursor.x - this.area.x, y: this.cursor.y - this.area.y } : null,
      paused: s.pausedAll || focus,
      profile: s.profile,
      volume: s.sound.enabled && !focus ? s.sound.volume : 0,
      idleSounds: s.sound.idleSounds,
      avoidOverlap: s.avoidOverlap,
      entities: [...this.entities.values()],
      surfaces: s.standOnWindows ? this.surfaces : [],
      adapt: s.adaptOnDrop && this.opts.onAdapt ? (e, b, x, y) => this.opts.onAdapt!(e.id, b, x, y) : null
    }
  }

  /** Restart the ticker after it was parked because nothing was animating. */
  wake(): void {
    if (this.ready && !this.app.ticker.started) this.app.ticker.start()
  }

  private tick(dt: number): void {
    if (!this.settings) return
    const w = this.world_()
    for (const e of this.entities.values()) e.update(dt, w)

    this.statusClock += dt
    if (this.statusClock > 1) this.reportStatus()

    // Park the render loop when nothing can change on screen (all paused or hidden).
    const all = [...this.entities.values()]
    const live = (all.some((e) => !e.inst.hidden && !e.inst.paused) && !w.paused) || all.some((e) => e.isSettling())
    if (!live && !this.press) {
      // Report final positions before parking, so a character that just settled isn't left stale.
      this.reportStatus()
      this.app.ticker.stop()
    }
  }

  private reportStatus(): void {
    this.statusClock = 0
    if (!this.opts.onStatus) return
    const st = [...this.entities.values()].map((e) => e.status())
    const sig = JSON.stringify(st)
    if (sig === this.lastStatus) return
    this.lastStatus = sig
    this.opts.onStatus(st)
  }

  // ---------- pointer handling (canvas px) ----------

  private interactive(e: Entity): boolean {
    const s = this.settings
    const it = e.inst.interaction
    return !!s && s.interactionEnabled && !it.clickThrough && (it.clickToInteract || (it.draggable && !it.locked))
  }

  private setHovered(e: Entity | null): void {
    if (this.hovered === e) return
    const was = !!this.hovered
    this.hovered = e
    this.petDist = 0
    if (was !== !!e) this.opts.onHoverChange?.(!!e)
  }

  /** Update the cursor (canvas px, or null when it is off this canvas). Returns true if over a character. */
  setCursor(p: { x: number; y: number } | null): boolean {
    const prev = this.cursor
    this.cursor = p
    if (this.press) return true
    if (!p) {
      this.setHovered(null)
      return false
    }
    let hit: Entity | null = null
    const list = [...this.entities.values()]
    for (let i = list.length - 1; i >= 0; i--) {
      if (this.interactive(list[i]) && list[i].hitTest(p.x, p.y)) {
        hit = list[i]
        break
      }
    }
    this.setHovered(hit)
    // Rubbing the cursor back and forth over a character counts as petting it.
    if (hit && prev && this.settings) {
      this.petDist += Math.hypot(p.x - prev.x, p.y - prev.y)
      if (this.petDist > 450) {
        this.petDist = 0
        hit.interact(this.world_(), 'pet')
        this.wake()
      }
    }
    return !!hit
  }

  /** Offer food to one character. */
  feed(instanceId: string, food: Food): void {
    const e = this.entities.get(instanceId)
    if (!e || !this.settings) return
    e.feed(food, this.world_())
    this.wake()
  }

  /** Right-click: give the character under the pointer its favourite food. Returns true if one was fed. */
  feedAt(x: number, y: number): boolean {
    this.setCursor({ x, y })
    const e = this.hovered
    if (!e || !this.settings) return false
    const food = foodsFor(e.def)[0]
    if (food) e.feed(food, this.world_())
    this.wake()
    return true
  }

  pointerDown(x: number, y: number): boolean {
    this.setCursor({ x, y })
    if (!this.hovered) return false
    this.press = { e: this.hovered, x, y, dragging: false }
    this.wake()
    return true
  }

  pointerMove(x: number, y: number): void {
    this.cursor = { x, y }
    const p = this.press
    if (!p) {
      this.setCursor({ x, y })
      return
    }
    const lx = x - this.area.x
    const ly = y - this.area.y
    if (!p.dragging && Math.hypot(x - p.x, y - p.y) > 4 && p.e.canDrag()) {
      p.dragging = true
      p.e.startDrag(lx, ly)
    }
    if (p.dragging) p.e.dragTo(lx, ly, this.world_())
  }

  pointerUp(x: number, y: number): void {
    const p = this.press
    this.press = null
    if (!p) return
    if (p.dragging) {
      p.e.endDrag(this.world_())
      this.opts.onDragEnd?.(p.e.status())
    } else {
      p.e.interact(this.world_(), 'click')
    }
    this.wake()
    this.setCursor({ x, y })
  }

  isPressing(): boolean {
    return !!this.press
  }

  destroy(): void {
    this.destroyed = true
    for (const e of this.entities.values()) e.destroy()
    this.entities.clear()
    if (this.ready) this.app.destroy(true, { children: true })
  }
}
