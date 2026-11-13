import { ColorMatrixFilter, Container, Graphics, Sprite, Text, type Texture } from 'pixi.js'
import { foodsFor, isHungry, type Food } from '../../shared/food'
import type {
  Behaviour,
  CharState,
  CharacterDefinition,
  CharacterInstance,
  InstanceStatus,
  SequenceName,
  Settings
} from '../../shared/types'
import { RIGS, type Rig } from './rigs'
import { RIG_SOUNDS, play, type SoundKind } from './sound'
import { loadTexture } from './textures'

export type AssetResolver = (def: CharacterDefinition, path: string) => string

/** Everything an entity needs to know about the world for one tick. Coordinates are work-area local. */
export interface World {
  w: number
  h: number
  /** Where the physical top of the screen is, relative to the area (≤ 0, e.g. -30 above the menu bar). */
  top: number
  cursor: { x: number; y: number } | null
  paused: boolean
  profile: Settings['profile']
  volume: number
  idleSounds: boolean
  avoidOverlap: boolean
  entities: Entity[]
  /** Top edges characters can stand on: app windows, front to back, in work-area px. */
  surfaces: Surface[]
  /** Called after a character finishes eating (to remember when it was fed). */
  onFed: ((e: Entity) => void) | null
  /** Switch behaviour to suit the spot a character was dropped on. */
  adapt: ((e: Entity, behaviour: Behaviour, x: number, y: number) => void) | null
}

export interface Surface {
  id: number
  x: number
  y: number
  w: number
  h: number
}

interface LoadedSeq {
  textures: Texture[]
  durations: number[]
  total: number
  loop: boolean
}

const rand = (a: number, b: number): number => a + Math.random() * (b - a)
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))
const TAU = Math.PI * 2
const DEG = Math.PI / 180
const GRAVITY = 2200

const SEQ_FOR: Partial<Record<CharState, SequenceName[]>> = {
  walking: ['walk', 'idle'],
  running: ['run', 'walk', 'idle'],
  hanging: ['hang', 'idle'],
  swinging: ['hang', 'idle'],
  descending: ['hang', 'idle'],
  ascending: ['hang', 'idle'],
  flying: ['fly', 'idle'],
  landing: ['fly', 'idle'],
  climbing: ['climb', 'walk', 'idle'],
  sleeping: ['sleep', 'idle'],
  interacting: ['interact', 'idle'],
  eating: ['interact', 'idle'],
  dragging: ['hang', 'idle']
}

/**
 * One character on screen: a behaviour state machine, simple physics, and a
 * renderer (procedural rig or image frames). Used by both the desktop overlay
 * and the Studio preview, so the preview is the real engine.
 */
export class Entity {
  readonly root = new Container()
  private readonly body = new Container()
  private readonly shadow = new Graphics()
  private readonly fx = new Graphics()
  readonly thread = new Graphics()
  /** The food being offered, drawn in work-area space (added to the stage by Stage). */
  readonly foodView = new Container()
  private readonly foodEmoji = new Text({ text: '', style: { fontSize: 32 } })
  /** Bite marks: an inverse mask that removes bitten-off parts of the food. */
  private readonly biteMask = new Graphics()
  private readonly crumbsGfx = new Graphics()
  /** "I'm hungry" thought bubble with the favourite food. */
  private readonly bubble = new Container()
  private bubbleT = -1
  // Feel: hover and lift easing, drag swing, landing squash and dust.
  private hovered = false
  private hoverK = 0
  private liftK = 0
  private dragVx = 0
  private squashT = -1
  private squashAmt = 0
  private dust: { x: number; vx: number; t: number }[] = []
  private bubbleIn = rand(20, 60)
  private gfx: Graphics | null = null
  private sprite: Sprite | null = null
  private rig: Rig | null = null
  private brightness: ColorMatrixFilter | null = null

  inst: CharacterInstance
  def: CharacterDefinition
  state: CharState = 'idle'
  private stateTime = 0
  private stateDur = 1

  // kinematics (work-area px)
  x = 0
  y = 0
  private vx = 0
  private vy = 0
  private dir: 1 | -1 = 1
  // hanging
  private anchorX = 0
  private len = 0
  private targetLen = 0
  private theta = 0
  private omega = 0
  // flying
  private tx = 0
  private ty = 0
  private perched = false
  // climbing
  private edge: 'left' | 'right' = 'left'
  private vdir: 1 | -1 = -1

  private animT = 0
  private phase = 0
  private blinkIn = 3
  private blinkT = 0
  private jumpT = -1
  private hearts: { x: number; y: number; t: number }[] = []
  private dragging = false
  private food: {
    item: Food
    x: number
    y: number
    vy: number
    landed: boolean
    age: number
    /** For prey: where it started, to wander around; and its own velocity. */
    homeX: number
    homeY: number
    vx: number
    bites: number
    size: number
  } | null = null
  private crumbs: { x: number; y: number; vx: number; vy: number; t: number; c: number }[] = []
  private lastPointer = { x: 0, y: 0 }
  /** Window the character is standing on, and that window's x last frame (to ride along). */
  private standingOn: number | null = null
  private standX = 0
  /** Decided per walk: whether to step off a window's edge instead of turning back. */
  private willStepOff = false
  private dragOff = { x: 0, y: 0 }
  private placedVersion = -1
  private placedBehaviour: Behaviour | null = null
  private idleSoundIn = rand(40, 120)
  private unit = 1
  private size = { w: 40, h: 40 }

  private seqs = new Map<SequenceName, LoadedSeq>()
  private seqName: SequenceName | null = null
  private seqClock = 0
  private loadToken = 0

  constructor(inst: CharacterInstance, def: CharacterDefinition, private resolve: AssetResolver) {
    this.inst = inst
    this.def = def
    this.root.addChild(this.shadow, this.body, this.fx, this.bubble)
    this.bubble.visible = false
    this.setDefinition(def)
  }

  get id(): string {
    return this.inst.instanceId
  }

  setDefinition(def: CharacterDefinition): void {
    this.def = def
    this.body.removeChildren()
    this.gfx?.destroy()
    this.sprite?.destroy()
    this.gfx = null
    this.sprite = null
    this.rig = def.kind === 'procedural' && def.rig ? RIGS[def.rig] : null
    if (this.rig) {
      this.gfx = new Graphics()
      this.body.addChild(this.gfx)
    } else {
      this.sprite = new Sprite()
      this.body.addChild(this.sprite)
      void this.loadSequences()
    }
  }

  private async loadSequences(): Promise<void> {
    const token = ++this.loadToken
    const def = this.def
    const next = new Map<SequenceName, LoadedSeq>()
    for (const [name, seq] of Object.entries(def.animations ?? {}) as [SequenceName, NonNullable<CharacterDefinition['animations']>[SequenceName]][]) {
      if (!seq || seq.frames.length === 0) continue
      try {
        const textures = await Promise.all(seq.frames.map((f) => loadTexture(this.resolve(def, f.file))))
        const durations = seq.frames.map((f) => f.duration)
        next.set(name, { textures, durations, total: durations.reduce((a, b) => a + b, 0), loop: seq.loop })
      } catch (err) {
        console.warn(`[Screenly] could not load "${name}" frames for ${def.name}`, err)
      }
    }
    if (token !== this.loadToken) return
    this.seqs = next
    this.seqName = null
  }

  setInstance(inst: CharacterInstance): void {
    this.inst = inst
  }

  // ---------- state machine ----------

  private setState(s: CharState, dur: number): void {
    this.state = s
    this.stateTime = 0
    this.stateDur = dur
  }

