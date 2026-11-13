import { app } from 'electron'
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BUILT_IN_PROFILES, DEFAULT_HANGING, DEFAULT_SETTINGS, MAX_CHARACTERS_HARD_LIMIT, defaultState } from '../shared/defaults'
import type { AppState, CharacterInstance, Settings } from '../shared/types'

export function dataDir(): string {
  const dir = join(app.getPath('userData'), 'Screenly')
  if (!existsSync(dir)) migrateFromScreenPals(dir)
  mkdirSync(dir, { recursive: true })
  return dir
}

/** The app used to be called ScreenPals: copy its data across once (the old folder stays as a backup). */
function migrateFromScreenPals(dir: string): void {
  const old = join(app.getPath('appData'), 'screenpals', 'ScreenPals')
  if (!existsSync(old)) return
  try {
    cpSync(old, dir, { recursive: true })
  } catch (err) {
    console.error('[store] could not copy ScreenPals data', err)
  }
}

const statePath = (): string => join(dataDir(), 'settings', 'state.json')

type Listener = (state: AppState) => void

/**
 * Owns the single AppState. All mutations go through `mutate`, which validates,
 * notifies listeners and schedules a debounced write to disk.
 */
class Store {
  state: AppState = defaultState()
  private listeners: Listener[] = []
  private saveTimer: NodeJS.Timeout | null = null

  load(): void {
    const file = statePath()
    try {
      if (existsSync(file)) {
        const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<AppState>
        this.state = migrate(raw)
      }
    } catch (err) {
      console.error('[store] could not read state, starting fresh', err)
      try {
        renameSync(file, `${file}.corrupt-${Date.now()}`)
      } catch {
        /* nothing to back up */
      }
    }
  }

  onChange(l: Listener): void {
    this.listeners.push(l)
  }

  /** Apply a change. `broadcast: false` persists without notifying (used for live positions). */
  mutate(fn: (s: AppState) => void, broadcast = true): void {
    fn(this.state)
    this.state.settings = sanitizeSettings(this.state.settings)
    this.state.instances = this.state.instances.map(sanitizeInstance)
    this.scheduleSave()
    if (broadcast) for (const l of this.listeners) l(this.state)
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.flush(), 400)
  }

  flush(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    const file = statePath()
    mkdirSync(join(dataDir(), 'settings'), { recursive: true })
    // Write-then-rename so a crash mid-write never leaves a truncated file.
    writeFileSync(`${file}.tmp`, JSON.stringify(this.state, null, 2))
    renameSync(`${file}.tmp`, file)
  }
}

export const store = new Store()

function migrate(raw: Partial<AppState>): AppState {
  const base = defaultState()
  const profiles = Array.isArray(raw.profiles) ? raw.profiles : []
  // Built-in profiles always come from code so updates reach existing users.
  const custom = profiles.filter((p) => p && !p.builtIn)
  return {
    version: 1,
    settings: sanitizeSettings(
      mergeKnown(base.settings, { ...(raw.settings ?? {}), onboarded: raw.settings?.onboarded ?? (Array.isArray(raw.instances) && raw.instances.length > 0) })
    ),
    instances: Array.isArray(raw.instances) ? raw.instances.map(sanitizeInstance) : [],
    customCharacters: Array.isArray(raw.customCharacters) ? raw.customCharacters : [],
    profiles: [...structuredClone(BUILT_IN_PROFILES), ...custom],
    hangingPresets: Array.isArray(raw.hangingPresets) ? raw.hangingPresets : [],
    recent: Array.isArray(raw.recent) ? raw.recent.filter((r) => typeof r === 'string').slice(0, 12) : []
  }
}

/**
 * Deep-merge `patch` into `target`, but only for keys that already exist in
 * `target` and whose value has the same JS type. This is the IPC validation
 * boundary: the renderer cannot add fields or change a field's type.
 */
