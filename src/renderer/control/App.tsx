import { useEffect, useState, type ReactNode } from 'react'
import type { Page } from '../../shared/ipc'
import { Studio } from '../studio/Studio'
import { Active } from './pages/Active'
import { Customize } from './pages/Customize'
import { Home } from './pages/Home'
import { Library } from './pages/Library'
import { Presets } from './pages/Presets'
import { Settings } from './pages/Settings'
import { useUi } from './store'
import { Icon } from './ui'

const NAV: { page: Page; label: string; icon: Parameters<typeof Icon>[0]['name'] }[] = [
  { page: 'home', label: 'Home', icon: 'home' },
  { page: 'library', label: 'Character Library', icon: 'library' },
  { page: 'studio', label: 'Character Studio', icon: 'studio' },
  { page: 'active', label: 'Active Characters', icon: 'active' },
  { page: 'presets', label: 'Presets', icon: 'presets' },
  { page: 'settings', label: 'Settings', icon: 'settings' }
]

export function App(): ReactNode {
  const app = useUi((s) => s.app)
  const page = useUi((s) => s.page)
  const editing = useUi((s) => s.editing)
  const studioKey = useUi((s) => s.studioKey)
  const toasts = useUi((s) => s.toasts)

  useEffect(() => {
    if (!app) return
    const t = app.settings.theme
    if (t === 'system') delete document.documentElement.dataset.theme
    else document.documentElement.dataset.theme = t
  }, [app?.settings.theme])

  if (!app) return <div className="boot">Loading ScreenPals…</div>

  return (
    <div className="shell">
      <nav className="sidebar">
        <div className="drag-region" />
        <div className="brand">
          <span className="brand-mark" aria-hidden>🐾</span>
          <span>ScreenPals</span>
        </div>
        {NAV.map((n) => (
          <button key={n.page} className={`nav-item${page === n.page ? ' on' : ''}`} onClick={() => useUi.getState().go(n.page)}>
            <Icon name={n.icon} />
            <span>{n.label}</span>
            {n.page === 'active' && app.instances.length > 0 && <span className="nav-count">{app.instances.length}</span>}
          </button>
        ))}
        <div className="sidebar-foot">
          {app.settings.focus.active && <span className="pill">Focus mode</span>}
          {app.settings.pausedAll && <span className="pill">Paused</span>}
          {app.settings.hiddenAll && <span className="pill">Hidden</span>}
          {!app.settings.interactionEnabled && <span className="pill">Click-through</span>}
        </div>
      </nav>
      <main className="content">
        <div className="drag-region" />
        {page === 'home' && <Home />}
        {page === 'library' && <Library />}
        {/* The Studio stays mounted so switching pages never loses unsaved work. */}
        <div hidden={page !== 'studio'}>
          <Studio key={studioKey} />
        </div>
        {page === 'active' && <Active />}
        {page === 'presets' && <Presets />}
        {page === 'settings' && <Settings />}
      </main>
      {editing && <Customize instanceId={editing} />}
      <TextDialog />
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>{t.text}</div>
        ))}
      </div>
    </div>
  )
}

function TextDialog(): ReactNode {
  const dialog = useUi((s) => s.dialog)
  const [v, setV] = useState('')
  useEffect(() => setV(dialog?.value ?? ''), [dialog])
  if (!dialog) return null
  const done = (value: string | null): void => {
    dialog.resolve(value?.trim() ? value.trim() : null)
    useUi.setState({ dialog: null })
  }
  return (
    <div className="modal-backdrop" onClick={() => done(null)}>
      <form
        className="modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          done(v)
        }}
      >
        <h3>{dialog.title}</h3>
        <input autoFocus value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && done(null)} />
        <div className="row gap end">
          <button type="button" className="btn" onClick={() => done(null)}>Cancel</button>
          <button type="submit" className="btn primary">Save</button>
        </div>
      </form>
    </div>
  )
}