  private idleDur(w: World, lo = 0.5, hi = 1.5): number {
    return this.inst.movement.idleSeconds * w.profile.idle * rand(lo, hi)
  }

  private place(w: World): void {
    const i = this.inst
    this.placedVersion = i.positionVersion
    this.placedBehaviour = i.behaviour
    this.theta = 0
    this.omega = 0
    this.vx = this.vy = 0
    this.perched = false
    switch (i.behaviour) {
      case 'walk':
        this.x = clamp(i.x, 0, w.w)
        this.standingOn = null
        // Placed above the ground (dropped, or saved standing on a window): fall onto whatever is below.
        if (i.y > 0 && i.y < this.groundY(w) - 4) {
          this.y = i.y
          this.setState('landing', 99)
        } else {
          this.y = this.groundY(w)
          this.setState('idle', 0.8)
        }
        break
      case 'hang':
        this.anchorX = clamp(i.x, 10, w.w - 10)
        this.len = this.targetLen = this.maxLen(w, i.hanging.length)
        this.x = this.anchorX
        this.setState('hanging', this.idleDur(w))
        break
      case 'fly':
        this.x = clamp(i.x, 20, w.w - 20)
        this.y = i.y > 0 && i.y < w.h - 20 ? i.y : w.h * 0.4
        this.pickFlightTarget(w)
        this.setState('flying', rand(4, 9))
        break
      case 'climb':
        this.edge = i.x < w.w / 2 ? 'left' : 'right'
        this.y = i.y > 0 && i.y < w.h ? i.y : w.h * 0.6
        this.setState('climbing', rand(2, 5))
        break
      case 'stationary':
        this.x = clamp(i.x, 0, w.w)
        this.y = i.y > 0 ? clamp(i.y, 0, w.h) : w.h
        this.standingOn = null
        this.setState('idle', this.idleDur(w))
        break
    }
  }

  private groundY(w: World): number {
    return w.h - (this.rig?.origin === 'center' ? this.rig.groundOffset * this.unit : 0)
  }

  /** Y of the thread's tie point: the screen's top edge, or the top of the work area (below the menu bar). */
  private anchorY(w: World): number {
    return this.inst.hanging.anchorFrom === 'menubar' ? 0 : w.top
  }

  private maxLen(w: World, l: number): number {
    return clamp(l, 0, Math.max(0, w.h - this.anchorY(w) - this.size.h - 10))
  }

  update(dt: number, w: World): void {
    const i = this.inst
    this.root.visible = !i.hidden
    this.measure(w)
    if (this.placedVersion !== i.positionVersion || this.placedBehaviour !== i.behaviour) this.place(w)
    if (i.hidden) return

    const frozen = w.paused || i.paused
    if (!frozen) {
      this.animT += dt * i.movement.animSpeed
      this.stateTime += dt
      this.tickBlink(dt)
      if (this.jumpT >= 0) {
        this.jumpT += dt
        if (this.jumpT > 0.55) this.jumpT = -1
      }
      const busyEating = !this.dragging && this.updateFood(dt, w)
      if (busyEating) {
        if (i.behaviour === 'hang') this.updatePendulum(dt, w, 0)
        else if (i.behaviour === 'walk' || i.behaviour === 'stationary') this.gravity(dt, w)
      } else if (!this.dragging) {
        switch (i.behaviour) {
          case 'walk': this.updateWalk(dt, w); break
          case 'hang': this.updateHang(dt, w); break
          case 'fly': this.updateFly(dt, w); break
          case 'climb': this.updateClimb(dt, w); break
          case 'stationary': this.updateStationary(dt, w); break
        }
      } else if (i.behaviour === 'hang') {
        this.updatePendulum(dt, w, 0)
      }
      this.advanceGait(dt)
      this.maybeIdleSound(dt, w)
      this.tickHungerBubble(dt)
    } else if (!this.dragging) {
      // Paused characters don't act on their own, but still obey physics after
      // you move them: dropped ones fall and land, hanging ones swing to rest.
      this.settle(dt, w)
    }
    this.render(w, frozen ? 0 : dt)
  }

  private measure(w: World): void {
    const h = this.def.baseSize * this.inst.appearance.scale * w.profile.scale
    if (this.rig) {
      this.unit = h / this.rig.height
      this.size = { w: this.rig.width * this.unit, h }
    } else {
      const tex = this.sprite?.texture
      const ratio = tex && tex.height > 1 ? tex.width / tex.height : 1
      this.unit = 1
      this.size = { w: h * ratio, h }
    }
  }

  private moving(): boolean {
    return this.state === 'walking' || this.state === 'running' || this.state === 'climbing' || this.state === 'flying'
  }

  private advanceGait(dt: number): void {
    const hz = this.rig?.gaitHz ?? 2
    const mult = this.state === 'running' ? 1.7 : this.state === 'flying' || this.state === 'landing' ? 1.2 : 1
    if (this.moving() || this.state === 'landing') this.phase = (this.phase + dt * TAU * hz * mult * this.inst.movement.animSpeed) % (TAU * 100)
  }

  private tickBlink(dt: number): void {
    this.blinkIn -= dt
    if (this.blinkIn <= 0) {
      this.blinkT = 0.13
      this.blinkIn = rand(2.5, 6)
    }
    this.blinkT = Math.max(0, this.blinkT - dt)
  }

  private impact(strength: number): void {
    this.squashT = 0
    this.squashAmt = 0.1 + strength * 0.16
    for (let k = 0; k < 8; k++) this.dust.push({ x: rand(-0.3, 0.3) * this.size.w, vx: (k % 2 ? 1 : -1) * rand(30, 90) * (0.6 + strength), t: 0 })
  }

  setHover(on: boolean): void {
    this.hovered = on
  }

  /** Physics only (no behaviour): used while paused. */
  private settle(dt: number, w: World): void {
    const b = this.inst.behaviour
    if ((b === 'walk' || b === 'stationary') && this.state === 'landing') {
      this.gravity(dt, w)
      // Land in a still pose rather than resuming the walk animation.
      if (this.state !== 'landing') this.setState('idle', 1)
    } else if (b === 'hang' && this.isSwinging()) {
      this.updatePendulum(dt, w, 0)
    }
  }

  private isSwinging(): boolean {
    return Math.abs(this.omega) > 0.01 || Math.abs(this.theta) > 0.003
  }

  /** True while physics is still moving it (so a paused stage keeps rendering until it comes to rest). */
  isSettling(): boolean {
    const b = this.inst.behaviour
    return this.state === 'landing' && (b === 'walk' || b === 'stationary') || (b === 'hang' && this.isSwinging())
  }

  // ---------- standing on things ----------

  /** Distance from the entity's origin down to its feet. */
  private footOffset(): number {
    return this.rig?.origin === 'center' ? this.rig.groundOffset * this.unit : 0
  }

  /** A window's top edge counts only where no window in front of it covers it. */
  private topVisible(w: World, s: Surface, x: number): boolean {
    for (const f of w.surfaces) {
      if (f === s) return true
      if (x >= f.x && x <= f.x + f.w && s.y - 2 >= f.y && s.y - 2 <= f.y + f.h) return false
    }
    return true
  }

  /** The nearest thing to land on below (x, y): a window top, or the screen's ground. */
  private landingBelow(w: World, x: number, y: number): { y: number; surface: Surface | null } {
    let best: { y: number; surface: Surface | null } = { y: this.groundY(w), surface: null }
    const foot = this.footOffset()
    for (const s of w.surfaces) {
      const top = s.y - foot
      if (top < y - 2 || top >= best.y) continue
      if (x < s.x + 6 || x > s.x + s.w - 6) continue
      if (s.y < this.size.h * 0.6) continue // no headroom, e.g. a maximised window under the menu bar
      if (!this.topVisible(w, s, x)) continue
      best = { y: top, surface: s }
    }
    return best
  }