export function mergeKnown<T>(target: T, patch: unknown): T {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return target
  const out = { ...(target as Record<string, unknown>) }
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (!(k in out)) continue
    const cur = out[k]
    if (Array.isArray(cur)) {
      if (Array.isArray(v)) out[k] = v
    } else if (cur && typeof cur === 'object') {
      out[k] = mergeKnown(cur, v)
    } else if (typeof v === typeof cur && !(typeof v === 'number' && !Number.isFinite(v))) {
      out[k] = v
    }
  }
  return out as T
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))
const ACCEL = /^[A-Za-z0-9+\-=,./;'[\]`\\ ]{0,60}$/

export function sanitizeSettings(s: Settings): Settings {
  const d = DEFAULT_SETTINGS
  const m = mergeKnown(structuredClone(d), s)
  m.globalOpacity = clamp(m.globalOpacity, 0.1, 1)
  m.maxCharacters = Math.round(clamp(m.maxCharacters, 1, MAX_CHARACTERS_HARD_LIMIT))
  if (![30, 45, 60].includes(m.fps)) m.fps = 30
  if (!['system', 'light', 'dark'].includes(m.theme)) m.theme = 'system'
  m.sound.volume = clamp(m.sound.volume, 0, 1)
  for (const k of Object.keys(m.shortcuts) as (keyof Settings['shortcuts'])[]) {
    if (!ACCEL.test(m.shortcuts[k])) m.shortcuts[k] = d.shortcuts[k]
  }
  const t = /^([01]\d|2[0-3]):[0-5]\d$/
  if (!t.test(m.focus.schedule.start)) m.focus.schedule.start = d.focus.schedule.start
  if (!t.test(m.focus.schedule.end)) m.focus.schedule.end = d.focus.schedule.end
  m.profile.scale = clamp(m.profile.scale, 0.3, 2)
  m.profile.activity = clamp(m.profile.activity, 0, 2)
  m.profile.speed = clamp(m.profile.speed, 0.2, 3)
  m.profile.idle = clamp(m.profile.idle, 0.2, 5)
  m.hiddenBuiltIns = m.hiddenBuiltIns.filter((x) => typeof x === 'string')
  return m
}

const BEHAVIOURS = ['walk', 'hang', 'fly', 'climb', 'stationary']
const COLOR = /^#[0-9a-fA-F]{6}$/

export function sanitizeInstance(i: CharacterInstance): CharacterInstance {
  const a = i.appearance
  a.scale = clamp(a.scale, 0.1, 2)
  a.opacity = clamp(a.opacity, 0.1, 1)
  a.rotation = clamp(a.rotation, -180, 180)
  a.brightness = clamp(a.brightness, 0.3, 1.7)
  a.shadowIntensity = clamp(a.shadowIntensity, 0, 1)
  const mv = i.movement
  mv.walkSpeed = clamp(mv.walkSpeed, 0, 600)
  mv.runSpeed = clamp(mv.runSpeed, 0, 1200)
  mv.climbSpeed = clamp(mv.climbSpeed, 0, 600)
  mv.flySpeed = clamp(mv.flySpeed, 0, 900)
  mv.animSpeed = clamp(mv.animSpeed, 0.1, 4)
  mv.activity = clamp(mv.activity, 0, 1)
  mv.idleSeconds = clamp(mv.idleSeconds, 0.5, 60)
  mv.areaMin = clamp(mv.areaMin, 0, 0.95)
  mv.areaMax = clamp(mv.areaMax, mv.areaMin + 0.05, 1)
  if (!['auto', 'left', 'right'].includes(mv.direction)) mv.direction = 'auto'
  const h = (i.hanging = mergeKnown(structuredClone(DEFAULT_HANGING), i.hanging))
  h.attachX = clamp(h.attachX, 0, 1)
  h.attachY = clamp(h.attachY, 0, 1)
  h.threadWidth = clamp(h.threadWidth, 0, 8)
  h.length = clamp(h.length, 0, 2000)
  h.descentDistance = clamp(h.descentDistance, 0, 2000)
  h.amplitude = clamp(h.amplitude, 0, 80)
  h.frequency = clamp(h.frequency, 0.2, 4)
  h.damping = clamp(h.damping, 0, 1)
  h.descentSpeed = clamp(h.descentSpeed, 5, 800)
  h.ascentSpeed = clamp(h.ascentSpeed, 5, 800)
  h.rotation = clamp(h.rotation, -180, 180)
  if (!COLOR.test(h.threadColor)) h.threadColor = DEFAULT_HANGING.threadColor
  if (h.anchorFrom !== 'screen' && h.anchorFrom !== 'menubar') h.anchorFrom = 'screen'
  if (!BEHAVIOURS.includes(i.behaviour)) i.behaviour = 'stationary'
  if (typeof i.lastFed !== 'number' || !Number.isFinite(i.lastFed)) i.lastFed = 0
  if (typeof i.affection !== 'number' || !Number.isFinite(i.affection)) i.affection = 50
  i.affection = clamp(i.affection, 0, 100)
  if (typeof i.affectionAt !== 'number' || !Number.isFinite(i.affectionAt)) i.affectionAt = Date.now()
  if (!Number.isFinite(i.x)) i.x = 100
  if (!Number.isFinite(i.y)) i.y = 0
  return i
}
