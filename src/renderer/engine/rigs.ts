import type { Graphics } from 'pixi.js'
import type { CharState, RigId } from '../../shared/types'

/**
 * Procedural character rigs. Each rig redraws itself every frame from a pose,
 * using simple two-bone limbs, so animation is continuous rather than a fixed
 * set of frames. All rigs face +x. Units are arbitrary; `height` tells the
 * entity how to scale them to the requested pixel size.
 */

export interface Pose {
  state: CharState
  /** Animation clock in seconds (already multiplied by animation speed). */
  t: number
  /** Gait phase in radians. */
  phase: number
  blink: boolean
  /** -1..1, where the character is looking. */
  look: number
  /** 0..1, used by flyers for flap intensity / climbers for stride. */
  effort: number
}

export interface Rig {
  /** Height of the drawing in rig units. */
  height: number
  width: number
  /** Where (0,0) is: on the ground under the feet, at the hanging point, or at the centre. */
  origin: 'feet' | 'hang' | 'center'
  /** For centre-origin rigs: distance from origin down to the feet when perched. */
  groundOffset: number
  /** Side view (climbs with feet to the wall) or top view (seen from above). */
  view: 'side' | 'top'
  /** Gait cycles per second when walking at animation speed 1. */
  gaitHz: number
  /** For hang-origin rigs that can also fly: the body centre's y while flying. */
  flyCenterY?: number
  draw(g: Graphics, p: Pose): void
}

// ---------- drawing helpers ----------

const { sin, cos, PI, abs, max } = Math

type Stroke = { width: number; color: number; alpha?: number }

function ell(g: Graphics, cx: number, cy: number, rx: number, ry: number, rot = 0): Graphics {
  if (!rot) return g.ellipse(cx, cy, rx, ry)
  const pts: number[] = []
  const n = 28
  const c = cos(rot)
  const s = sin(rot)
  for (let i = 0; i < n; i++) {
    const a = (i / n) * PI * 2
    const x = cos(a) * rx
    const y = sin(a) * ry
    pts.push(cx + x * c - y * s, cy + x * s + y * c)
  }
  return g.poly(pts, true)
}

/** Two-bone limb. Angles are measured from straight down; positive swings toward +x. */
function limb(g: Graphics, x: number, y: number, a1: number, l1: number, a2: number, l2: number, st: Stroke): { x: number; y: number } {
  const kx = x + sin(a1) * l1
  const ky = y + cos(a1) * l1
  const fx = kx + sin(a1 + a2) * l2
  const fy = ky + cos(a1 + a2) * l2
  g.moveTo(x, y).lineTo(kx, ky).lineTo(fx, fy).stroke({ ...st, cap: 'round', join: 'round' })
  return { x: fx, y: fy }
}

function curve(g: Graphics, pts: number[], st: Stroke): void {
  g.moveTo(pts[0], pts[1]).bezierCurveTo(pts[2], pts[3], pts[4], pts[5], pts[6], pts[7]).stroke({ ...st, cap: 'round' })
}

function shade(color: number, f: number): number {
  const r = Math.min(255, Math.round(((color >> 16) & 255) * f))
  const gg = Math.min(255, Math.round(((color >> 8) & 255) * f))
  const b = Math.min(255, Math.round((color & 255) * f))
  return (r << 16) | (gg << 8) | b
}

function eye(g: Graphics, x: number, y: number, r: number, iris: number, p: Pose, slit = false, happy = false): void {
  if (p.blink || p.state === 'sleeping') {
    g.moveTo(x - r, y).quadraticCurveTo(x, y + r * 0.7, x + r, y).stroke({ width: max(1, r * 0.35), color: 0x2a1d17, cap: 'round' })
    return
  }
  if (happy) {
    g.moveTo(x - r, y + r * 0.2).quadraticCurveTo(x, y - r, x + r, y + r * 0.2).stroke({ width: max(1, r * 0.4), color: 0x2a1d17, cap: 'round' })
    return
  }
  ell(g, x, y, r, r * 1.05).fill(iris)
  const px = x + p.look * r * 0.25 + r * 0.15
  if (slit) ell(g, px, y, r * 0.28, r * 0.9).fill(0x111111)
  else g.circle(px, y, r * 0.62).fill(0x111111)
  g.circle(px + r * 0.25, y - r * 0.35, r * 0.25).fill({ color: 0xffffff, alpha: 0.9 })
}

