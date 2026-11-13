import { ColorMatrixFilter, Container, Graphics, Sprite, type Texture } from 'pixi.js'
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
    this.root.addChild(this.shadow, this.body, this.fx)
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
        console.warn(`[ScreenPals] could not load "${name}" frames for ${def.name}`, err)
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
        this.y = this.groundY(w)
        this.setState('idle', 0.8)
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
      if (!this.dragging) {
        switch (i.behaviour) {
          case 'walk': this.updateWalk(dt, w); break
          case 'hang': this.updateHang(dt, w); break
          case 'fly': this.updateFly(dt, w); break
          case 'climb': this.updateClimb(dt, w); break
          case 'stationary': this.updateStationary(w); break
        }
      } else if (i.behaviour === 'hang') {
        this.updatePendulum(dt, w, 0)
      }
      this.advanceGait(dt)
      this.maybeIdleSound(dt, w)
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

  // ---------- walking ----------

  private updateWalk(dt: number, w: World): void {
    const mv = this.inst.movement
    const half = this.size.w / 2
    const minX = w.w * mv.areaMin + half
    const maxX = w.w * mv.areaMax - half
    const ground = this.groundY(w)

    if (this.state === 'landing') {
      this.vy += GRAVITY * dt
      this.y += this.vy * dt
      if (this.y >= ground) {
        this.y = ground
        this.vy = 0
        this.setState('idle', 0.7)
      }
      return
    }
    this.y = ground

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

  private updateStationary(w: World): void {
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
    switch (this.inst.behaviour) {
      case 'walk':
        this.vy = 0
        this.setState('landing', 99)
        break
      case 'hang':
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
        this.setState('idle', this.idleDur(w))
        break
    }
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
    const sx = (ap.flipX ? -1 : 1) * flip
    const sy = ap.flipY ? -1 : 1
    this.body.rotation = rot + ap.rotation * DEG
    this.body.position.set(0, jump)

    if (rig && this.gfx) {
      this.body.scale.set(sx * this.unit, sy * this.unit)
      let state = this.state
      if (behaviour === 'fly' && !this.perched && state !== 'dragging') state = this.state === 'landing' ? 'landing' : 'flying'
      if (behaviour === 'hang' && (state === 'idle' || state === 'dragging')) state = 'hanging'
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

    // Hearts
    this.fx.clear()
    this.hearts = this.hearts.filter((h) => (h.t += dt) < 1.3)
    for (const h of this.hearts) {
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
      case 'sleeping':
        breathe = 1 + Math.sin(this.animT * 1.4) * 0.02
        break
      default:
        breathe = 1 + Math.sin(this.animT * 2.2) * 0.012
    }
    sprite.position.set(0, bob)
    sprite.rotation = tilt
    sprite.scale.set(scale, scale * breathe)
    this.body.scale.set(sx, sy)
  }

  isDragging(): boolean {
    return this.dragging
  }

  destroy(): void {
    this.loadToken++
    this.root.destroy({ children: true })
    this.thread.destroy()
  }
}
