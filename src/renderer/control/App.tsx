import { useEffect, useState, type ReactNode } from 'react'
import type { Page } from '../../shared/ipc'
import { Studio } from '../studio/Studio'
import { Active } from './pages/Active'
import { Customize } from './pages/Customize'
import { Home } from './pages/Home'
import { Library } from './pages/Library'
import { Presets } from './pages/Presets'
import { Settings } from './pages/Settings'
import { api, useUi } from './store'
import { Icon } from './ui'
import { Welcome } from './Welcome'

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

  if (!app) return <div className="boot">Loading Screenly…</div>

  return (
    <div className="shell">
      <nav className="sidebar">
        <div className="drag-region" />
        <div className="brand">
          <span className="brand-mark" aria-hidden>🐾</span>
          <span>Screenly</span>
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
        <StatusBanner />
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
      {!app.settings.onboarded && <Welcome />}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>
            {t.text}
            {t.action && (
              <button
                className="toast-action"
                onClick={() => {
                  t.action!.run()
                  useUi.setState((s) => ({ toasts: s.toasts.filter((x) => x.id !== t.id) }))
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

/** A clear notice whenever characters can't move on their own, with a one-click fix. */
function StatusBanner(): ReactNode {
  const s = useUi((st) => st.app?.settings)
  if (!s) return null
  const focus = s.focus.active
  if (!s.pausedAll && !focus && !s.hiddenAll) return null
  const text = s.hiddenAll
    ? 'All characters are hidden.'
    : focus
      ? 'Focus mode is on: characters are paused and quiet.'
      : 'All characters are paused. They stay still until you resume them.'
  return (
    <div className="status-banner" role="status">
      <span className="status-dot" aria-hidden />
      <span className="grow">{text}</span>
      <button
        className="btn small primary"
        onClick={() =>
          void api.updateSettings(s.hiddenAll ? { hiddenAll: false } : focus ? { focus: { active: false } } : { pausedAll: false })
        }
      >
        {s.hiddenAll ? 'Show all' : focus ? 'End focus' : 'Resume all'}
      </button>
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