function zzz(g: Graphics, x: number, y: number, t: number): void {
  for (let i = 0; i < 3; i++) {
    const k = (t * 0.35 + i / 3) % 1
    const s = 3 + k * 4
    const zx = x + k * 10
    const zy = y - k * 26
    g.moveTo(zx, zy).lineTo(zx + s, zy).lineTo(zx, zy + s).lineTo(zx + s, zy + s).stroke({ width: 1.3, color: 0x6b7280, alpha: 1 - k })
  }
}

// ---------- quadrupeds (cat, puppy, squirrel, rabbit) ----------

interface QuadSpec {
  fur: number
  belly: number
  accent: number
  iris: number
  legLen: number
  bodyRx: number
  bodyRy: number
  headR: number
  ears: 'pointy' | 'floppy' | 'tufted' | 'long'
  tail: 'cat' | 'wag' | 'bushy' | 'puff'
  snout: number
  stripes?: boolean
  slitEyes?: boolean
  hop?: boolean
}

function quadruped(spec: QuadSpec): Rig {
  const S = spec
  const legW = S.bodyRy * 0.55
  const height = S.legLen + S.bodyRy * 2 + S.headR * 2.6
  return {
    height,
    width: S.bodyRx * 2 + S.headR * 2.4,
    origin: 'feet',
    groundOffset: 0,
    view: 'side',
    gaitHz: S.hop ? 1.6 : 1.4,
    draw(g, p) {
      const st = p.state
      const moving = st === 'walking' || st === 'running' || st === 'climbing'
      const run = st === 'running'
      const amp = run ? 0.75 : 0.42
      const far = shade(S.fur, 0.72)
      let bodyCy = -S.legLen - S.bodyRy * 0.7
      let bodyRot = 0
      let headX = S.bodyRx * 1.12
      let headY = bodyCy - S.bodyRy * 0.9
      let headTilt = 0
      const breathe = 1 + sin(p.t * 2.2) * 0.02

      if (moving && !S.hop) bodyCy -= abs(sin(p.phase)) * (run ? 3 : 1.5)
      if (moving && S.hop) bodyCy -= abs(sin(p.phase)) * S.legLen * 0.7
      if (st === 'looking') headTilt = sin(p.t * 1.3) * 0.25
      if (st === 'stretching') {
        bodyRot = 0.28
        headY += S.bodyRy * 0.9
        headX += 2
      }

      const sitting = st === 'sitting' || st === 'idle' && S.hop
      const sleeping = st === 'sleeping'

      // --- tail (behind body)
      const tailBase = { x: -S.bodyRx * 0.95, y: bodyCy - S.bodyRy * 0.2 }
      const wag = S.tail === 'wag' ? sin(p.t * (moving || st === 'interacting' ? 14 : 5)) * 0.5 : sin(p.t * 1.6) * 0.25
      if (sleeping) {
        curve(g, [tailBase.x + 4, -3, tailBase.x - 6, 0, 0, 2, S.bodyRx * 0.9, -1], { width: legW * 1.1, color: S.fur })
      } else if (S.tail === 'cat') {
        const tx = tailBase.x - 14 + wag * 8
        curve(g, [tailBase.x, tailBase.y, tailBase.x - 12, tailBase.y - 2, tx - 6, tailBase.y - 18, tx + 2, tailBase.y - 30], { width: legW * 0.95, color: S.fur })
        if (S.stripes) curve(g, [tx - 1, tailBase.y - 24, tx, tailBase.y - 26, tx + 1, tailBase.y - 28, tx + 2, tailBase.y - 30], { width: legW, color: S.accent })
      } else if (S.tail === 'wag') {
        const a = -0.9 + wag
        curve(g, [tailBase.x, tailBase.y, tailBase.x - 8, tailBase.y - 4 + a * 4, tailBase.x - 14 + a * 3, tailBase.y - 12 + a * 6, tailBase.x - 16 + a * 5, tailBase.y - 18 + a * 4], { width: legW * 1.2, color: S.fur })
      } else if (S.tail === 'bushy') {
        for (let i = 0; i < 9; i++) {
          const k = i / 8
          const x = tailBase.x - 6 - sin(k * PI) * 12 + k * 6 + wag * k * 4
          const y = tailBase.y - k * S.bodyRy * 3.4
          g.circle(x, y, S.bodyRy * (0.55 + sin(k * PI) * 0.45)).fill(i % 2 ? S.fur : shade(S.fur, 1.08))
        }
      } else {
        g.circle(tailBase.x - 2, tailBase.y - 1, S.bodyRy * 0.55).fill(0xf8f4ee)
      }

      // --- legs
      const hipX = -S.bodyRx * 0.62
      const shX = S.bodyRx * 0.62
      const legTop = bodyCy + S.bodyRy * 0.45
      const L1 = S.legLen * 0.55
      const L2 = S.legLen * 0.55
      if (sleeping) {
        ell(g, S.bodyRx * 0.75, -legW * 0.6, S.bodyRx * 0.4, legW * 0.6).fill(S.fur)
      } else if (sitting) {
        const haunchY = -S.bodyRy * 0.85
        ell(g, hipX + 4, haunchY, S.bodyRy * 1.05, S.bodyRy * 0.9).fill(far)
        g.moveTo(shX * 0.55, -S.legLen * 1.05).lineTo(shX * 0.55, 0).stroke({ width: legW, color: far, cap: 'round' })
        g.moveTo(shX * 0.75, -S.legLen * 1.05).lineTo(shX * 0.75, 0).stroke({ width: legW, color: S.fur, cap: 'round' })
      } else if (S.hop && moving) {
        const k = sin(p.phase)
        limb(g, hipX, legTop, -0.6 - k * 0.6, L1, 1.1 + k * 0.4, L2 * 1.2, { width: legW * 1.2, color: far })
        limb(g, shX, legTop, 0.3 + k * 0.5, L1, -0.2, L2, { width: legW * 0.8, color: far })
        limb(g, shX + 2, legTop, 0.35 + k * 0.5, L1, -0.2, L2, { width: legW * 0.8, color: S.fur })
      } else {
        const swing = (o: number): [number, number] => {
          if (!moving) return [st === 'stretching' && o > 1 ? 0.9 : 0, 0]
          const a = sin(p.phase + o) * amp
          const knee = -max(0, cos(p.phase + o)) * (run ? 0.9 : 0.55)
          return [a, knee]
        }
        // far side first (diagonal pairs move together)
        let [a, k] = swing(PI)
        limb(g, hipX + 2, legTop, a, L1, -k, L2, { width: legW, color: far })
        ;[a, k] = swing(0)
        limb(g, shX + 2, legTop, a, L1, k, L2, { width: legW, color: far })
      }

      // --- body
      if (sleeping) {
        ell(g, 0, -S.bodyRy * 0.95 * breathe, S.bodyRx * 1.05, S.bodyRy * 0.95 * breathe).fill(S.fur)
        ell(g, 2, -S.bodyRy * 0.45, S.bodyRx * 0.7, S.bodyRy * 0.4).fill(S.belly)
      } else if (sitting) {
        ell(g, -2, -S.legLen * 0.7 - S.bodyRy * 0.6, S.bodyRy * 1.25, S.bodyRx * 0.62 * breathe, -0.25).fill(S.fur)
        ell(g, 3, -S.legLen * 0.75 - S.bodyRy * 0.4, S.bodyRy * 0.6, S.bodyRx * 0.4, -0.25).fill(S.belly)
        ell(g, hipX + 7, -S.bodyRy * 0.8, S.bodyRy * 1.05, S.bodyRy * 0.85).fill(S.fur)
      } else {
        ell(g, 0, bodyCy, S.bodyRx, S.bodyRy * breathe, bodyRot).fill(S.fur)
        ell(g, S.bodyRx * 0.15, bodyCy + S.bodyRy * 0.45, S.bodyRx * 0.62, S.bodyRy * 0.42, bodyRot).fill(S.belly)
        if (S.stripes) {
          for (let i = -2; i <= 2; i++) {
            const x = i * S.bodyRx * 0.28
            g.moveTo(x - 2, bodyCy - S.bodyRy * 0.95 + abs(i) * 0.6).lineTo(x + 1, bodyCy - S.bodyRy * 0.25).stroke({ width: 2.2, color: S.accent, cap: 'round', alpha: 0.85 })
          }
        }
      }

      // --- near legs (in front of body)
      if (!sleeping && !sitting) {
        if (S.hop && moving) {
          const kk = sin(p.phase)
          limb(g, hipX + 3, legTop, -0.5 - kk * 0.6, L1, 1.0 + kk * 0.4, L2 * 1.2, { width: legW * 1.3, color: S.fur })
          ell(g, hipX + 2, bodyCy + 2, S.bodyRy * 0.85, S.bodyRy * 0.75).fill(S.fur)
        } else {
          const swing = (o: number): [number, number] => {
            if (!moving) return [st === 'stretching' && o < 1 ? -0.1 : 0, st === 'stretching' && o < 1 ? 0 : 0]
            return [sin(p.phase + o) * amp, -max(0, cos(p.phase + o)) * (run ? 0.9 : 0.55)]
          }
          let [a, k] = swing(0)
          limb(g, hipX, legTop, a, L1, -k, L2, { width: legW, color: S.fur })
          ;[a, k] = swing(PI)
          if (st === 'stretching') limb(g, shX, legTop + 2, 1.35, L1, 0.1, L2, { width: legW, color: S.fur })
          else limb(g, shX, legTop, a, L1, k, L2, { width: legW, color: S.fur })
          if (S.hop) ell(g, hipX + 2, bodyCy + 2, S.bodyRy * 0.85, S.bodyRy * 0.75).fill(S.fur)
        }
      }

      // --- head
      if (sleeping) {
        headX = S.bodyRx * 0.85
        headY = -S.headR * 0.95
        headTilt = 0.25
      } else if (sitting) {
        headX = S.bodyRy * 0.55
        headY = -S.legLen * 0.75 - S.bodyRx * 1.15
      }
      drawHead(g, S, headX, headY, headTilt, p)
      if (sleeping) zzz(g, headX + 6, headY - S.headR, p.t)
    }
  }
}

