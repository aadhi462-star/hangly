import { Menu, Tray, nativeImage, type NativeImage } from 'electron'
import type { Page } from '../shared/ipc'
import { store } from './store'

export interface TrayActions {
  open(page?: Page): void
  togglePause(): void
  toggleHidden(): void
  toggleFocus(): void
  toggleInteraction(): void
  feedAll(): void
  quit(): void
}

/** A paw print, rasterised at runtime so the app ships no binary icon for the tray. */
function pawIcon(): NativeImage {
  const size = 36 // 18pt @2x
  const buf = Buffer.alloc(size * size * 4)
  const pads: [number, number, number][] = [
    [18, 23, 7.2], // main pad
    [9.5, 14, 3.4],
    [15, 9, 3.4],
    [21, 9, 3.4],
    [26.5, 14, 3.4]
  ]
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let cover = 0
      // 4x supersampling for smooth edges
      for (let sy = 0; sy < 4; sy++) {
        for (let sx = 0; sx < 4; sx++) {
          const px = x + (sx + 0.5) / 4
          const py = y + (sy + 0.5) / 4
          if (pads.some(([cx, cy, r], i) => (i === 0 ? ((px - cx) / r) ** 2 + ((py - cy) / (r * 0.82)) ** 2 : ((px - cx) / r) ** 2 + ((py - cy) / (r * 1.2)) ** 2) <= 1)) cover++
        }
      }
      const o = (y * size + x) * 4
      buf[o + 3] = Math.round((cover / 16) * 255) // BGRA, black with alpha
    }
  }
  const img = nativeImage.createFromBitmap(buf, { width: size, height: size, scaleFactor: 2 })
  img.setTemplateImage(true)
  return img
}

export class TrayManager {
  private tray: Tray | null = null

  constructor(private actions: TrayActions) {}

  create(): void {
    this.tray = new Tray(pawIcon())
    this.tray.setToolTip('Screenly')
    this.refresh()
  }

  refresh(): void {
    if (!this.tray) return
    const s = store.state.settings
    const count = store.state.instances.length
    const a = this.actions
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: `Screenly — ${count} active`, enabled: false },
        { type: 'separator' },
        { label: 'Open Screenly', accelerator: s.shortcuts.openPanel, click: () => a.open() },
        { label: 'Open Character Studio', click: () => a.open('studio') },
        { label: 'Settings…', click: () => a.open('settings') },
        { type: 'separator' },
        { label: s.pausedAll ? 'Resume all' : 'Pause all', accelerator: s.shortcuts.togglePause, click: () => a.togglePause() },
        { label: s.hiddenAll ? 'Show all' : 'Hide all', accelerator: s.shortcuts.emergencyHide, click: () => a.toggleHidden() },
        { label: 'Feed everyone', enabled: count > 0, click: () => a.feedAll() },
        { label: 'Focus mode', type: 'checkbox', checked: s.focus.active, click: () => a.toggleFocus() },
        {
          label: 'Allow interaction (drag / click)',
          type: 'checkbox',
          checked: s.interactionEnabled,
          accelerator: s.shortcuts.toggleInteraction,
          click: () => a.toggleInteraction()
        },
        { type: 'separator' },
        { label: 'Quit Screenly', role: undefined, click: () => a.quit() }
      ])
    )
  }
}