  /** Keeps a standing character on whatever is under it. Returns true while it is falling. */
  private gravity(dt: number, w: World): boolean {
    if (this.state === 'landing') {
      const target = this.landingBelow(w, this.x, this.y)
      this.vy += GRAVITY * dt
      this.y += this.vy * dt
      if (this.y >= target.y) {
        this.y = target.y
        // A hard landing squashes the body and kicks up a little dust.
        if (this.vy > 320) this.impact(Math.min(1, this.vy / 1400))
        this.vy = 0
        this.standingOn = target.surface?.id ?? null
        this.standX = target.surface?.x ?? 0
        this.setState('idle', 0.7)
      }
      return true
    }
    if (this.standingOn !== null) {
      const s = w.surfaces.find((v) => v.id === this.standingOn)
      if (!s || this.x < s.x || this.x > s.x + s.w || !this.topVisible(w, s, this.x)) {
        // The window closed, moved away or got covered: fall to the next thing below.
        this.standingOn = null
        this.vy = 0
        this.setState('landing', 99)
        return true
      }
      this.x += s.x - this.standX // ride along when the window moves
      this.standX = s.x
      this.y = s.y - this.footOffset()
      return false
    }
    const ground = this.groundY(w)
    if (this.y < ground - 2) {
      this.vy = 0
      this.setState('landing', 99)
      return true
    }
    this.y = ground
    return false
  }

  // ---------- walking ----------

  private updateWalk(dt: number, w: World): void {
    const mv = this.inst.movement
    const half = this.size.w / 2
    let minX = w.w * mv.areaMin + half
    let maxX = w.w * mv.areaMax - half

    if (this.gravity(dt, w)) return
    // On a window: its top edge is the walkway, unless this walk ends by stepping off.
    const ledge = this.standingOn !== null ? w.surfaces.find((v) => v.id === this.standingOn) : undefined
    if (ledge && !this.willStepOff) {
      minX = Math.max(minX, ledge.x + half * 0.5)
      maxX = Math.min(maxX, ledge.x + ledge.w - half * 0.5)
    }

    if (mv.followCursor && w.cursor && !mv.fixedPosition) {
      const dx = w.cursor.x - this.x
      if (Math.abs(dx) > half * 1.3) {
        this.dir = dx > 0 ? 1 : -1
        if (this.state !== 'walking' && this.state !== 'running') this.setState(Math.abs(dx) > 320 ? 'running' : 'walking', 999)
      } else if (this.state === 'walking' || this.state === 'running') {
        this.setState(Math.random() < 0.5 ? 'sitting' : 'looking', this.idleDur(w))
      }
    }

    if (this.state === 'walking' || this.state === 'running') {
      const speed = (this.state === 'running' ? mv.runSpeed : mv.walkSpeed) * w.profile.speed
      this.x += this.dir * speed * dt
      const forced = mv.direction !== 'auto'
      if (forced) {
        // Forced direction: walk off one side and come back in from the other.
        if (this.x > maxX + half * 2.5) this.x = minX - half * 2.5
        if (this.x < minX - half * 2.5) this.x = maxX + half * 2.5
      } else if (this.x > maxX || this.x < minX) {
        this.x = clamp(this.x, minX, maxX)
        this.dir = this.x >= maxX ? -1 : 1
        if (mv.randomMovement && Math.random() < 0.4) this.setState('looking', rand(1.2, 2.4))
      }
    }

    if (this.stateTime >= this.stateDur) this.nextGroundState(w, true)
  }

  private nextGroundState(w: World, canWalk: boolean): void {
    const mv = this.inst.movement
    const a = clamp(mv.activity * w.profile.activity, 0, 1)
    canWalk = canWalk && mv.autoMovement && !mv.fixedPosition
    if (canWalk && !mv.randomMovement) {
      this.startWalking(w, 'walking', 9999)
      return
    }
    const options: [CharState, number][] = [
      ['idle', 0.18],
      ['looking', 0.12],
      ['sitting', 0.16],
      ['stretching', 0.05],
      ['sleeping', 0.03 + 0.1 * (1 - a)]
    ]
    if (canWalk) options.push(['walking', 0.1 + 0.5 * a], ['running', 0.12 * a])
    // flyers and hangers have no sitting / stretching pose
    const r0 = this.rig
    const noSit = !r0 || r0.origin !== 'feet'
    const pool = options.filter(([s]) => !(noSit && (s === 'sitting' || s === 'stretching')))
    const total = pool.reduce((s, [, wgt]) => s + wgt, 0)
    let r = Math.random() * total
    let pick: CharState = 'idle'
    for (const [s, wgt] of pool) {
      if ((r -= wgt) <= 0) {
        pick = s
        break
      }
    }
    switch (pick) {
      case 'walking': this.startWalking(w, 'walking', rand(3, 8)); break
      case 'running': this.startWalking(w, 'running', rand(1.2, 2.6)); break
      case 'sleeping': this.setState('sleeping', this.idleDur(w, 2, 5)); break
      case 'stretching': this.setState('stretching', 1.8); break
      case 'looking': this.setState('looking', rand(1.5, 3)); break
      default: this.setState(pick, this.idleDur(w))
    }
  }

  private startWalking(w: World, s: 'walking' | 'running', dur: number): void {
    const mv = this.inst.movement
    if (mv.direction === 'left') this.dir = -1
    else if (mv.direction === 'right') this.dir = 1
    else {
      const third = w.w / 3
      this.dir = this.x < third ? 1 : this.x > third * 2 ? -1 : Math.random() < 0.5 ? 1 : -1
      if (w.avoidOverlap) {
        // Head away from a neighbour that is close by on the same ground.
        const near = w.entities.find((e) => e !== this && e.inst.behaviour === 'walk' && Math.abs(e.x - this.x) < this.size.w * 1.4)
        if (near) this.dir = near.x > this.x ? -1 : 1
      }
    }
    this.willStepOff = this.standingOn !== null && Math.random() < 0.3
    this.setState(s, dur)
  }

  // ---------- hanging ----------

  private updateHang(dt: number, w: World): void {
    const hc = this.inst.hanging
    const mv = this.inst.movement
    const a = clamp(mv.activity * w.profile.activity, 0, 1)
    const rest = this.maxLen(w, hc.length)
    const speedMul = w.profile.speed

    if (this.state === 'descending' || this.state === 'ascending') {
      const sp = (this.state === 'descending' ? hc.descentSpeed : hc.ascentSpeed) * speedMul
      const d = this.targetLen - this.len
      const step = Math.sign(d) * Math.min(Math.abs(d), sp * dt)
      this.len += step
      if (Math.abs(this.targetLen - this.len) < 0.5) {
        this.len = this.targetLen
        this.setState('hanging', this.idleDur(w))
      }
    } else if (this.stateTime >= this.stateDur && mv.autoMovement && !mv.fixedPosition) {
      const atRest = Math.abs(this.len - rest) < 2
      const r = Math.random()
      if (!atRest) {
        // Head back to the resting length after a descent or a trip to the top.
        this.targetLen = rest
        this.setState(this.len > rest ? 'ascending' : 'descending', 99)
      } else if (r < 0.15 + 0.35 * a && hc.descentDistance > 4) {
        this.targetLen = this.maxLen(w, rest + hc.descentDistance * rand(0.4, 1))
        this.setState('descending', 99)
      } else if (r < 0.3 + 0.6 * a && hc.amplitude > 0) {
        this.setState('swinging', rand(4, 9))
      } else if (hc.returnToTop && r < 0.75 && rest > 40) {
        this.targetLen = Math.max(8, this.size.h * 0.2)
        this.setState('ascending', 99)
      } else {
        this.setState('hanging', this.idleDur(w))
      }
    } else if (this.stateTime >= this.stateDur) {
      this.setState('hanging', this.idleDur(w))
    }

    // A new thread length from the panel takes effect right away, smoothly.
    if ((this.state === 'hanging' || this.state === 'swinging') && Math.abs(this.len - rest) > 0.5 && Math.abs(this.targetLen - rest) > 0.5) {
      this.len += clamp(rest - this.len, -hc.ascentSpeed * dt * 2, hc.descentSpeed * dt * 2)
      if (Math.abs(this.len - rest) <= 0.5) this.targetLen = this.len = rest
    }

    if (mv.followCursor && w.cursor) this.anchorX += clamp(w.cursor.x - this.anchorX, -1, 1) * Math.min(Math.abs(w.cursor.x - this.anchorX), 120 * dt)

    const amp = this.state === 'swinging' ? hc.amplitude : hc.idleSway ? Math.min(3, hc.amplitude) : 0
    this.updatePendulum(dt, w, amp)
  }

