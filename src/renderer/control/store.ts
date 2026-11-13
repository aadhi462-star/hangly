import { create } from 'zustand'
import { BUILT_IN_CHARACTERS } from '../../shared/defaults'
import { isHungry } from '../../shared/food'
import type { Page } from '../../shared/ipc'
import type { AppState, CharacterDefinition, DisplayInfo, InstanceStatus } from '../../shared/types'

interface Toast {
  id: number
  text: string
  tone: 'info' | 'error'
  action?: { label: string; run: () => void }
}

interface UiState {
  app: AppState | null
  displays: DisplayInfo[]
  status: Record<string, InstanceStatus>
  shortcutErrors: Record<string, string>
  page: Page
  editing: string | null
  /** Custom character id to open in the Studio, or null for a new one. */
  studioEdit: string | null
  studioKey: number
  toasts: Toast[]
  dialog: { title: string; value: string; resolve: (v: string | null) => void } | null
  go(page: Page): void
  edit(instanceId: string | null): void
  openStudio(characterId: string | null): void
  toast(text: string, tone?: Toast['tone'], action?: Toast['action']): void
}

let toastId = 0

export const useUi = create<UiState>((set) => ({
  app: null,
  displays: [],
  status: {},
  shortcutErrors: {},
  page: 'home',
  editing: null,
  studioEdit: null,
  studioKey: 0,
  toasts: [],
  dialog: null,
  go: (page) => set({ page }),
  edit: (editing) => set({ editing }),
  openStudio: (studioEdit) => set((s) => ({ studioEdit, page: 'studio', studioKey: s.studioKey + 1 })),
  toast: (text, tone = 'info', action) => {
    const id = ++toastId
    set((s) => ({ toasts: [...s.toasts, { id, text, tone, action }] }))
    // Toasts with an action (e.g. Undo) stay a little longer.
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), action ? 6500 : 3800)
  }
}))

export const api = window.screenly

/** Built-in + custom characters, minus built-ins the user hid. */
export function allCharacters(app: AppState | null, includeHidden = false): CharacterDefinition[] {
  if (!app) return []
  const hidden = new Set(app.settings.hiddenBuiltIns)
  return [...BUILT_IN_CHARACTERS.filter((c) => includeHidden || !hidden.has(c.id)), ...app.customCharacters]
}

export function findCharacter(app: AppState | null, id: string): CharacterDefinition | undefined {
  return BUILT_IN_CHARACTERS.find((c) => c.id === id) ?? app?.customCharacters.find((c) => c.id === id)
}

/** Run an API call and surface its error as a toast. */
export async function run<T>(p: Promise<{ ok: boolean; error?: string; value?: T }>, success?: string): Promise<T | undefined> {
  const r = await p
  if (!r.ok) {
    if (r.error !== 'cancelled') useUi.getState().toast(r.error ?? 'Something went wrong', 'error')
    return undefined
  }
  if (success) useUi.getState().toast(success)
  return r.value ?? (true as T)
}

export function bootstrap(): void {
  void api.getState().then((app) => useUi.setState({ app }))
  void api.getDisplays().then((displays) => useUi.setState({ displays }))
  void api.getShortcutErrors().then((shortcutErrors) => useUi.setState({ shortcutErrors }))
  api.onState((app) => useUi.setState({ app }))
  api.onDisplays((displays) => useUi.setState({ displays }))
  api.onShortcutErrors((shortcutErrors) => useUi.setState({ shortcutErrors }))
  api.onStatus((list) => useUi.setState({ status: Object.fromEntries(list.map((s) => [s.instanceId, s])) }))
  api.onNavigate((page) => useUi.setState({ page }))
  api.onEdit((editing) => useUi.setState({ editing }))
  const initial = new URLSearchParams(location.search).get('page') as Page | null
  if (initial) useUi.setState({ page: initial })
}

/** In-app replacement for window.prompt (which Electron does not support). */
export function ask(title: string, value = ''): Promise<string | null> {
  return new Promise((resolve) => useUi.setState({ dialog: { title, value, resolve } }))
}

/** Remove a character from the desktop, with an Undo in the toast. */
export async function removeWithUndo(instanceId: string): Promise<void> {
  const { app, toast } = useUi.getState()
  const inst = app?.instances.find((i) => i.instanceId === instanceId)
  if (!inst) return
  const name = findCharacter(app, inst.characterId)?.name ?? 'Character'
  await api.removeInstance(instanceId)
  toast(`${name} removed`, 'info', { label: 'Undo', run: () => void run(api.restoreInstance(inst)) })
}

/** "Fed 12 min ago" / "Hungry" for the Active Characters list. */
export function fedLabel(i: { lastFed?: number; addedAt: number }): string {
  if (isHungry(i)) return 'Hungry'
  if (!i.lastFed) return 'Not hungry yet'
  const m = Math.round((Date.now() - i.lastFed) / 60000)
  return m < 1 ? 'Just ate' : m < 60 ? `Fed ${m} min ago` : `Fed ${Math.round(m / 60)} h ago`
}