function drawHead(g: Graphics, S: QuadSpec, x: number, y: number, tilt: number, p: Pose): void {
  const r = S.headR
  const c = cos(tilt)
  const s = sin(tilt)
  const at = (dx: number, dy: number): [number, number] => [x + dx * c - dy * s, y + dx * s + dy * c]
  const far = shade(S.fur, 0.72)
  const happy = p.state === 'interacting'

  // ears behind head
  if (S.ears === 'pointy' || S.ears === 'tufted') {
    for (const [ox, col] of [[-r * 0.55, far], [r * 0.05, S.fur]] as const) {
      const [bx1, by1] = at(ox - r * 0.32, -r * 0.6)
      const [bx2, by2] = at(ox + r * 0.42, -r * 0.7)
      const [tx, ty] = at(ox - r * 0.05 + (S.ears === 'tufted' ? 0 : r * 0.05), -r * (S.ears === 'tufted' ? 1.35 : 1.55))
      g.poly([bx1, by1, tx, ty, bx2, by2], true).fill(col)
      if (col === S.fur && S.ears === 'pointy') {
        const [ix, iy] = at(ox + r * 0.02, -r * 1.18)
        g.poly([bx1 + 2, by1, ix, iy, bx2 - 2, by2 + 1], true).fill(0xe8a0a0)
      }
      if (S.ears === 'tufted') g.circle(tx, ty, 1.6).fill(shade(S.fur, 0.6))
    }
  } else if (S.ears === 'long') {
    const flop = sin(p.t * 2) * 0.05
    for (const [ox, col, rot] of [[-r * 0.5, far, -0.35], [-r * 0.1, S.fur, -0.2]] as const) {
      const [ex, ey] = at(ox, -r * 1.7)
      ell(g, ex, ey, r * 0.32, r * 1.05, rot + flop + tilt).fill(col)
      if (col === S.fur) ell(g, ex + 0.5, ey + 1, r * 0.16, r * 0.8, rot + flop + tilt).fill(0xe9b5b5)
    }
  }

  // skull + snout
  ell(g, x, y, r * 1.05, r).fill(S.fur)
  if (S.snout > 0) {
    const [sx, sy] = at(r * 0.85, r * 0.3)
    ell(g, sx, sy, r * 0.62 * S.snout, r * 0.45, tilt).fill(S.belly)
    const [nx, ny] = at(r * 0.85 + r * 0.55 * S.snout, r * 0.18)
    ell(g, nx, ny, r * 0.2, r * 0.16).fill(0x2a1d17)
    if (happy || p.state === 'running') {
      const [tx, ty] = at(r * 0.9, r * 0.75)
      ell(g, tx, ty, r * 0.16, r * 0.24).fill(0xe46f7d)
    }
  } else {
    const [nx, ny] = at(r * 0.98, r * 0.15)
    g.poly([nx - 2, ny - 1.5, nx + 1, ny - 1.5, nx - 0.5, ny + 1], true).fill(0xd98282)
  }
  if (S.stripes) {
    for (let i = -1; i <= 1; i++) {
      const [ax, ay] = at(i * r * 0.22, -r * 0.92)
      const [bx, by] = at(i * r * 0.16, -r * 0.55)
      g.moveTo(ax, ay).lineTo(bx, by).stroke({ width: 1.8, color: S.accent, cap: 'round' })
    }
  }
  // eye
  const [ex, ey] = at(r * 0.35, -r * 0.15)
  eye(g, ex, ey, r * 0.24, S.iris, p, S.slitEyes, happy)
  // whiskers (cats)
  if (S.slitEyes) {
    const [wx, wy] = at(r * 0.85, r * 0.3)
    for (const dy of [-1.5, 1, 3.5]) g.moveTo(wx, wy).lineTo(wx + r * 0.9, wy + dy * 0.8).stroke({ width: 0.6, color: 0xffffff, alpha: 0.7 })
  }
  // floppy ear in front
  if (S.ears === 'floppy') {
    const swing = sin(p.t * (p.state === 'walking' || p.state === 'running' ? 8 : 2)) * 0.12
    const [fx, fy] = at(-r * 0.25, r * 0.15)
    ell(g, fx, fy, r * 0.38, r * 0.78, 0.25 + swing + tilt).fill(shade(S.fur, 0.82))
  }
}

