import type { CharacterDefinition } from './types'

export interface Food {
  id: string
  name: string
  emoji: string
}

export const FOODS: Record<string, Food> = {
  meat: { id: 'meat', name: 'Meat', emoji: '🥩' },
  chicken: { id: 'chicken', name: 'Chicken', emoji: '🍗' },
  fish: { id: 'fish', name: 'Fish', emoji: '🐟' },
  bone: { id: 'bone', name: 'Bone', emoji: '🦴' },
  carrot: { id: 'carrot', name: 'Carrot', emoji: '🥕' },
  apple: { id: 'apple', name: 'Apple', emoji: '🍎' },
  grass: { id: 'grass', name: 'Fresh grass', emoji: '🌿' },
  berries: { id: 'berries', name: 'Berries', emoji: '🫐' },
  banana: { id: 'banana', name: 'Banana', emoji: '🍌' },
  acorn: { id: 'acorn', name: 'Acorn', emoji: '🌰' },
  nut: { id: 'nut', name: 'Peanut', emoji: '🥜' },
  seeds: { id: 'seeds', name: 'Seeds', emoji: '🌾' },
  worm: { id: 'worm', name: 'Worm', emoji: '🪱' },
  mouse: { id: 'mouse', name: 'Mouse', emoji: '🐁' },
  fly: { id: 'fly', name: 'Fly', emoji: '🪰' },
  mosquito: { id: 'mosquito', name: 'Mosquito', emoji: '🦟' },
  cricket: { id: 'cricket', name: 'Cricket', emoji: '🦗' },
  flower: { id: 'flower', name: 'Flower nectar', emoji: '🌸' },
  cookie: { id: 'cookie', name: 'Cookie', emoji: '🍪' }
}

/** What each built-in character eats, favourite first. */
const DIETS: Record<string, string[]> = {
  'r-tiger': ['meat', 'chicken'],
  'r-horse': ['apple', 'carrot', 'grass'],
  'r-fox': ['chicken', 'berries'],
  'r-bulldog': ['bone', 'meat'],
  'r-squirrel': ['acorn', 'nut'],
  'r-barn-owl': ['mouse'],
  'r-owl': ['mouse'],
  'r-spider': ['fly', 'mosquito'],
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

/** Your own characters can be offered anything from this general menu. */
const GENERAL = ['cookie', 'apple', 'meat', 'fish', 'banana', 'carrot']

export function foodsFor(def: Pick<CharacterDefinition, 'id' | 'builtIn'>): Food[] {
  return (def.builtIn ? (DIETS[def.id] ?? GENERAL) : GENERAL).map((id) => FOODS[id])
}