  /** Damped pendulum with an energy "pump" that sustains the requested amplitude. */
  private updatePendulum(dt: number, w: World, targetAmpDeg: number): void {
    const hc = this.inst.hanging
    const L = Math.max(30, this.len + this.size.h * 0.4)
    const g = 1500 * hc.frequency * hc.frequency * w.profile.speed
    const k = g / L
    const steps = Math.ceil(dt / (1 / 120))
    const h = dt / steps
    for (let s = 0; s < steps; s++) {
      let acc = -k * Math.sin(this.theta) - hc.damping * 2.2 * this.omega
      if (targetAmpDeg > 0) {
        const energy = 0.5 * this.omega * this.omega + k * (1 - Math.cos(this.theta))
        const amp = Math.acos(clamp(1 - energy / k, -1, 1))
        const target = targetAmpDeg * DEG
        if (amp < target) acc += Math.sign(this.omega || 1) * (target - amp) * k * 0.9 + hc.damping * 2.2 * this.omega
      }
      this.omega += acc * h
      this.theta = clamp(this.theta + this.omega * h, -1.4, 1.4)
    }
    this.x = this.anchorX + Math.sin(this.theta) * this.len
    this.y = this.anchorY(w) + Math.cos(this.theta) * this.len
  }

  // ---------- flying ----------

  private pickFlightTarget(w: World): void {
    const m = 40
    this.tx = rand(m, w.w - m)
    this.ty = rand(w.h * 0.08, w.h * 0.75)
  }

  private updateFly(dt: number, w: World): void {
    const mv = this.inst.movement
    const a = clamp(mv.activity * w.profile.activity, 0, 1)
    const ground = w.h - (this.rig?.groundOffset ?? 0) * this.unit - (this.rig ? 0 : this.size.h / 2)

    if (this.perched) {
      this.y = ground
      if (this.stateTime >= this.stateDur && mv.autoMovement && !mv.fixedPosition) {
        this.perched = false
        this.pickFlightTarget(w)
        this.ty = Math.min(this.ty, w.h * 0.5)
        this.setState('flying', rand(4, 9))
      } else if (this.stateTime >= this.stateDur) {
        this.setState(Math.random() < 0.5 ? 'looking' : 'idle', this.idleDur(w))
      }
      return
    }
    if (!mv.autoMovement || mv.fixedPosition) {
      this.vx *= 0.9
      this.vy *= 0.9
      this.x += this.vx * dt
      this.y += this.vy * dt
      if (this.state !== 'flying') this.setState('flying', 999)
      return
    }

    if (mv.followCursor && w.cursor) {
      this.tx = w.cursor.x - 50 * this.dir
      this.ty = w.cursor.y - 40
      if (this.state !== 'flying') this.setState('flying', 999)
    }

    const dx = this.tx - this.x
    const dy = this.ty - this.y
    const dist = Math.hypot(dx, dy)
    let speed = mv.flySpeed * w.profile.speed
    if (this.def.rig === 'dragonfly') speed *= Math.sin(this.animT * 1.7) > 0.2 ? 1.8 : 0.15
    if (this.def.rig === 'butterfly') speed *= 0.7 + Math.sin(this.animT * 0.9) * 0.3
    if (this.state === 'landing') speed *= clamp(dist / 120, 0.25, 1)
    const desiredX = dist > 1 ? (dx / dist) * speed : 0
    const desiredY = dist > 1 ? (dy / dist) * speed : 0
    const steer = Math.min(1, dt * (this.def.rig === 'dragonfly' ? 6 : 2.2))
    this.vx += (desiredX - this.vx) * steer
    this.vy += (desiredY - this.vy) * steer
    this.x += this.vx * dt
    this.y += this.vy * dt
    if (Math.abs(this.vx) > 8) this.dir = this.vx > 0 ? 1 : -1

    if (this.state === 'landing' && (dist < 4 || this.y >= ground)) {
      this.y = ground
      this.vx = this.vy = 0
      this.perched = true
      this.setState('idle', this.idleDur(w, 1, 2.5))
      return
    }
    if (dist < 18 || this.stateTime > this.stateDur) {
      if (mv.followCursor && w.cursor) return
      if (this.state === 'flying' && mv.randomMovement && Math.random() < 0.12 + 0.3 * (1 - a)) {
        this.tx = rand(40, w.w - 40)
        this.ty = ground
        this.setState('landing', 30)
      } else {
        this.pickFlightTarget(w)
        this.setState('flying', rand(4, 10))
      }
    }
    this.x = clamp(this.x, -40, w.w + 40)
    this.y = clamp(this.y, 10, ground)
  }

  // ---------- climbing ----------

  private updateClimb(dt: number, w: World): void {
    const mv = this.inst.movement
    const top = this.size.w * 0.6 + 6
    const bottom = w.h - this.size.w * 0.6
    if (mv.followCursor && w.cursor) {
      const dy = w.cursor.y - this.y
      if (Math.abs(dy) > 20) {
        this.vdir = dy > 0 ? 1 : -1
        if (this.state !== 'climbing') this.setState('climbing', 999)
      } else if (this.state === 'climbing') this.setState('looking', 2)
    }
    if (this.state === 'climbing') {
      this.y += this.vdir * mv.climbSpeed * w.profile.speed * dt
      if (this.y < top || this.y > bottom) {
        this.y = clamp(this.y, top, bottom)
        this.vdir = this.y <= top ? 1 : -1
        if (mv.randomMovement) this.setState('idle', this.idleDur(w, 0.4, 1))
      }
    }
    if (this.stateTime >= this.stateDur) {
      const a = clamp(mv.activity * w.profile.activity, 0, 1)
      if (mv.autoMovement && !mv.fixedPosition && (this.state !== 'climbing' || Math.random() < 0.3) && Math.random() < 0.3 + 0.6 * a) {
        if (mv.direction === 'auto' && Math.random() < 0.4) this.vdir = this.vdir === 1 ? -1 : 1
        this.setState('climbing', rand(1.5, 5))
      } else {
        this.setState(Math.random() < 0.4 ? 'looking' : 'idle', this.idleDur(w))
      }
    }
  }

  // ---------- stationary ----------

