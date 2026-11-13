import { screen, type Display } from 'electron'
import type { DisplayInfo } from '../shared/types'

export function toDisplayInfo(d: Display, index: number): DisplayInfo {
  const primary = screen.getPrimaryDisplay().id === d.id
  return {
    id: d.id,
    label: d.label || (primary ? 'Main display' : `Display ${index + 1}`),
    primary,
    bounds: { ...d.bounds },
    workArea: { ...d.workArea },
    scaleFactor: d.scaleFactor
  }
}

export function listDisplays(): DisplayInfo[] {
  return screen.getAllDisplays().map(toDisplayInfo)
}

export function primaryDisplayId(): number {
  return screen.getPrimaryDisplay().id
}

/** Calls `cb` (debounced) whenever displays are added, removed, moved or rescaled. */
export function watchDisplays(cb: () => void): void {
  let t: NodeJS.Timeout | null = null
  const fire = (): void => {
    if (t) clearTimeout(t)
    t = setTimeout(cb, 250)
  }
  screen.on('display-added', fire)
  screen.on('display-removed', fire)
  screen.on('display-metrics-changed', fire)
}