// ---------- penguin ----------

const penguin: Rig = {
  height: 74,
  width: 44,
  origin: 'feet',
  groundOffset: 0,
  view: 'side',
  gaitHz: 1.8,
  draw(g, p) {
    const moving = p.state === 'walking' || p.state === 'running'
    const w = moving ? sin(p.phase) : 0
    const sway = w * 0.12
    const lift = (o: number): number => (moving ? max(0, sin(p.phase + o)) * 4 : 0)
    // feet
    ell(g, -4 + 0, -1.5 - lift(PI), 7, 2.5).fill(0xf29b38)
    ell(g, 6, -1.5 - lift(0), 7, 2.5).fill(0xf29b38)
    if (p.state === 'sleeping') zzz(g, 14, -70, p.t)
    const cx = 0
    const cy = -34
    ell(g, cx, cy, 18, 32, sway).fill(0x1d2433)
    ell(g, cx + 5, cy + 4, 12, 25, sway).fill(0xf5f3ee)
    // flipper
    const flap = p.state === 'interacting' ? sin(p.t * 18) * 0.6 : moving ? w * 0.25 : 0
    ell(g, cx - 4 + sin(sway) * 10, cy + 2, 5, 17, 0.25 + flap + sway).fill(0x151b27)
    // head
    const hx = cx + sin(sway) * 26 + 4
    const hy = cy - 26
    g.circle(hx, hy, 13).fill(0x1d2433)
    ell(g, hx + 5, hy + 2, 7, 8).fill(0xf5f3ee)
    g.poly([hx + 11, hy - 1, hx + 20, hy + 2, hx + 11, hy + 4], true).fill(0xf29b38)
    eye(g, hx + 5, hy - 2, 2.6, 0x111111, p, false, p.state === 'interacting')
    ell(g, hx + 3, hy + 6, 3, 1.8).fill({ color: 0xf3b6a8, alpha: 0.5 })
  }
}

