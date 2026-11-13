import type { CharacterDefinition } from './types'

export interface Food {
  id: string
  name: string
  emoji: string
  /** Colour of the crumbs that fall while it is eaten. */
  crumbs: number
  /** Live prey moves on its own and has to be caught. */
  prey?: 'buzz' | 'scurry' | 'hop' | 'wriggle'
}

export const FOODS: Record<string, Food> = {
  meat: { id: 'meat', name: 'Meat', emoji: '🥩', crumbs: 0xb5363c },
  chicken: { id: 'chicken', name: 'Chicken', emoji: '🍗', crumbs: 0xc98a3a },
  fish: { id: 'fish', name: 'Fish', emoji: '🐟', crumbs: 0x9fb3c4 },
  bone: { id: 'bone', name: 'Bone', emoji: '🦴', crumbs: 0xe8e0cc },
  carrot: { id: 'carrot', name: 'Carrot', emoji: '🥕', crumbs: 0xf08a24 },
  apple: { id: 'apple', name: 'Apple', emoji: '🍎', crumbs: 0xd8333a },
  grass: { id: 'grass', name: 'Fresh grass', emoji: '🌿', crumbs: 0x5aa33c },
  berries: { id: 'berries', name: 'Berries', emoji: '🫐', crumbs: 0x3d4f9e },
  banana: { id: 'banana', name: 'Banana', emoji: '🍌', crumbs: 0xf2d24b },
  acorn: { id: 'acorn', name: 'Acorn', emoji: '🌰', crumbs: 0x8a5a2b },
  nut: { id: 'nut', name: 'Peanut', emoji: '🥜', crumbs: 0xc89a5c },
  seeds: { id: 'seeds', name: 'Seeds', emoji: '🌾', crumbs: 0xd8b76a },
  worm: { id: 'worm', name: 'Worm', emoji: '🪱', crumbs: 0xd77b8a, prey: 'wriggle' },
  mouse: { id: 'mouse', name: 'Mouse', emoji: '🐁', crumbs: 0x8f8a86, prey: 'scurry' },
  fly: { id: 'fly', name: 'Fly', emoji: '🪰', crumbs: 0x3a3a3a, prey: 'buzz' },
  mosquito: { id: 'mosquito', name: 'Mosquito', emoji: '🦟', crumbs: 0x4a4a4a, prey: 'buzz' },
  cricket: { id: 'cricket', name: 'Cricket', emoji: '🦗', crumbs: 0x6b8a3a, prey: 'hop' },
  flower: { id: 'flower', name: 'Flower nectar', emoji: '🌸', crumbs: 0xf4a6c4 },
  cookie: { id: 'cookie', name: 'Cookie', emoji: '🍪', crumbs: 0xc8914a }
}

/** What each built-in character eats, favourite first. */
const DIETS: Record<string, string[]> = {
  cat: ['fish', 'chicken'],
  puppy: ['bone', 'meat'],
  rabbit: ['carrot', 'grass'],
  penguin: ['fish'],
  squirrel: ['acorn', 'nut'],
  spider: ['fly', 'mosquito'],
  bat: ['banana', 'mosquito'],
  bird: ['worm', 'seeds'],
  butterfly: ['flower'],
  dragonfly: ['mosquito'],
  gecko: ['cricket']
}

/** How long after a meal a character gets hungry again. */
export const HUNGER_MS = 3 * 60 * 60 * 1000

export function isHungry(i: { lastFed?: number; addedAt: number }, now = Date.now()): boolean {
  return now - Math.max(i.lastFed ?? 0, i.addedAt) > HUNGER_MS
}

/** Your own characters can be offered anything from this general menu. */
const GENERAL = ['cookie', 'apple', 'meat', 'fish', 'banana', 'carrot']

export function foodsFor(def: Pick<CharacterDefinition, 'id' | 'builtIn'>): Food[] {
  return (def.builtIn ? (DIETS[def.id] ?? GENERAL) : GENERAL).map((id) => FOODS[id])
}