  private updateStationary(dt: number, w: World): void {
    // Standing figures stand on something; hanging-style art and fixed characters stay put.
    const standing = (this.rig?.origin ?? 'feet') !== 'hang' && !this.inst.movement.fixedPosition
    if (standing && this.gravity(dt, w)) return
    if (this.state === 'landing') this.setState('idle', 0.7)
    if (this.stateTime >= this.stateDur) {
      if (!this.inst.movement.autoMovement) this.setState('idle', 5)
      else this.nextGroundState(w, false)
    }
  }

  // ---------- interaction ----------

  hitTest(px: number, py: number): boolean {
    if (this.inst.hidden || !this.root.visible) return false
    const b = this.body.getBounds()
    const pad = 4
    return px >= b.minX - pad && px <= b.maxX + pad && py >= b.minY - pad && py <= b.maxY + pad
  }

  canDrag(): boolean {
    return this.inst.interaction.draggable && !this.inst.interaction.locked
  }

  /** Pointer coordinates are work-area local. */
  startDrag(px: number, py: number): void {
    this.dragging = true
    this.dragOff = { x: this.x - px, y: this.y - py }
    if (this.inst.behaviour === 'hang') this.dragOff = { x: 0, y: 0 }
    this.setState('dragging', 999)
  }

  dragTo(px: number, py: number, w: World): void {
    if (!this.dragging) return
    // Smoothed horizontal speed, used to swing the character as you carry it.
    this.dragVx = this.dragVx * 0.7 + (px - this.lastPointer.x) * 60 * 0.3
    this.lastPointer = { x: px, y: py }
    const x = px + this.dragOff.x
    const y = py + this.dragOff.y
    if (this.inst.behaviour === 'hang') {
      const dx = x - this.anchorX
      const dy = Math.max(4, y - this.anchorY(w))
      this.len = clamp(Math.hypot(dx, dy), 4, Math.max(4, w.h - this.anchorY(w) - this.size.h))
      this.theta = clamp(Math.atan2(dx, dy), -1.3, 1.3)
      this.omega = 0
      this.x = this.anchorX + Math.sin(this.theta) * this.len
      this.y = this.anchorY(w) + Math.cos(this.theta) * this.len
    } else {
      this.x = clamp(x, 0, w.w)
      this.y = clamp(y, 0, w.h)
      if (this.inst.behaviour === 'climb') this.edge = this.x < w.w / 2 ? 'left' : 'right'
    }
  }

  endDrag(w: World): void {
    if (!this.dragging) return
    this.dragging = false
    this.standingOn = null
    if (this.adaptToDrop(w)) return
    switch (this.inst.behaviour) {
      case 'walk':
        this.vy = 0
        this.setState('landing', 99)
        break
      case 'hang':
        // Re-tie the thread above where it was dropped, so it hangs right there.
        this.anchorX = clamp(this.x, 10, w.w - 10)
        this.theta = 0
        this.omega = 0
        this.targetLen = this.len
        this.setState('hanging', this.idleDur(w))
        break
      case 'fly':
        this.perched = false
        this.pickFlightTarget(w)
        this.setState('flying', rand(3, 6))
        break
      case 'climb':
        this.edge = this.x < w.w / 2 ? 'left' : 'right'
        this.setState('idle', 1)
        break
      case 'stationary':
        // Standing figures fall onto what's below (hanging-style art stays put).
        if ((this.rig?.origin ?? 'feet') !== 'hang' && !this.inst.movement.fixedPosition) {
          this.vy = 0
          this.setState('landing', 99)
        } else this.setState('idle', this.idleDur(w))
        break
    }
  }

  /**
   * Dropped near the top edge, a character that can hang starts hanging; against
   * a side edge, one that can climb starts climbing; pulled off a wall, a climber
   * walks or stands. Returns true when a switch was requested.
   */
  private adaptToDrop(w: World): boolean {
    if (!w.adapt) return false
    const can = this.def.behaviours
    const b = this.inst.behaviour
    const p = this.lastPointer
    const edge = 50
    let next: Behaviour | null = null
    if (p.y < edge && can.includes('hang') && b !== 'hang') next = 'hang'
    else if ((p.x < edge || p.x > w.w - edge) && can.includes('climb') && b !== 'climb') next = 'climb'
    else if (b === 'climb' && p.x > edge * 2.5 && p.x < w.w - edge * 2.5) next = can.includes('walk') ? 'walk' : can.includes('stationary') ? 'stationary' : null
    if (!next) return false
    w.adapt(this, next, next === 'climb' ? (p.x < w.w / 2 ? 0 : w.w) : this.x, next === 'hang' ? 0 : this.y)
    return true
  }

  // ---------- feeding ----------

  /** Offer food: it appears near the character, which goes to get it in its own way. */
  feed(item: Food, w: World): void {
    if (this.inst.hidden || this.dragging) return
    const side = Math.random() < 0.5 ? -1 : 1
    const b = this.inst.behaviour
    let x = this.x
    let y = this.y
    let landed = true
    if (b === 'walk') {
      x = clamp(this.x + side * rand(170, 300), 40, w.w - 40)
      y = -40
      landed = false
    } else if (b === 'stationary') {
      x = clamp(this.x + this.dir * (this.size.w * 0.5 + 20), 20, w.w - 20)
      y = Math.max(-40, this.y - 300)
      landed = false
    } else if (b === 'fly') {
      // Ground prey (a mouse) runs along the bottom; anything else appears mid-air.
      x = rand(80, w.w - 80)
      y = item.prey === 'scurry' || item.prey === 'hop' || item.prey === 'wriggle' ? this.groundY(w) : rand(w.h * 0.25, w.h * 0.7)
    } else if (b === 'climb') {
      x = this.edge === 'left' ? this.size.h * 0.9 : w.w - this.size.h * 0.9
      y = clamp(this.y + side * rand(120, 220), 40, w.h - 40)
    } else if (b === 'hang') {
      x = this.x + side * (this.size.w * 0.9 + 24)
      y = this.y + this.size.h * 0.5
    }
    const size = clamp(this.size.h * 0.36, 28, 60)
    this.foodEmoji.text = item.emoji
    this.foodEmoji.style.fontSize = size
    this.foodEmoji.anchor.set(0.5, 1)
    if (!this.foodView.children.length) {
      this.foodView.addChild(this.foodEmoji, this.biteMask, this.crumbsGfx)
      this.foodEmoji.setMask({ mask: this.biteMask, inverse: true })
    }
    this.biteMask.clear()
    // An inverse mask needs some shape to start from; this one is outside the food.
    this.biteMask.rect(-9999, -9999, 1, 1).fill(0xffffff)
    this.crumbs = []
    this.foodView.visible = true
    this.foodView.alpha = 1
    this.food = { item, x, y, vy: 0, landed, age: 0, homeX: x, homeY: y, vx: 0, bites: 0, size }
    if (this.state === 'sleeping' || this.state === 'eating') this.setState('idle', 0.2)
  }

  /** Live prey moves on its own until it is caught. */
  private movePrey(dt: number, w: World): void {
    const f = this.food!
    if (!f.item.prey || !f.landed || this.state === 'eating') return
    const t = f.age
    switch (f.item.prey) {
      case 'buzz': {
        // Erratic hovering loops around where it appeared.
        f.x = f.homeX + Math.sin(t * 2.3) * 70 + Math.sin(t * 7.1) * 14
        f.y = f.homeY + Math.cos(t * 1.7) * 40 + Math.sin(t * 9.3) * 8
        break
      }
      case 'scurry': {
        // Runs away from the hunter, turning back at the screen edges.
        const away = f.x >= this.x ? 1 : -1
        if (!f.vx || Math.abs(f.x - this.x) < 260) f.vx = away * 150
        f.x += f.vx * dt
        if (f.x < 30 || f.x > w.w - 30) {
          f.vx = -f.vx
          f.x = clamp(f.x, 30, w.w - 30)
        }
        break
      }
      case 'hop': {
        const phase = t % 1.4
        if (phase < 0.35) {
          f.x += (f.x >= this.x ? 1 : -1) * 160 * dt
          f.y = f.homeY - Math.sin((phase / 0.35) * Math.PI) * 36
        } else f.y = f.homeY
        f.x = clamp(f.x, 30, w.w - 30)
        break
      }
      case 'wriggle':
        f.x += Math.sin(t * 3) * 12 * dt
        break
    }
  }