// ---------- spider ----------

const spider: Rig = {
  height: 62,
  width: 70,
  origin: 'hang',
  groundOffset: 0,
  view: 'top',
  gaitHz: 1,
  draw(g, p) {
    const body = 0x2b2420
    const leg = 0x3a302a
    const twitch = (i: number): number => sin(p.t * 3 + i * 1.7) * 0.06 + (p.state === 'interacting' ? sin(p.t * 20 + i) * 0.25 : 0)
    const climbing = p.state === 'ascending' || p.state === 'descending'
    const cy = 40
    // legs: 4 per side, from the cephalothorax
    for (let i = 0; i < 4; i++) {
      for (const side of [-1, 1]) {
        const base = -0.9 + i * 0.55
        const step = climbing ? sin(p.t * 9 + i * PI * 0.5 + (side > 0 ? PI : 0)) * 0.18 : 0
        const a1 = side * (PI / 2 + base * 0.9 + twitch(i * side) + step)
        const k = limb(g, side * 3, cy - 2 + i * 1.5, a1, 17, -side * (0.9 + i * 0.12), 20, { width: 2.2, color: leg })
        g.circle(k.x, k.y, 1.1).fill(leg)
      }
    }
    // abdomen (top, attached to thread) and head
    ell(g, 0, 18, 13, 16).fill(body)
    ell(g, -3, 13, 4, 6).fill({ color: 0xffffff, alpha: 0.08 })
    for (let i = 0; i < 3; i++) ell(g, 0, 10 + i * 7, 5 - i, 1.6).fill({ color: 0x8a5a2b, alpha: 0.6 })
    ell(g, 0, cy, 9, 8).fill(shade(body, 1.1))
    // eyes face the viewer at the bottom
    for (const [x, y, r] of [[-3, 45, 1.8], [3, 45, 1.8], [-6, 43, 1.1], [6, 43, 1.1]] as const) {
      g.circle(x, y, r).fill(0x0b0b0b)
      g.circle(x + 0.5, y - 0.5, r * 0.35).fill({ color: 0xffffff, alpha: p.blink ? 0 : 0.8 })
    }
    ell(g, -2, 49, 1.2, 2.4).fill(0x1a1410)
    ell(g, 2, 49, 1.2, 2.4).fill(0x1a1410)
  }
}

