import type { ReactNode } from 'react'
import { STATE_LABELS } from '../../../shared/defaults'
import { allCharacters, api, findCharacter, run, useUi } from '../store'
import { Icon, Thumb } from '../ui'

export function Home(): ReactNode {
  const app = useUi((s) => s.app)!
  const status = useUi((s) => s.status)
  const { go, openStudio, edit } = useUi.getState()
  const s = app.settings
  const profile = app.profiles.find((p) => p.id === s.activeProfileId)
  const recent = app.recent.map((id) => findCharacter(app, id)).filter(Boolean).slice(0, 6)
  const suggestions = recent.length ? recent : allCharacters(app).slice(0, 6)
  const mode = s.focus.active ? 'Focus mode' : s.hiddenAll ? 'Hidden' : s.pausedAll ? 'Paused' : 'Running'

  return (
    <div className="page">
      <section className="hero">
        <div>
          <p className="eyebrow">Screenly</p>
          <h1>A little life on your desktop.</h1>
          <p className="muted">
            Put animals and your own characters on your screen. They walk along the Dock, hang from the menu bar and fly between your windows,
            and they never get in the way of your clicks.
          </p>
          <div className="row gap wrap">
            <button className="btn primary" onClick={() => go('library')}>
              <Icon name="plus" /> Add a character
            </button>
            <button className="btn" onClick={() => openStudio(null)}>
              <Icon name="studio" /> Make your own
            </button>
          </div>
        </div>
      </section>

      <div className="stats">
        <div className="stat">
          <span className="stat-num">{app.instances.length}</span>
          <span className="muted">on screen (max {s.maxCharacters})</span>
        </div>
        <div className="stat">
          <span className="stat-num small">{mode}</span>
          <span className="muted">Profile: {profile?.name ?? 'Custom'}</span>
        </div>
        <div className="stat actions">
          <button className="btn" onClick={() => api.updateSettings({ pausedAll: !s.pausedAll })}>
            <Icon name={s.pausedAll ? 'play' : 'pause'} /> {s.pausedAll ? 'Resume all' : 'Pause all'}
          </button>
          <button className="btn" onClick={() => api.updateSettings({ hiddenAll: !s.hiddenAll })}>
            <Icon name={s.hiddenAll ? 'eye' : 'eyeoff'} /> {s.hiddenAll ? 'Show all' : 'Hide all'}
          </button>
          <button className={`btn${s.focus.active ? ' primary' : ''}`} onClick={() => api.updateSettings({ focus: { active: !s.focus.active } })}>
            {s.focus.active ? 'End focus' : 'Focus mode'}
          </button>
        </div>
      </div>

      {app.instances.length > 0 && (
        <section className="section">
          <header className="section-head">
            <h3>On your desktop</h3>
            <button className="link" onClick={() => go('active')}>Manage all</button>
          </header>
          <div className="chips-row">
            {app.instances.map((i) => {
              const def = findCharacter(app, i.characterId)
              const st = status[i.instanceId]
              return (
                <button key={i.instanceId} className="mini-card" onClick={() => edit(i.instanceId)}>
                  <Thumb def={def} size={40} />
                  <span>
                    <strong>{def?.name ?? 'Missing character'}</strong>
                    <span className="muted small">{i.paused ? 'Paused' : i.hidden ? 'Hidden' : st ? STATE_LABELS[st.state] : '…'}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </section>
      )}

      <section className="section">
        <header className="section-head">
          <h3>{recent.length ? 'Recently used' : 'Start with one of these'}</h3>
          <button className="link" onClick={() => go('library')}>Open library</button>
        </header>
        <div className="grid small">
          {suggestions.map((def) => (
            <div className="card compact" key={def!.id}>
              <Thumb def={def} size={72} />
              <strong>{def!.name}</strong>
              <button className="btn small" onClick={() => void run(api.addInstance(def!.id), `${def!.name} is on your desktop`)}>
                Add to desktop
              </button>
            </div>
          ))}
        </div>
      </section>

      <p className="muted small tip">
        Tip: {s.shortcuts.emergencyHide.replace('CommandOrControl', '⌘').replace('Alt', '⌥')} hides every character instantly.
        Drag a character to move it, click it to say hello.
      </p>
    </div>
  )
}