  /** Runs the food routine. Returns true while the character is busy eating (no other movement). */
  private updateFood(dt: number, w: World): boolean {
    const f = this.food
    this.updateCrumbs(dt)
    if (!f) return false
    f.age += dt
    if (!f.landed) {
      // Dropped food falls onto whatever is below: a window top or the ground.
      const below = this.landingBelow(w, f.x, f.y)
      f.vy += GRAVITY * 0.6 * dt
      f.y += f.vy * dt
      if (f.y >= below.y + this.footOffset()) {
        f.y = below.y + this.footOffset()
        f.landed = true
        f.homeX = f.x
        f.homeY = f.y
        this.dropCrumbs(2)
      }
    }
    this.movePrey(dt, w)
    if (this.state === 'eating') {
      // A caught meal goes with the hunter: held at the mouth while hanging, flying or climbing.
      const b0 = this.inst.behaviour
      if (b0 === 'hang') {
        f.x = this.x + Math.sin(this.theta) * this.size.h * 0.6
        f.y = this.y + Math.cos(this.theta) * this.size.h * 0.6 + f.size * 0.3
      } else if (b0 === 'fly' || b0 === 'climb') {
        f.x = this.x + this.dir * this.size.w * 0.3
        f.y = this.y + this.size.h * 0.25
      }
      // Four bites; each takes a chunk out of the food and drops crumbs.
      const bite = Math.min(4, Math.floor((this.stateTime / this.stateDur) * 4.4))
      while (f.bites < bite) this.takeBite(w)
      if (this.stateTime >= this.stateDur) this.finishEating(w)
      return true
    }
    if (f.age > (f.item.prey ? 24 : 16)) {
      // Not reached in time: prey escapes, food fades away.
      this.food = null
      this.foodView.visible = false
      return false
    }
    if (!f.landed) return false
    const reach = this.size.w * 0.5 + 16
    const b = this.inst.behaviour
    if (b === 'walk') {
      const dx = f.x - this.x
      if (Math.abs(dx) <= reach && this.state !== 'landing') return this.startEating(w)
      this.dir = dx > 0 ? 1 : -1
      // Runs when far, slows to a careful walk for the last stretch.
      const want: CharState = Math.abs(dx) > 260 || f.item.prey ? 'running' : 'walking'
      if (this.state !== want && this.state !== 'landing') this.setState(want, 999)
      this.willStepOff = true // follow the food off a window ledge if needed
    } else if (b === 'stationary') {
      if (f.age > 0.6) return this.startEating(w)
    } else if (b === 'hang') {
      // Swing towards it and grab it when close enough.
      const dx = f.x - this.x
      this.omega += Math.sign(dx) * 2.2 * dt
      if (Math.hypot(dx, f.y - this.y - this.size.h * 0.4) <= reach + 10 || (!f.item.prey && f.age > 1.4)) return this.startEating(w)
    } else if (b === 'fly') {
      this.perched = false
      this.tx = f.x
      this.ty = f.y - (f.item.prey === 'scurry' ? this.size.h * 0.3 : 0)
      if (this.state !== 'flying') this.setState('flying', 999)
      if (Math.hypot(f.x - this.x, f.y - this.y) <= reach + 8) return this.startEating(w)
    } else if (b === 'climb') {
      const dy = f.y - this.y
      if (Math.abs(dy) <= reach) return this.startEating(w)
      this.vdir = dy > 0 ? 1 : -1
      if (this.state !== 'climbing') this.setState('climbing', 999)
    }
    return false
  }

  private startEating(w: World): boolean {
    if (this.food) this.dir = this.food.x >= this.x ? 1 : -1
    this.vx = this.vy = 0
    this.setState('eating', 3.2)
    void w
    return true
  }

  /** One bite: a scalloped chunk disappears from the side facing the eater, with crumbs and a crunch. */
  private takeBite(w: World): void {
    const f = this.food!
    f.bites++
    const s = f.size
    const side = this.x <= f.x ? -1 : 1
    // Bites eat inwards from the near side.
    const cx = side * s * (0.55 - f.bites * 0.22)
    const cy = -s * 0.5
    const r = s * 0.3
    for (const [ox, oy] of [[0, -r * 0.6], [side * r * 0.25, 0], [0, r * 0.6]]) this.biteMask.circle(cx + ox, cy + oy, r * 0.62)
    this.biteMask.fill(0xffffff)
    this.dropCrumbs(f.bites >= 4 ? 8 : 5)
    if (!this.inst.muted && w.volume > 0) play('crunch', w.volume * 0.8)
  }

  private dropCrumbs(n: number): void {
    const f = this.food
    if (!f) return
    for (let k = 0; k < n; k++) {
      this.crumbs.push({ x: rand(-f.size * 0.3, f.size * 0.3), y: -f.size * rand(0.3, 0.7), vx: rand(-60, 60), vy: rand(-120, -20), t: 0, c: f.item.crumbs })
    }
  }

  private updateCrumbs(dt: number): void {
    if (!this.crumbs.length) return
    for (const c of this.crumbs) {
      c.t += dt
      c.vy += 900 * dt
      c.x += c.vx * dt
      c.y = Math.min(0, c.y + c.vy * dt)
      if (c.y === 0) c.vx *= 0.8
    }
    this.crumbs = this.crumbs.filter((c) => c.t < 1.6)
  }

  private finishEating(w: World): void {
    this.food = null
    for (let k = 0; k < 3; k++) this.hearts.push({ x: rand(-14, 14), y: -this.size.h * (0.8 + k * 0.12), t: -k * 0.25 })
    // Keep showing the last crumbs settling; hide the (now eaten) food itself.
    this.foodEmoji.visible = false
    setTimeout(() => {
      if (!this.food) this.foodView.visible = false
      this.foodEmoji.visible = true
    }, 1600)
    w.onFed?.(this)
    const s = this.def.rig ? RIG_SOUNDS[this.def.rig] : undefined
    if (s?.idle) this.sound(s.idle, w)
    const canSit = this.rig?.origin === 'feet' && (this.inst.behaviour === 'walk' || this.inst.behaviour === 'stationary')
    this.setState(canSit ? 'sitting' : 'idle', this.idleDur(w, 2, 3.5))
  }

  isEating(): boolean {
    return !!this.food
  }

  /** A hungry character now and then thinks about its favourite food. */
  private tickHungerBubble(dt: number): void {
    if (this.bubbleT >= 0) {
      this.bubbleT += dt
      if (this.bubbleT > 4 || this.food) {
        this.bubbleT = -1
        this.bubble.visible = false
      }
      return
    }
    this.bubbleIn -= dt
    if (this.bubbleIn > 0) return
    this.bubbleIn = rand(90, 200)
    if (!isHungry(this.inst) || this.food || this.dragging) return
    const fav = foodsFor(this.def)[0]
    if (!fav) return
    this.bubble.removeChildren().forEach((c) => c.destroy())
    const g = new Graphics()
    g.roundRect(-24, -24, 48, 40, 18).fill({ color: 0xffffff, alpha: 0.95 }).stroke({ width: 1, color: 0x000000, alpha: 0.12 })
    g.circle(-14, 22, 5).fill({ color: 0xffffff, alpha: 0.95 })
    g.circle(-20, 31, 3).fill({ color: 0xffffff, alpha: 0.95 })
    const t = new Text({ text: fav.emoji, style: { fontSize: 22 } })
    t.anchor.set(0.5)
    t.position.set(0, -4)
    this.bubble.addChild(g, t)
    this.bubble.visible = true
    this.bubbleT = 0
  }