// ---------- bat ----------

const BAT = 0x3b3043
const BAT_WING = 0x2b2232

const bat: Rig = {
  height: 60,
  width: 90,
  origin: 'hang',
  groundOffset: 0,
  view: 'side',
  gaitHz: 1,
  flyCenterY: 28,
  draw(g, p) {
    if (p.state === 'flying' || p.state === 'landing') {
      // in flight: origin is effectively the body centre, offset by height/2 in entity
      const f = sin(p.phase * 2.2)
      const tipY = -f * 26
      for (const s of [-1, 1]) {
        const midY = tipY * 0.5
        g.poly([0, 28, s * 18, 22 + midY, s * 42, 24 + tipY, s * 34, 34 + tipY * 0.6, s * 26, 32 + midY * 0.6, s * 16, 38 + midY * 0.4, 0, 36], true).fill(BAT_WING)
      }
      ell(g, 0, 32, 8, 11).fill(BAT)
      g.circle(0, 20, 7).fill(BAT)
      g.poly([-5, 16, -4, 7, -1, 15], true).fill(BAT)
      g.poly([5, 16, 4, 7, 1, 15], true).fill(BAT)
      eye(g, -2.5, 20, 1.4, 0x111111, p)
      eye(g, 2.5, 20, 1.4, 0x111111, p)
      return
    }
    // hanging upside down: feet at origin
    const sway = sin(p.t * 1.5) * 0.04
    g.moveTo(-3, 0).lineTo(-3, 6).stroke({ width: 1.6, color: 0x1d1720 })
    g.moveTo(3, 0).lineTo(3, 6).stroke({ width: 1.6, color: 0x1d1720 })
    ell(g, 0, 22, 11, 18, sway).fill(BAT)
    // folded wings wrap the body
    ell(g, -6, 24, 7, 20, 0.15 + sway).fill(BAT_WING)
    ell(g, 6, 24, 7, 20, -0.15 + sway).fill(BAT_WING)
    // head at the bottom
    const hy = 44
    g.circle(0, hy, 8).fill(BAT)
    g.poly([-6, hy + 4, -6, hy + 15, -2, hy + 6], true).fill(BAT)
    g.poly([6, hy + 4, 6, hy + 15, 2, hy + 6], true).fill(BAT)
    eye(g, -3, hy - 1, 1.5, 0x111111, { ...p, look: 0 })
    eye(g, 3, hy - 1, 1.5, 0x111111, { ...p, look: 0 })
    g.poly([-1.2, hy - 5, 1.2, hy - 5, 0, hy - 3], true).fill(0xe8a0b0)
  }
}

// ---------- bird ----------

