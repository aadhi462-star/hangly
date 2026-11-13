/** Affection 0..100: petting, clicks and meals raise it; it slowly fades without attention. */
export const AFFECTION_DECAY_PER_HOUR = 4

export function moodOf(i: { affection?: number; affectionAt?: number }, now = Date.now()): number {
  const base = typeof i.affection === 'number' ? i.affection : 50
  const hours = i.affectionAt ? Math.max(0, now - i.affectionAt) / 3_600_000 : 0
  return Math.max(0, Math.min(100, base - hours * AFFECTION_DECAY_PER_HOUR))
}

export function moodLabel(m: number): { emoji: string; text: string } {
  if (m >= 75) return { emoji: '😊', text: 'Happy' }
  if (m >= 45) return { emoji: '🙂', text: 'Content' }
  if (m >= 20) return { emoji: '😐', text: 'Bored' }
  return { emoji: '😔', text: 'Lonely' }
}

/** 0 by day, 1 at night, ramping over the evening (19–21h) and morning (6–8h). */
export function nightness(d = new Date()): number {
  const h = d.getHours() + d.getMinutes() / 60
  if (h >= 21 || h < 6) return 1
  if (h >= 19) return (h - 19) / 2
  if (h < 8) return 1 - (h - 6) / 2
  return 0
}
