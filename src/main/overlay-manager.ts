import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import type { OverlayInit } from '../shared/types'
import { listDisplays } from './display-manager'
import { loadPage } from './load-page'
import { store } from './store'

/**
 * One transparent, click-through, always-on-top window per display.
 *
 * Click-through: every overlay starts with setIgnoreMouseEvents(true). The
 * overlay renderer hit-tests the cursor (pushed from here) against its
 * characters and asks to become interactive only while the pointer is over
 * one, so the overlay never blocks normal desktop use.
 */
export class OverlayManager {
  private windows = new Map<number, BrowserWindow>()
  private interactive = new Set<number>()
  private cursorTimer: NodeJS.Timeout | null = null
  private lastCursor = { x: -1, y: -1 }

  syncDisplays(): void {
    const displays = listDisplays()
    const ids = new Set(displays.map((d) => d.id))
    for (const [id, win] of this.windows) {
      if (!ids.has(id)) {
        win.destroy()
        this.windows.delete(id)
        this.interactive.delete(id)
      }
    }
    for (const d of displays) {
      let win = this.windows.get(d.id)
      if (!win || win.isDestroyed()) {
        win = this.create(d.id)
        this.windows.set(d.id, win)
      }
      win.setBounds(d.bounds)
      this.sendInit(d.id)
    }
    this.applyVisibility()
  }

  private create(displayId: number): BrowserWindow {
    const s = store.state.settings
    const win = new BrowserWindow({
      show: false,
      transparent: true,
      backgroundColor: '#00000000',
      frame: false,
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: false,
      skipTaskbar: true,
      enableLargerThanScreen: true,
      roundedCorners: false,
      // NSPanel lets the overlay join full-screen Spaces when allowed.
      type: process.platform === 'darwin' ? 'panel' : undefined,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
        spellcheck: false,
        autoplayPolicy: 'no-user-gesture-required'
      }
    })
    win.setIgnoreMouseEvents(true, { forward: true })
    this.applyLevel(win, s.aboveFullScreen)
    win.webContents.on('did-finish-load', () => this.sendInit(displayId))
    // Never let an overlay navigate or open windows.
    win.webContents.on('will-navigate', (e) => e.preventDefault())
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    void loadPage(win, 'overlay', `display=${displayId}`)
    return win
  }

  private applyLevel(win: BrowserWindow, aboveFullScreen: boolean): void {
    win.setAlwaysOnTop(true, aboveFullScreen ? 'screen-saver' : 'floating')
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: aboveFullScreen, skipTransformProcessType: true })
  }

  applyLevelAll(): void {
    for (const w of this.windows.values()) this.applyLevel(w, store.state.settings.aboveFullScreen)
  }

  private sendInit(displayId: number): void {
    const win = this.windows.get(displayId)
    const display = listDisplays().find((d) => d.id === displayId)
    if (!win || win.isDestroyed() || !display) return
    const init: OverlayInit = { display, windowBounds: win.getBounds() }
    win.webContents.send('overlay:init', init)
  }

  /** Show or hide overlays according to settings; cursor polling runs only while shown. */
  applyVisibility(): void {
    const s = store.state.settings
    const hide = s.hiddenAll || (s.focus.active && s.focus.hideCharacters)
    for (const win of this.windows.values()) {
      if (hide) win.hide()
      else if (!win.isVisible()) win.showInactive()
    }
    if (hide) this.stopCursor()
    else this.startCursor()
  }

  setInteractive(sender: Electron.WebContents, interactive: boolean): void {
    for (const [id, win] of this.windows) {
      if (win.webContents !== sender) continue
      const allowed = interactive && store.state.settings.interactionEnabled
      if (allowed === this.interactive.has(id)) return
      if (allowed) this.interactive.add(id)
      else this.interactive.delete(id)
      win.setIgnoreMouseEvents(!allowed, { forward: true })
    }
  }

  /** Force every overlay back to click-through (emergency / interaction off). */
  releaseAll(): void {
    for (const [id, win] of this.windows) {
      win.setIgnoreMouseEvents(true, { forward: true })
      this.interactive.delete(id)
    }
  }

  /** Re-send display info to an overlay that has just finished starting up. */
  initFor(sender: Electron.WebContents): void {
    for (const [id, w] of this.windows) if (w.webContents === sender) this.sendInit(id)
  }

  isOverlay(sender: Electron.WebContents): boolean {
    for (const w of this.windows.values()) if (w.webContents === sender) return true
    return false
  }

  private startCursor(): void {
    if (this.cursorTimer) return
    this.cursorTimer = setInterval(() => {
      const p = screen.getCursorScreenPoint()
      if (p.x === this.lastCursor.x && p.y === this.lastCursor.y) return
      this.lastCursor = p
      for (const w of this.windows.values()) if (!w.isDestroyed()) w.webContents.send('overlay:cursor', p)
    }, 33)
  }

  private stopCursor(): void {
    if (this.cursorTimer) clearInterval(this.cursorTimer)
    this.cursorTimer = null
  }

  broadcast(channel: string, payload: unknown): void {
    for (const w of this.windows.values()) if (!w.isDestroyed()) w.webContents.send(channel, payload)
  }
}