const bird: Rig = {
  height: 40,
  width: 54,
  origin: 'center',
  groundOffset: 15,
  view: 'side',
  gaitHz: 3,
  draw(g, p) {
    const flying = p.state === 'flying' || p.state === 'landing'
    const hop = p.state === 'walking' || p.state === 'running' ? -abs(sin(p.phase)) * 5 : 0
    const y0 = hop
    // tail
    g.poly([-12, y0 - 2, -26, y0 - 6, -27, y0 + 1, -12, y0 + 4], true).fill(0x5b4636)
    if (!flying) {
      g.moveTo(-1, y0 + 8).lineTo(-2, y0 + 15).stroke({ width: 1.3, color: 0x9a6b3c })
      g.moveTo(4, y0 + 8).lineTo(4, y0 + 15).stroke({ width: 1.3, color: 0x9a6b3c })
    }
    ell(g, 0, y0, 15, 10).fill(0x6e5643)
    ell(g, 5, y0 + 3, 9, 7).fill(0xe0703a) // red breast
    const hx = 14
    const hy = y0 - 6 + (p.state === 'looking' ? sin(p.t * 3) * 1.5 : 0)
    g.circle(hx, hy, 7.5).fill(0x6e5643)
    ell(g, hx + 2, hy + 3, 5, 3.5).fill(0xe0703a)
    g.poly([hx + 6, hy - 1.5, hx + 12, hy + 0.5, hx + 6, hy + 2], true).fill(0x3a2a1c)
    eye(g, hx + 2.5, hy - 1.5, 1.7, 0x111111, p)
    // wing
    if (flying) {
      const f = sin(p.phase * 2.5)
      const tip = -f * 18
      g.poly([-6, y0 - 4, 6, y0 - 4, 2, y0 - 8 + tip, -12, y0 - 6 + tip * 1.1], true).fill(0x5b4636)
    } else {
      ell(g, -3, y0 - 1, 10, 6, 0.15).fill(0x5b4636)
    }
  }
}

// ---------- butterfly ----------

const butterfly: Rig = {
  height: 40,
  width: 48,
  origin: 'center',
  groundOffset: 12,
  view: 'top',
  gaitHz: 1,
  draw(g, p) {
    const flying = p.state === 'flying' || p.state === 'landing'
    const f = flying ? 0.25 + abs(cos(p.phase * 2.8)) * 0.75 : 0.85 + sin(p.t * 1.2) * 0.15
    const orange = 0xf08a24
    const black = 0x1b1410
    for (const s of [-1, 1]) {
      const w = s * f
      // upper wing
      g.poly([0, -2, w * 10, -18, w * 22, -16, w * 21, -4, w * 6, 2], true).fill(black)
      g.poly([0, -1, w * 9, -15, w * 19, -14, w * 18, -5, w * 5, 1], true).fill(orange)
      // lower wing
      g.poly([0, 1, w * 16, 4, w * 15, 14, w * 6, 15, 0, 6], true).fill(black)
      g.poly([0, 2, w * 14, 5, w * 13, 12, w * 6, 13, 0, 6], true).fill(orange)
      for (const [x, y] of [[19, -12], [20, -7], [13, 11]]) g.circle(w * x, y, abs(w) * 1.1 + 0.2).fill(0xffffff)
      g.moveTo(0, -1).lineTo(w * 14, -11).stroke({ width: 0.8, color: black })
      g.moveTo(0, 2).lineTo(w * 11, 9).stroke({ width: 0.8, color: black })
    }
    ell(g, 0, 1, 1.8, 10).fill(black)
    g.circle(0, -9, 2.2).fill(black)
    g.moveTo(-0.5, -10).lineTo(-4, -18).stroke({ width: 0.6, color: black })
    g.moveTo(0.5, -10).lineTo(4, -18).stroke({ width: 0.6, color: black })
  }
}

// ---------- dragonfly ----------

const dragonfly: Rig = {
  height: 30,
  width: 60,
  origin: 'center',
  groundOffset: 6,
  view: 'top',
  gaitHz: 1,
  draw(g, p) {
    const flying = p.state === 'flying' || p.state === 'landing'
    const blur = flying ? 0.35 : 0.55
    const f = flying ? sin(p.t * 60) * 3 : 0
    for (const [x, len] of [[2, 26], [-4, 24]] as const) {
      for (const s of [-1, 1]) {
        ell(g, x + (x > 0 ? 1 : -1), s * (len / 2 + 1) + f * s, 4, len / 2, s * 0.12).fill({ color: 0xcfe8f5, alpha: blur })
        g.moveTo(x, 0).lineTo(x + 1, s * len).stroke({ width: 0.5, color: 0x6aa3c0, alpha: 0.6 })
      }
    }
    // abdomen
    for (let i = 0; i < 9; i++) g.circle(-6 - i * 2.8, 0, 2.3 - i * 0.12).fill(i % 2 ? 0x1f6f8b : 0x2a8fb0)
    ell(g, 2, 0, 5, 3.6).fill(0x2a8fb0)
    g.circle(8, -2.6, 2.8).fill(0x2b6d3d)
    g.circle(8, 2.6, 2.8).fill(0x2b6d3d)
  }
}

