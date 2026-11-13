import { BrowserWindow, app, globalShortcut, ipcMain, nativeTheme, shell, type IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import { BUILT_IN_CHARACTERS, DEFAULT_HANGING, newInstance } from '../shared/defaults'
import type { Align, DeepPartial, Page, Result, SaveCharacterRequest } from '../shared/ipc'
import type { CharacterInstance, HangingConfig, InstanceStatus, Settings } from '../shared/types'
import {
  deleteCustomCharacter,
  duplicateCustomCharacter,
  exportCharacter,
  handleAssetProtocol,
  importCharacter,
  readCharacterFile,
  registerAssetScheme,
  saveCustomCharacter
} from './asset-manager'
import { listDisplays, primaryDisplayId, watchDisplays } from './display-manager'
import { loadPage } from './load-page'
import { OverlayManager } from './overlay-manager'
import { registerShortcuts } from './shortcut-manager'
import { dataDir, mergeKnown, store } from './store'
import { TrayManager } from './tray-manager'

if (!app.requestSingleInstanceLock()) app.quit()

registerAssetScheme()

const overlays = new OverlayManager()
let control: BrowserWindow | null = null
let quitting = false
let shortcutErrors: Record<string, string> = {}
let focusFromSchedule = false
let lastStatus: InstanceStatus[] = []

const tray = new TrayManager({
  open: (page) => openControl(page),
  togglePause: () => updateSettings({ pausedAll: !store.state.settings.pausedAll }),
  toggleHidden: () => toggleHidden(),
  toggleFocus: () => updateSettings({ focus: { active: !store.state.settings.focus.active } }),
  toggleInteraction: () => updateSettings({ interactionEnabled: !store.state.settings.interactionEnabled }),
  quit: () => app.quit()
})

function toggleHidden(): void {
  const hide = !store.state.settings.hiddenAll
  if (hide) overlays.releaseAll()
  updateSettings({ hiddenAll: hide })
}

function openControl(page?: Page): void {
  if (!control || control.isDestroyed()) {
    control = new BrowserWindow({
      width: 1220,
      height: 820,
      minWidth: 960,
      minHeight: 640,
      show: false,
      title: 'ScreenPals',
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 18, y: 18 },
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1c1f' : '#f5f5f7',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    control.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    control.webContents.on('will-navigate', (e) => e.preventDefault())
    // Closing the panel hides it; the overlay keeps running from the menu bar.
    control.on('close', (e) => {
      if (!quitting) {
        e.preventDefault()
        control?.hide()
      }
    })
    control.once('ready-to-show', () => control?.show())
    void loadPage(control, 'control', page ? `page=${page}` : '')
  } else {
    control.show()
    control.focus()
    if (page) control.webContents.send('nav', page)
  }
}

function sendControl(channel: string, payload: unknown): void {
  if (control && !control.isDestroyed()) control.webContents.send(channel, payload)
}

// ---------- state changes ----------

function updateSettings(patch: DeepPartial<Settings>): void {
  const before = store.state.settings
  store.mutate((s) => {
    s.settings = mergeKnown(s.settings, patch)
    if (patch.profile) s.settings.activeProfileId = 'custom'
  })
  const after = store.state.settings
  if (JSON.stringify(before.shortcuts) !== JSON.stringify(after.shortcuts)) applyShortcuts()
  if (before.aboveFullScreen !== after.aboveFullScreen) overlays.applyLevelAll()
  if (before.showInDock !== after.showInDock) applyDock()
  if (before.launchAtLogin !== after.launchAtLogin) app.setLoginItemSettings({ openAtLogin: after.launchAtLogin })
  if (before.theme !== after.theme) nativeTheme.themeSource = after.theme
  if (!after.interactionEnabled) overlays.releaseAll()
}

function applyDock(): void {
  if (process.platform !== 'darwin') return
  if (store.state.settings.showInDock) void app.dock?.show()
  else app.dock?.hide()
}

function applyShortcuts(): void {
  shortcutErrors = registerShortcuts(store.state.settings.shortcuts, {
    togglePause: () => updateSettings({ pausedAll: !store.state.settings.pausedAll }),
    emergencyHide: () => toggleHidden(),
    openPanel: () => openControl(),
    toggleInteraction: () => updateSettings({ interactionEnabled: !store.state.settings.interactionEnabled })
  })
  sendControl('shortcut-errors', shortcutErrors)
}

function workArea(displayId: number): { width: number; height: number } {
  const d = listDisplays().find((x) => x.id === displayId) ?? listDisplays()[0]
  return { width: d.workArea.width, height: d.workArea.height }
}

function findDef(id: string) {
  return BUILT_IN_CHARACTERS.find((c) => c.id === id) ?? store.state.customCharacters.find((c) => c.id === id)
}

function instance(id: string): CharacterInstance | undefined {
  return store.state.instances.find((i) => i.instanceId === id)
}

function reposition(i: CharacterInstance, pos: { x?: number; y?: number; align?: Align; displayId?: number }): void {
  if (typeof pos.displayId === 'number' && listDisplays().some((d) => d.id === pos.displayId)) i.displayId = pos.displayId
  const wa = workArea(i.displayId)
  if (typeof pos.x === 'number') i.x = pos.x
  if (typeof pos.y === 'number') i.y = pos.y
  switch (pos.align) {
    case 'left': i.x = 60; break
    case 'right': i.x = wa.width - 60; break
    case 'center': i.x = wa.width / 2; i.y = wa.height / 2; break
    case 'top': i.y = 80; break
    case 'bottom': i.y = wa.height; break
    case 'default': i.x = wa.width * 0.5; i.y = wa.height; break
  }
  i.x = Math.max(0, Math.min(wa.width, i.x))
  i.y = Math.max(0, Math.min(wa.height, i.y))
  i.positionVersion++
}

function checkSchedule(): void {
  const { focus } = store.state.settings
  if (!focus.schedule.enabled) {
    if (focusFromSchedule) {
      focusFromSchedule = false
      updateSettings({ focus: { active: false } })
    }
    return
  }
  const now = new Date()
  const mins = now.getHours() * 60 + now.getMinutes()
  const toMins = (t: string): number => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
  const start = toMins(focus.schedule.start)
  const end = toMins(focus.schedule.end)
  const inside = start <= end ? mins >= start && mins < end : mins >= start || mins < end
  if (inside && !focus.active) {
    focusFromSchedule = true
    updateSettings({ focus: { active: true } })
  } else if (!inside && focusFromSchedule) {
    focusFromSchedule = false
    updateSettings({ focus: { active: false } })
  }
}

// ---------- IPC ----------

type Handler = (e: IpcMainInvokeEvent, ...args: never[]) => unknown

/** Panel-only handlers: overlays can render and report status but never mutate state. */
function handle(channel: string, fn: Handler): void {
  ipcMain.handle(channel, async (e, ...args) => {
    if (overlays.isOverlay(e.sender)) return { ok: false, error: 'Not allowed from overlay' }
    try {
      return await (fn as (e: IpcMainInvokeEvent, ...a: unknown[]) => unknown)(e, ...args)
    } catch (err) {
      console.error(`[ipc] ${channel}`, err)
      return { ok: false, error: (err as Error).message }
    }
  })
}

const ok = <T>(value?: T): Result<T> => ({ ok: true, value })
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

function registerIpc(): void {
  ipcMain.handle('state:get', () => store.state)
  ipcMain.handle('displays:get', () => listDisplays())
  handle('shortcuts:errors', () => shortcutErrors)

  handle('instance:add', (_e, characterId: string, displayId?: number) => {
    const def = findDef(str(characterId))
    if (!def) return { ok: false, error: 'Unknown character' }
    const max = store.state.settings.maxCharacters
    if (store.state.instances.length >= max) return { ok: false, error: `You can have up to ${max} characters at once. Raise the limit in Settings → Performance.` }
    const did = typeof displayId === 'number' && listDisplays().some((d) => d.id === displayId) ? displayId : primaryDisplayId()
    const wa = workArea(did)
    const inst = newInstance(def, did, wa.width)
    inst.y = def.defaultBehaviour === 'stationary' ? wa.height : inst.y
    store.mutate((s) => {
      s.instances.push(inst)
      s.recent = [def.id, ...s.recent.filter((r) => r !== def.id)].slice(0, 12)
      if (s.settings.hiddenAll) s.settings.hiddenAll = false
    })
    return ok(inst.instanceId)
  })

  handle('instance:update', (_e, id: string, patch: DeepPartial<CharacterInstance>) => {
    if (!instance(str(id))) return { ok: false, error: 'Not found' }
    store.mutate((s) => {
      s.instances = s.instances.map((i) => {
        if (i.instanceId !== id) return i
        const { instanceId: _a, characterId: _b, positionVersion: _c, ...safe } = patch ?? {}
        const next = mergeKnown(i, safe)
        if (next.behaviour !== i.behaviour) {
          const def = findDef(i.characterId)
          if (def && !def.behaviours.includes(next.behaviour)) next.behaviour = i.behaviour
          else next.positionVersion++
        }
        return next
      })
    })
    return ok()
  })

  handle('instance:remove', (_e, id: string) => {
    store.mutate((s) => void (s.instances = s.instances.filter((i) => i.instanceId !== id)))
    return ok()
  })

  handle('instance:duplicate', (_e, id: string) => {
    const src = instance(str(id))
    if (!src) return { ok: false, error: 'Not found' }
    if (store.state.instances.length >= store.state.settings.maxCharacters) return { ok: false, error: 'Character limit reached.' }
    const copy: CharacterInstance = {
      ...structuredClone(src),
      instanceId: `i_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      x: src.x + 80,
      positionVersion: src.positionVersion + 1,
      addedAt: Date.now()
    }
    store.mutate((s) => void s.instances.push(copy))
    return ok(copy.instanceId)
  })

  handle('instance:reposition', (_e, id: string, pos: { x?: number; y?: number; align?: Align; displayId?: number }) => {
    store.mutate((s) => {
      const i = s.instances.find((x) => x.instanceId === id)
      if (i) reposition(i, pos ?? {})
    })
    return ok()
  })

  handle('instance:reset', (_e, id: string) => {
    const i = instance(str(id))
    const def = i && findDef(i.characterId)
    if (!i || !def) return { ok: false, error: 'Not found' }
    const wa = workArea(i.displayId)
    const fresh = newInstance(def, i.displayId, wa.width)
    store.mutate((s) => {
      s.instances = s.instances.map((x) =>
        x.instanceId === id ? { ...fresh, instanceId: id, addedAt: x.addedAt, positionVersion: x.positionVersion + 1, y: wa.height } : x
      )
    })
    return ok()
  })

  handle('instance:clear', () => {
    store.mutate((s) => void (s.instances = []))
    return ok()
  })

  handle('settings:update', (_e, patch: DeepPartial<Settings>) => {
    updateSettings(patch ?? {})
    return ok()
  })

  handle('profile:apply', (_e, id: string) => {
    const p = store.state.profiles.find((x) => x.id === id)
    if (!p) return { ok: false, error: 'Not found' }
    store.mutate((s) => {
      s.settings.profile = { ...p.values }
      s.settings.activeProfileId = p.id
      s.settings.focus.active = !!p.focus
      if (p.pause !== undefined) s.settings.pausedAll = p.pause
      if (p.instances) s.instances = structuredClone(p.instances).map((i) => ({ ...i, positionVersion: i.positionVersion + 1 }))
    })
    return ok()
  })

  handle('profile:save', (_e, name: string, includeCharacters: boolean) => {
    const id = `p_${Date.now().toString(36)}`
    store.mutate((s) => {
      s.profiles.push({
        id,
        name: str(name).trim().slice(0, 40) || 'My profile',
        builtIn: false,
        description: includeCharacters ? `${s.instances.length} characters with their settings` : 'Custom movement settings',
        values: { ...s.settings.profile },
        instances: includeCharacters ? structuredClone(s.instances) : undefined,
        pause: s.settings.pausedAll
      })
      s.settings.activeProfileId = id
    })
    return ok(id)
  })

  handle('profile:rename', (_e, id: string, name: string) => {
    store.mutate((s) => {
      const p = s.profiles.find((x) => x.id === id && !x.builtIn)
      if (p && str(name).trim()) p.name = str(name).trim().slice(0, 40)
    })
    return ok()
  })

  handle('profile:duplicate', (_e, id: string) => {
    const p = store.state.profiles.find((x) => x.id === id)
    if (!p) return { ok: false, error: 'Not found' }
    const copyId = `p_${Date.now().toString(36)}`
    store.mutate((s) => void s.profiles.push({ ...structuredClone(p), id: copyId, name: `${p.name} copy`, builtIn: false }))
    return ok(copyId)
  })

  handle('profile:delete', (_e, id: string) => {
    store.mutate((s) => {
      s.profiles = s.profiles.filter((p) => p.builtIn || p.id !== id)
      if (s.settings.activeProfileId === id) s.settings.activeProfileId = 'custom'
    })
    return ok()
  })

  handle('character:save', (_e, req: SaveCharacterRequest) => saveCustomCharacter(req))
  handle('character:delete', (_e, id: string) => deleteCustomCharacter(str(id)))
  handle('character:duplicate', (_e, id: string) => duplicateCustomCharacter(str(id)))
  handle('character:export', (_e, id: string) => exportCharacter(str(id)))
  handle('character:import', () => importCharacter())
  handle('character:read', (_e, id: string, path: string) => readCharacterFile(str(id), str(path)))
  handle('character:hideBuiltIn', (_e, id: string, hidden: boolean) => {
    store.mutate((s) => {
      const set = new Set(s.settings.hiddenBuiltIns)
      if (hidden) set.add(str(id))
      else set.delete(str(id))
      s.settings.hiddenBuiltIns = [...set]
    })
    return ok()
  })

  handle('hanging:save', (_e, name: string, config: HangingConfig) => {
    const id = `h_${Date.now().toString(36)}`
    store.mutate((s) => {
      s.hangingPresets.push({
        id,
        name: str(name).slice(0, 40) || 'Hanging preset',
        config: mergeKnown(structuredClone(DEFAULT_HANGING), config)
      })
    })
    return ok(id)
  })
  handle('hanging:delete', (_e, id: string) => {
    store.mutate((s) => void (s.hangingPresets = s.hangingPresets.filter((h) => h.id !== id)))
    return ok()
  })

  handle('app:openData', () => shell.openPath(dataDir()))
  handle('app:quit', () => app.quit())

  // Overlay → main (fire-and-forget)
  ipcMain.on('overlay:interactive', (e, interactive: boolean) => overlays.setInteractive(e.sender, !!interactive))
  ipcMain.on('overlay:status', (e, status: InstanceStatus[]) => {
    if (!overlays.isOverlay(e.sender) || !Array.isArray(status)) return
    const byId = new Map(status.map((s) => [s.instanceId, s]))
    lastStatus = [...lastStatus.filter((s) => !byId.has(s.instanceId)), ...status].filter((s) =>
      store.state.instances.some((i) => i.instanceId === s.instanceId)
    )
    sendControl('status', lastStatus)
    // Persist live positions quietly so characters reappear where they were after restart.
    store.mutate((s) => {
      for (const i of s.instances) {
        const st = byId.get(i.instanceId)
        if (st && Number.isFinite(st.x) && Number.isFinite(st.y)) {
          i.x = Math.round(st.x)
          i.y = Math.round(st.y)
        }
      }
    }, false)
  })
  ipcMain.on('overlay:ready', (e) => {
    if (!overlays.isOverlay(e.sender)) return
    // The overlay subscribes only after its renderer is ready, so (re)send everything now.
    overlays.initFor(e.sender)
    e.sender.send('state', store.state)
  })
}

// ---------- lifecycle ----------

app.on('second-instance', () => openControl())
app.on('activate', () => openControl())
app.on('before-quit', () => {
  quitting = true
  store.flush()
})
// Stay alive in the menu bar when the panel closes.
app.on('window-all-closed', () => {})

void app.whenReady().then(() => {
  store.load()
  nativeTheme.themeSource = store.state.settings.theme
  handleAssetProtocol()
  registerIpc()
  applyDock()

  store.onChange((s) => {
    overlays.broadcast('state', s)
    overlays.applyVisibility()
    sendControl('state', s)
    tray.refresh()
  })

  overlays.syncDisplays()
  watchDisplays(() => {
    overlays.syncDisplays()
    const ids = new Set(listDisplays().map((d) => d.id))
    // Characters on a display that went away move to the main display.
    if (store.state.instances.some((i) => !ids.has(i.displayId))) {
      store.mutate((s) => {
        for (const i of s.instances) if (!ids.has(i.displayId)) reposition(i, { displayId: primaryDisplayId(), align: 'default' })
      })
    }
    sendControl('displays', listDisplays())
  })

  tray.create()
  applyShortcuts()
  setInterval(checkSchedule, 30_000)
  checkSchedule()
  openControl()
})

app.on('will-quit', () => globalShortcut.unregisterAll())
