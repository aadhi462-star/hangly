import { describe, expect, it } from 'vitest'
import { BUILT_IN_CHARACTERS } from '../src/shared/defaults'
import { canEat, foodsFor, HUNGER_MS, isHungry } from '../src/shared/food'
import { moodLabel, moodOf, nightness } from '../src/shared/mood'

const cat = BUILT_IN_CHARACTERS.find((c) => c.id === 'cat')!

describe('food', () => {
  it('gives built-in animals their own diet, favourite first', () => {
    expect(foodsFor(cat).map((f) => f.id)).toEqual(['fish', 'chicken', 'mouse'])
    expect(canEat(cat)).toBe(true)
  })

  it('has no food rules for your own characters', () => {
    expect(foodsFor({ id: 'c_spiderman', builtIn: false })).toEqual([])
    expect(canEat({ id: 'c_spiderman', builtIn: false })).toBe(false)
  })

  it('gets hungry a few hours after the last meal', () => {
    const now = 1_000_000_000_000
    expect(isHungry({ lastFed: now - 60_000, addedAt: 0 }, now)).toBe(false)
    expect(isHungry({ lastFed: now - HUNGER_MS - 1, addedAt: 0 }, now)).toBe(true)
    // A character just added isn't hungry yet.
    expect(isHungry({ lastFed: 0, addedAt: now }, now)).toBe(false)
  })

  it('every built-in diet refers to real foods', () => {
    for (const c of BUILT_IN_CHARACTERS) for (const f of foodsFor(c)) expect(f?.emoji).toBeTruthy()
  })
})

describe('mood', () => {
  it('fades over time without attention', () => {
    const now = Date.UTC(2026, 0, 1)
    expect(moodOf({ affection: 80, affectionAt: now }, now)).toBe(80)
    expect(moodOf({ affection: 80, affectionAt: now - 5 * 3_600_000 }, now)).toBe(60)
    expect(moodOf({ affection: 10, affectionAt: now - 100 * 3_600_000 }, now)).toBe(0)
  })

  it('labels the mood', () => {
    expect(moodLabel(90).text).toBe('Happy')
    expect(moodLabel(10).text).toBe('Lonely')
  })

  it('knows day from night', () => {
    expect(nightness(new Date(2026, 0, 1, 12))).toBe(0)
    expect(nightness(new Date(2026, 0, 1, 23))).toBe(1)
    expect(nightness(new Date(2026, 0, 1, 20))).toBeCloseTo(0.5)
  })
})