// ---------- gecko (top view) ----------

const gecko: Rig = {
  height: 34,
  width: 76,
  origin: 'center',
  groundOffset: 0,
  view: 'top',
  gaitHz: 2.2,
  draw(g, p) {
    const moving = p.state === 'climbing' || p.state === 'walking' || p.state === 'running'
    const ph = moving ? p.phase : 0
    const sway = sin(ph) * 0.18 + (moving ? 0 : sin(p.t * 0.8) * 0.05)
    const skin = 0x7cbf4a
    const dark = 0x4e8a2c
    // tail (S-curve following the gait)
    const tx = -16
    curve(g, [tx, 0, tx - 10, sin(ph) * 6, tx - 22, -sin(ph) * 8 + sway * 10, tx - 34, sin(ph + 1) * 6], { width: 5, color: skin })
    curve(g, [tx - 22, -sin(ph) * 8 + sway * 10, tx - 26, 0, tx - 30, 0, tx - 34, sin(ph + 1) * 6], { width: 3, color: skin })
    // legs: diagonal pairs
    const legs: [number, number, number][] = [[8, -1, 0], [8, 1, PI], [-12, -1, PI], [-12, 1, 0]]
    for (const [x, s, o] of legs) {
      const a = moving ? sin(ph + o) * 0.5 : 0
      const kx = x + 4 * s * 0 + cos(a) * 2
      const ky = s * 7
      const fx = kx + 6 * (x > 0 ? 1 : -1) * 0.6 + sin(a) * 6
      const fy = s * 13
      g.moveTo(x, s * 3).lineTo(kx, ky).lineTo(fx, fy).stroke({ width: 3, color: skin, cap: 'round', join: 'round' })
      for (const d of [-0.6, 0, 0.6]) g.circle(fx + cos(d + (s > 0 ? PI / 2 : -PI / 2)) * 2.5, fy + sin(d + (s > 0 ? PI / 2 : -PI / 2)) * 2.5, 1.3).fill(skin)
    }
    ell(g, -3, 0, 17, 6.5, sway * 0.3).fill(skin)
    for (const x of [-12, -6, 0, 6]) g.circle(x, (x % 4) - 1, 1.5).fill(dark)
    // head
    ell(g, 17, sway * 2, 8, 6).fill(skin)
    eye(g, 19, -4 + sway * 2, 1.8, 0xd6b23a, p)
    eye(g, 19, 4 + sway * 2, 1.8, 0xd6b23a, p)
  }
}

export const RIGS: Record<RigId, Rig> = {
  cat: quadruped({
    fur: 0xe39a4f, belly: 0xf6dcb8, accent: 0xb86b2a, iris: 0x9bc45a, legLen: 20, bodyRx: 24, bodyRy: 11,
    headR: 11, ears: 'pointy', tail: 'cat', snout: 0, stripes: true, slitEyes: true
  }),
  puppy: quadruped({
    fur: 0xe2b263, belly: 0xf7e2b8, accent: 0xb9853a, iris: 0x4a3222, legLen: 20, bodyRx: 23, bodyRy: 12,
    headR: 12, ears: 'floppy', tail: 'wag', snout: 1
  }),
  squirrel: quadruped({
    fur: 0xb5652e, belly: 0xf1d9b9, accent: 0x7a3f17, iris: 0x1a1a1a, legLen: 12, bodyRx: 16, bodyRy: 9,
    headR: 8.5, ears: 'tufted', tail: 'bushy', snout: 0.35
  }),
  rabbit: quadruped({
    fur: 0xb8a493, belly: 0xefe6dc, accent: 0x8a7766, iris: 0x2b1a12, legLen: 11, bodyRx: 18, bodyRy: 13,
    headR: 10, ears: 'long', tail: 'puff', snout: 0.25, hop: true
  }),
  penguin,
  spider,
  bat,
  bird,
  butterfly,
  dragonfly,
  gecko
}
