import { globalShortcut } from 'electron'
import type { Shortcuts } from '../shared/types'

export type ShortcutHandlers = Record<keyof Shortcuts, () => void>

/**
 * Registers the global shortcuts and reports any that could not be registered
 * (empty, malformed, duplicated, or already owned by another app).
 */
export function registerShortcuts(shortcuts: Shortcuts, handlers: ShortcutHandlers): Record<string, string> {
  globalShortcut.unregisterAll()
  const errors: Record<string, string> = {}
  const seen = new Map<string, string>()
  for (const key of Object.keys(handlers) as (keyof Shortcuts)[]) {
    const accel = shortcuts[key].trim()
    if (!accel) continue
    const norm = accel.toLowerCase()
    if (seen.has(norm)) {
      errors[key] = `Same shortcut as "${seen.get(norm)}".`
      continue
    }
    seen.set(norm, key)
    try {
      if (!globalShortcut.register(accel, handlers[key])) errors[key] = 'Already in use by another app or by macOS.'
    } catch {
      errors[key] = 'Not a valid shortcut.'
    }
  }
  return errors
}
