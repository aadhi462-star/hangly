import { describe, expect, it } from 'vitest'
import { BUILT_IN_CHARACTERS, DEFAULT_SETTINGS, newInstance } from '../src/shared/defaults'
import { FOODS } from '../src/shared/food'
import { Entity, type Surface, type World } from '../src/renderer/engine/Entity'
import type { CharacterInstance } from '../src/shared/types'

const def = (id: string) => BUILT_IN_CHARACTERS.find((c) => c.id === id)!

function world(entities: Entity[], surfaces: Surface[] = [], extra: Partial<World> = {}): World {
  return {
    w: 1400, h: 860, top: -30, cursor: null, paused: false, profile: DEFAULT_SETTINGS.profile, volume: 0, idleSounds: false,
    avoidOverlap: true, entities, surfaces, onFed: null, onAffection: null, night: 0, lively: false, cursorSpeed: 0, adapt: null, ...extra
  }
}

function make(id: string, patch: Partial<CharacterInstance> = {}): Entity {
  const inst = { ...newInstance(def(id), 1, 1400), ...patch }
  inst.movement = { ...inst.movement, autoMovement: false }
  return new Entity(inst, def(id), () => '')
}

function run(e: Entity, w: World, seconds: number): void {
  for (let t = 0; t < seconds; t += 1 / 60) e.update(1 / 60, w)
}

describe('gravity', () => {
  it('a walker placed in mid-air falls and lands on the ground', () => {
    const cat = make('cat', { x: 500, y: 200 })
    const w = world([cat])
    run(cat, w, 2)
    expect(cat.y).toBeCloseTo(860, 0)
    expect(cat.state).not.toBe('landing')
  })

  it('lands on the top of a window below instead of the ground', () => {
    const cat = make('cat', { x: 500, y: 100 })
    const win: Surface = { id: 7, x: 300, y: 500, w: 600, h: 300 }
    const w = world([cat], [win])
    run(cat, w, 2)
    expect(cat.y).toBeCloseTo(500, 0)
  })

  it('falls to the ground when the window it stands on goes away', () => {
    const cat = make('cat', { x: 500, y: 100 })
    const w = world([cat], [{ id: 7, x: 300, y: 500, w: 600, h: 300 }])
    run(cat, w, 2)
    w.surfaces = []
    run(cat, w, 2)
    expect(cat.y).toBeCloseTo(860, 0)
  })

  it('still lands while paused (pause stops behaviour, not physics)', () => {
    const cat = make('cat', { x: 500, y: 200 })
    run(cat, world([cat], [], { paused: true }), 2)
    expect(cat.y).toBeCloseTo(860, 0)
  })
})

describe('hanging', () => {
  // Idle sway keeps a hanger gently swinging by design, so these use a still thread.
  const still = () => {
    const s = make('spider', { x: 400 })
    s.inst.hanging = { ...s.inst.hanging, idleSway: false }
    return s
  }

  it('hangs straight down from the top edge at rest', () => {
    const spider = still()
    run(spider, world([spider]), 6)
    expect(spider.x).toBeCloseTo(400, 0)
    expect(spider.y).toBeGreaterThan(0)
  })

  it('swings back to rest after a push', () => {
    const spider = still()
    const w = world([spider])
    run(spider, w, 1)
    spider.interact(w)
    run(spider, w, 0.3)
    expect(Math.abs(spider.x - 400)).toBeGreaterThan(2)
    run(spider, w, 20)
    expect(Math.abs(spider.x - 400)).toBeLessThan(2)
  })
})

describe('feeding', () => {
  it('a walker goes to its food, eats it and reports the meal', () => {
    const cat = make('cat', { x: 400, y: 860 })
    let fed = 0
    let love = 0
    const w = world([cat], [], { onFed: () => fed++, onAffection: (_e, d) => (love += d) })
    run(cat, w, 0.5)
    cat.feed(FOODS.fish, w)
    expect(cat.isEating()).toBe(true)
    run(cat, w, 15)
    expect(fed).toBe(1)
    expect(love).toBeGreaterThan(0)
    expect(cat.isEating()).toBe(false)
  })

  it('a hanging spider catches a fly', () => {
    const spider = make('spider', { x: 400 })
    let fed = 0
    const w = world([spider], [], { onFed: () => fed++ })
    run(spider, w, 1)
    spider.feed(FOODS.fly, w)
    run(spider, w, 20)
    expect(fed).toBe(1)
  })
})

describe('visiting the active window', () => {
  it('walks under the window and jumps up onto its top edge', () => {
    const cat = make('cat', { x: 200, y: 860 })
    const win: Surface = { id: 9, x: 700, y: 560, w: 500, h: 300 }
    const w = world([cat], [win], { lively: true })
    run(cat, w, 0.5)
    ;(cat as unknown as { visitWindow: number }).visitWindow = 9
    run(cat, w, 10)
    expect(cat.y).toBeCloseTo(560, 0)
    expect(cat.x).toBeGreaterThan(700)
  })
})
