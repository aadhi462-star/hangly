import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { ScreenlyApi } from '../shared/ipc'

// Only named, purpose-specific calls cross the bridge. The renderer never gets
// ipcRenderer, fs, or any generic "invoke anything" function.

function on<T>(channel: string, cb: (v: T) => void): () => void {
  const fn = (_e: IpcRendererEvent, v: T): void => cb(v)
  ipcRenderer.on(channel, fn)
  return () => ipcRenderer.removeListener(channel, fn)
}

const inv = ipcRenderer.invoke.bind(ipcRenderer)

const api: ScreenlyApi = {
  platform: process.platform,
  getState: () => inv('state:get'),
  getDisplays: () => inv('displays:get'),
  getShortcutErrors: () => inv('shortcuts:errors'),
  onState: (cb) => on('state', cb),
  onStatus: (cb) => on('status', cb),
  onDisplays: (cb) => on('displays', cb),
  onNavigate: (cb) => on('nav', cb),
  onShortcutErrors: (cb) => on('shortcut-errors', cb),

  addInstance: (id, displayId) => inv('instance:add', id, displayId),
  updateInstance: (id, patch) => inv('instance:update', id, patch),
  removeInstance: (id) => inv('instance:remove', id),
  duplicateInstance: (id) => inv('instance:duplicate', id),
  repositionInstance: (id, pos) => inv('instance:reposition', id, pos),
  resetInstance: (id) => inv('instance:reset', id),
  clearInstances: () => inv('instance:clear'),

  updateSettings: (patch) => inv('settings:update', patch),
  applyProfile: (id) => inv('profile:apply', id),
  saveProfile: (name, include) => inv('profile:save', name, include),
  renameProfile: (id, name) => inv('profile:rename', id, name),
  duplicateProfile: (id) => inv('profile:duplicate', id),
  deleteProfile: (id) => inv('profile:delete', id),

  saveCustomCharacter: (req) => inv('character:save', req),
  deleteCustomCharacter: (id) => inv('character:delete', id),
  duplicateCustomCharacter: (id) => inv('character:duplicate', id),
  exportCharacter: (id) => inv('character:export', id),
  importCharacter: () => inv('character:import'),
  readCharacterFile: (id, path) => inv('character:read', id, path),
  setBuiltInHidden: (id, hidden) => inv('character:hideBuiltIn', id, hidden),

  saveHangingPreset: (name, config) => inv('hanging:save', name, config),
  deleteHangingPreset: (id) => inv('hanging:delete', id),

  feed: (id, foodId) => inv('instance:feed', id, foodId),
  feedAll: () => inv('instance:feedAll'),

  openDataFolder: () => inv('app:openData'),
  quit: () => inv('app:quit'),

  overlay: {
    onInit: (cb) => on('overlay:init', cb),
    onCursor: (cb) => on('overlay:cursor', cb),
    onSurfaces: (cb) => on('overlay:surfaces', cb),
    onFeed: (cb) => on('overlay:feed', cb),
    adapt: (id, behaviour, x, y) => ipcRenderer.send('overlay:adapt', id, behaviour, x, y),
    setInteractive: (v) => ipcRenderer.send('overlay:interactive', v),
    reportStatus: (s) => ipcRenderer.send('overlay:status', s),
    ready: () => ipcRenderer.send('overlay:ready')
  }
}

contextBridge.exposeInMainWorld('screenly', api)