  interact(w: World, kind: 'click' | 'pet' = 'click'): void {
    if (!this.inst.interaction.clickToInteract || this.dragging) return
    this.hearts.push({ x: rand(-6, 6), y: -this.size.h * 0.9, t: 0 })
    if (this.inst.behaviour === 'hang') this.omega += (Math.random() < 0.5 ? -1 : 1) * 1.6
    else if (this.inst.behaviour === 'fly' && !this.perched) {
      const a = rand(0, TAU)
      this.vx = Math.cos(a) * this.inst.movement.flySpeed * 2
      this.vy = Math.sin(a) * this.inst.movement.flySpeed * 2
    } else if (kind === 'click') this.jumpT = 0
    if (this.inst.behaviour !== 'hang' && this.inst.behaviour !== 'fly') this.setState('interacting', 1.1)
    const s = this.def.rig ? RIG_SOUNDS[this.def.rig] : undefined
    this.sound(kind === 'pet' && s?.idle ? s.idle : (s?.interact ?? 'pop'), w)
  }

  private sound(kind: SoundKind, w: World): void {
    if (this.inst.muted || w.volume <= 0) return
    play(kind, w.volume)
  }

  private maybeIdleSound(dt: number, w: World): void {
    if (!w.idleSounds || w.volume <= 0 || this.inst.muted) return
    this.idleSoundIn -= dt
    if (this.idleSoundIn > 0) return
    this.idleSoundIn = rand(60, 180)
    const s = this.def.rig ? RIG_SOUNDS[this.def.rig] : undefined
    const kind = this.moving() ? s?.move : s?.idle
    if (kind) this.sound(kind, w)
  }

  status(): InstanceStatus {
    const b = this.inst.behaviour
    return {
      instanceId: this.inst.instanceId,
      state: this.state,
      x: b === 'hang' ? this.anchorX : this.x,
      y: b === 'walk' ? this.y : b === 'hang' ? this.len : this.y
    }
  }

  // ---------- rendering ----------

  private render(w: World, dt: number): void {
    const i = this.inst
    const ap = i.appearance
    const behaviour = i.behaviour
    const rig = this.rig
    this.root.alpha = ap.opacity

    // Root position and behaviour-driven orientation.
    let rot = 0
    let flip = this.dir
    let rootX = this.x
    let rootY = this.y
    if (behaviour === 'climb') {
      const side = rig?.view === 'top' || !rig ? 'top' : 'side'
      if (side === 'top') {
        rootX = this.edge === 'left' ? this.size.h * 0.55 : w.w - this.size.h * 0.55
        rot = this.vdir < 0 ? -Math.PI / 2 : Math.PI / 2
        flip = 1
      } else {
        rootX = this.edge === 'left' ? 0 : w.w
        rot = this.edge === 'left' ? Math.PI / 2 : -Math.PI / 2
        const up = this.vdir < 0
        flip = this.edge === 'left' ? (up ? -1 : 1) : up ? 1 : -1
      }
      if (this.dragging) {
        rootX = this.x
        rot = 0
        flip = 1
      }
    } else if (behaviour === 'hang') {
      rot = -this.theta + i.hanging.rotation * DEG
      flip = 1
    } else if (behaviour === 'stationary') {
      flip = i.movement.direction === 'left' ? -1 : 1
    }
    if (i.movement.direction !== 'auto' && behaviour !== 'climb' && behaviour !== 'hang') flip = i.movement.direction === 'left' ? -1 : 1
    if (this.def.facing === 'left') flip = -flip as 1 | -1
    this.root.position.set(rootX, rootY)

    // Jump offset applies to the body only so the shadow stays on the ground.
    const jump = this.jumpT >= 0 ? -Math.sin((this.jumpT / 0.55) * Math.PI) * this.size.h * 0.35 : 0
    // Feel: ease hover/lift in and out, decay the landing squash.
    const ease = Math.min(1, (dt || 0.016) * 12)
    this.hoverK += ((this.hovered && !this.dragging ? 1 : 0) - this.hoverK) * ease
    this.liftK += ((this.dragging ? 1 : 0) - this.liftK) * ease
    if (!this.dragging) this.dragVx *= 0.85
    let fx = 1 + this.hoverK * 0.04 + this.liftK * 0.08
    let fy = fx
    if (this.squashT >= 0) {
      this.squashT += dt || 0.016
      const k = Math.max(0, 1 - this.squashT / 0.32)
      const wobble = Math.cos(this.squashT * 28) * k
      fy *= 1 - this.squashAmt * wobble
      fx *= 1 + this.squashAmt * 0.8 * wobble
      if (k === 0) this.squashT = -1
    }
    const sx = (ap.flipX ? -1 : 1) * flip * fx
    const sy = ap.flipY ? -1 : 1
    this.body.rotation = rot + ap.rotation * DEG + this.liftK * clamp(this.dragVx * 0.0011, -0.35, 0.35)
    this.body.position.set(0, jump)

    if (rig && this.gfx) {
      this.body.scale.set(sx * this.unit, sy * fy * this.unit)
      let state = this.state
      if (behaviour === 'fly' && !this.perched && state !== 'dragging') state = this.state === 'landing' ? 'landing' : 'flying'
      if (behaviour === 'hang' && (state === 'idle' || state === 'dragging')) state = 'hanging'
      if (state === 'eating' && !rig.eats) state = 'interacting'
      this.gfx.clear()
      // Bats draw differently in flight; keep their body centred on the flight path.
      this.gfx.position.set(0, behaviour === 'fly' && rig.flyCenterY ? -rig.flyCenterY : 0)
      rig.draw(this.gfx, {
        state,
        t: this.animT,
        phase: this.phase,
        blink: this.blinkT > 0,
        look: state === 'looking' ? Math.sin(this.animT * 1.4) : 0,
        effort: 1
      })
    } else if (this.sprite) {
      this.renderSprite(sx, sy, dt)
    }

    // Shadow
    this.shadow.clear()
    const onGround = behaviour === 'walk' || (behaviour === 'stationary' && (rig?.origin ?? 'feet') === 'feet') || (behaviour === 'fly' && this.perched)
    if (this.liftK > 0.05 && ap.shadow) {
      // Lifted: a soft shadow further below, as if held above the desk.
      this.shadow.ellipse(this.liftK * 10, this.size.h * 0.12 * this.liftK, this.size.w * 0.32, Math.max(2, this.size.h * 0.04)).fill({ color: 0x000000, alpha: 0.18 * this.liftK })
    }
    if (ap.shadow && ap.shadowIntensity > 0 && !this.dragging) {
      const k = this.jumpT >= 0 ? 0.6 : 1
      if (onGround) {
        const gy = behaviour === 'fly' && rig ? rig.groundOffset * this.unit : 0
        this.shadow.ellipse(0, gy, this.size.w * 0.42 * k, Math.max(2, this.size.h * 0.05)).fill({ color: 0x000000, alpha: ap.shadowIntensity * 0.6 })
      } else if (behaviour !== 'climb') {
        const off = behaviour === 'hang' ? this.size.h * 0.55 : this.size.h * 0.6
        this.shadow.ellipse(this.size.h * 0.12, off + this.size.h * 0.3, this.size.w * 0.3, this.size.h * 0.06).fill({ color: 0x000000, alpha: ap.shadowIntensity * 0.25 })
      }
    }

    // Brightness, only when needed (filters cost a render pass).
    if (ap.brightness !== 1) {
      if (!this.brightness) {
        this.brightness = new ColorMatrixFilter()
        this.body.filters = [this.brightness]
      }
      this.brightness.brightness(ap.brightness, false)
    } else if (this.brightness) {
      this.body.filters = []
      this.brightness.destroy()
      this.brightness = null
    }

    // Thread for hanging characters, drawn in work-area space.
    this.thread.clear()
    if (behaviour === 'hang' && i.hanging.threadWidth > 0 && this.len > 0.5) {
      this.thread
        .moveTo(this.anchorX, this.anchorY(w))
        .lineTo(this.x, this.y + jump)
        .stroke({ width: i.hanging.threadWidth, color: i.hanging.threadColor, alpha: 0.85 * ap.opacity })
    }

    if (this.bubble.visible) {
      const hang = behaviour === 'hang'
      const pop = Math.min(1, this.bubbleT * 5) * Math.min(1, Math.max(0, (4 - this.bubbleT) * 3))
      this.bubble.position.set(this.size.w * (hang ? 0.7 : 0.45), hang ? this.size.h * 0.2 : -this.size.h - 26 + jump)
      this.bubble.scale.set(0.6 + pop * 0.4)
      this.bubble.alpha = pop
    }

    // Food: bite marks, crumbs and moving prey.
    if (this.food) {
      const f = this.food
      // Prey buzzing in the air sits centred; food on a surface sits on it.
      const held = this.state === 'eating' && this.inst.behaviour !== 'walk' && this.inst.behaviour !== 'stationary'
      this.foodView.position.set(f.x, f.y + (f.item.prey === 'buzz' && !held ? f.size * 0.5 : 0))
      const fade = f.item.prey ? 22 : 14
      this.foodView.alpha = f.age > fade ? Math.max(0, 1 - (f.age - fade) / 2) : 1
      // Prey faces the way it is moving; a caught one twitches.
      const flip = f.item.prey && f.vx < 0 ? -1 : 1
      this.foodEmoji.scale.set(flip, 1)
      this.foodEmoji.rotation = held ? 0 : f.item.prey === 'buzz' ? Math.sin(f.age * 30) * 0.15 : f.item.prey === 'wriggle' ? Math.sin(f.age * 6) * 0.2 : 0
    }
    if (this.foodView.visible) {
      this.crumbsGfx.clear()
      for (const c of this.crumbs) this.crumbsGfx.circle(c.x, c.y, 1.6).fill({ color: c.c, alpha: Math.max(0, 1 - c.t / 1.6) })
    }

    // Hearts
    this.fx.clear()
    this.dust = this.dust.filter((d) => (d.t += dt) < 0.6)
    for (const d of this.dust) {
      const k = d.t / 0.6
      this.fx.circle(d.x + d.vx * d.t, -2 - k * 8, 3 + k * 7).fill({ color: 0xc9c1b4, alpha: 0.35 * (1 - k) })
    }
    this.hearts = this.hearts.filter((h) => (h.t += dt) < 1.3)
    for (const h of this.hearts) {
      if (h.t < 0) continue
      const s = 5 + h.t * 3
      const x = h.x + Math.sin(h.t * 6) * 4
      const y = h.y - h.t * 40 + jump
      this.fx
        .moveTo(x, y + s * 0.9)
        .bezierCurveTo(x - s * 1.4, y - s * 0.1, x - s * 0.6, y - s * 1.2, x, y - s * 0.4)
        .bezierCurveTo(x + s * 0.6, y - s * 1.2, x + s * 1.4, y - s * 0.1, x, y + s * 0.9)
        .fill({ color: 0xff5a7a, alpha: 1 - h.t / 1.3 })
    }
  }

