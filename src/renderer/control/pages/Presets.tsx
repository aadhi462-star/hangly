import { useState, type ReactNode } from 'react'
import { api, ask, run, useUi } from '../store'
import { Icon, PageHeader, Section, Slider, Toggle } from '../ui'

export function Presets(): ReactNode {
  const app = useUi((s) => s.app)!
  const s = app.settings
  const [withChars, setWithChars] = useState(true)

  return (
    <div className="page">
      <PageHeader title="Presets" subtitle="Profiles change how lively every character is, all at once." />
      <div className="grid profiles">
        {app.profiles.map((p) => {
          const active = s.activeProfileId === p.id
          return (
            <article className={`card profile${active ? ' active' : ''}`} key={p.id}>
              <header className="row between">
                <h3>{p.name}</h3>
                {active && <span className="badge">Active</span>}
              </header>
              <p className="muted small">{p.description}</p>
              <dl className="kv">
                <dt>Size</dt><dd>{Math.round(p.values.scale * 100)}%</dd>
                <dt>Activity</dt><dd>{Math.round(p.values.activity * 100)}%</dd>
                <dt>Speed</dt><dd>{Math.round(p.values.speed * 100)}%</dd>
                <dt>Idle time</dt><dd>{p.values.idle.toFixed(1)}×</dd>
                {p.instances && (<><dt>Characters</dt><dd>{p.instances.length}</dd></>)}
                {p.focus && (<><dt>Focus</dt><dd>On</dd></>)}
              </dl>
              <div className="card-actions">
                <button className="btn primary small" disabled={active} onClick={() => void run(api.applyProfile(p.id), `${p.name} applied`)}>
                  {active ? 'Applied' : 'Apply'}
                </button>
                <button className="icon-btn" title="Duplicate" onClick={() => void run(api.duplicateProfile(p.id))}><Icon name="copy" /></button>
                {!p.builtIn && (
                  <>
                    <button
                      className="icon-btn"
                      title="Rename"
                      onClick={async () => {
                        const name = await ask('Rename profile', p.name)
                        if (name) void api.renameProfile(p.id, name)
                      }}
                    >
                      <Icon name="edit" />
                    </button>
                    <button className="icon-btn danger" title="Delete" onClick={() => confirm(`Delete the “${p.name}” profile?`) && void api.deleteProfile(p.id)}>
                      <Icon name="trash" />
                    </button>
                  </>
                )}
              </div>
            </article>
          )
        })}
      </div>

      <Section
        title="Custom"
        description="Tune the global multipliers yourself. They apply on top of each character’s own settings."
        actions={
          <div className="row gap">
            <Toggle label="Include current characters" checked={withChars} onChange={setWithChars} />
            <button
              className="btn"
              onClick={async () => {
                const name = await ask('Name this profile', 'My setup')
                if (name) void run(api.saveProfile(name, withChars), 'Profile saved')
              }}
            >
              Save as profile
            </button>
          </div>
        }
      >
        <Slider label="Size" value={s.profile.scale} min={0.3} max={2} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(scale) => api.updateSettings({ profile: { scale } })} />
        <Slider label="Activity" value={s.profile.activity} min={0} max={2} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(activity) => api.updateSettings({ profile: { activity } })} />
        <Slider label="Movement speed" value={s.profile.speed} min={0.2} max={3} step={0.01} format={(v) => `${v.toFixed(2)}×`} onChange={(speed) => api.updateSettings({ profile: { speed } })} />
        <Slider label="Idle time" value={s.profile.idle} min={0.2} max={5} step={0.05} format={(v) => `${v.toFixed(2)}×`} onChange={(idle) => api.updateSettings({ profile: { idle } })} />
      </Section>

      {app.hangingPresets.length > 0 && (
        <Section title="Hanging presets" description="Saved thread and swing settings. Apply them from a hanging character’s Customise panel or the Studio.">
          <div className="row gap wrap">
            {app.hangingPresets.map((h) => (
              <span className="chip-btn" key={h.id}>
                <span>{h.name} · {h.config.length}px · {h.config.amplitude}°</span>
                <button aria-label={`Delete ${h.name}`} onClick={() => void api.deleteHangingPreset(h.id)}>✕</button>
              </span>
            ))}
          </div>
        </Section>
      )}
    </div>
  )
}