  private renderSprite(sx: number, sy: number, dt: number): void {
    const sprite = this.sprite!
    const want = SEQ_FOR[this.state] ?? ['idle']
    const name = want.find((n) => this.seqs.has(n)) ?? (this.seqs.has('idle') ? 'idle' : null)
    if (!name) {
      sprite.visible = false
      return
    }
    sprite.visible = true
    if (name !== this.seqName) {
      this.seqName = name
      this.seqClock = 0
    }
    const seq = this.seqs.get(name)!
    this.seqClock += dt * 1000 * this.inst.movement.animSpeed
    let t = seq.loop ? this.seqClock % Math.max(1, seq.total) : Math.min(this.seqClock, seq.total - 1)
    let idx = 0
    while (idx < seq.durations.length - 1 && t >= seq.durations[idx]) t -= seq.durations[idx++]
    const tex = seq.textures[idx]
    if (sprite.texture !== tex) sprite.texture = tex

    // Anchor the image where this behaviour holds it.
    const b = this.inst.behaviour
    const hc = this.inst.hanging
    if (b === 'hang') sprite.anchor.set(hc.attachX, hc.attachY)
    else if (b === 'fly') sprite.anchor.set(0.5, 0.5)
    else sprite.anchor.set(0.5, 1)

    const scale = this.size.h / Math.max(1, tex.height)
    // A single still image gets procedural life: bob, tilt and breathing.
    const animated = seq.textures.length > 1
    const k = animated ? 0.3 : 1
    let bob = 0
    let tilt = 0
    let breathe = 1
    switch (this.state) {
      case 'walking':
      case 'running': {
        const amp = this.state === 'running' ? 0.06 : 0.035
        bob = -Math.abs(Math.sin(this.phase)) * this.size.h * amp * k
        tilt = Math.sin(this.phase) * 0.05 * k
        break
      }
      case 'climbing':
        tilt = Math.sin(this.phase) * 0.07 * k
        break
      case 'flying':
      case 'landing':
        bob = Math.sin(this.animT * 4) * this.size.h * 0.04
        tilt = Math.sin(this.animT * 2.5) * 0.06
        break
      case 'eating':
        // Lean towards the food (the sprite pivots at the feet) and chew with small dips.
        breathe = 1 - Math.abs(Math.sin(this.animT * 9)) * 0.025
        tilt = (this.inst.behaviour === 'walk' || this.inst.behaviour === 'stationary' ? 0.14 : 0) + Math.sin(this.animT * 9) * 0.02
        break
      case 'sleeping':
        breathe = 1 + Math.sin(this.animT * 1.4) * 0.02
        break
      default:
        breathe = 1 + Math.sin(this.animT * 2.2) * 0.012
    }
    sprite.position.set(0, bob)
    sprite.rotation = tilt
    sprite.scale.set(scale, scale * breathe)
    this.body.scale.set(sx, sy * this.squashY())
  }

  /** Vertical squash factor for image characters (rigs apply it in render). */
  private squashY(): number {
    if (this.squashT < 0) return 1 + this.hoverK * 0.04 + this.liftK * 0.08
    const k = Math.max(0, 1 - this.squashT / 0.32)
    return (1 + this.hoverK * 0.04 + this.liftK * 0.08) * (1 - this.squashAmt * Math.cos(this.squashT * 28) * k)
  }

  isDragging(): boolean {
    return this.dragging
  }

  destroy(): void {
    this.foodView.destroy()
    this.loadToken++
    this.root.destroy({ children: true })
    this.thread.destroy()
  }
}
