import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Shortcuts } from '../../../shared/types'
import { api, useUi } from '../store'
import { PageHeader, Section, Segmented, Slider, Toggle } from '../ui'

const SHORTCUT_LABELS: Record<keyof Shortcuts, string> = {
  togglePause: 'Pause / resume all',
  emergencyHide: 'Emergency hide / show',
  openPanel: 'Open control panel',
  toggleInteraction: 'Toggle interaction mode'
}

export function Settings(): ReactNode {
  const app = useUi((s) => s.app)!
  const displays = useUi((s) => s.displays)
  const errors = useUi((s) => s.shortcutErrors)
  const s = app.settings
  const set = api.updateSettings

  return (
    <div className="page">
      <PageHeader title="Settings" />

      <Section title="Appearance">
        <Segmented
          label="Theme"
          value={s.theme}
          options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]}
          onChange={(theme) => set({ theme })}
        />
        <Slider label="Overlay opacity" value={s.globalOpacity} min={0.1} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(globalOpacity) => set({ globalOpacity })} />
      </Section>

      <Section title="Movement" description="Global multipliers. The Presets page has the full set.">
        <Toggle label="Pause all characters" checked={s.pausedAll} onChange={(pausedAll) => set({ pausedAll })} />
        <Slider label="Movement speed" value={s.profile.speed} min={0.2} max={3} step={0.01} format={(v) => `${v.toFixed(2)}×`} onChange={(speed) => set({ profile: { speed } })} />
        <Slider label="Activity" value={s.profile.activity} min={0} max={2} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(activity) => set({ profile: { activity } })} />
      </Section>

      <Section title="Interaction">
        <Toggle
          label="Allow interaction"
          hint="When off, every character is click-through and can’t be dragged or clicked."
          checked={s.interactionEnabled}
          onChange={(interactionEnabled) => set({ interactionEnabled })}
        />
        <Toggle label="Characters avoid each other" hint="Walkers head away from a neighbour instead of piling up." checked={s.avoidOverlap} onChange={(avoidOverlap) => set({ avoidOverlap })} />
        <Toggle
          label="Stand on app windows"
          hint="Characters land on, walk along and jump off the tops of your windows, and ride along when you move them. Screenly reads only window positions and sizes, never titles or contents."
          checked={s.standOnWindows}
          onChange={(standOnWindows) => set({ standOnWindows })}
        />
        <Toggle
          label="Adapt to where you drop them"
          hint="Drop near the top edge to hang, against a side to climb, anywhere else to stand on what's below."
          checked={s.adaptOnDrop}
          onChange={(adaptOnDrop) => set({ adaptOnDrop })}
        />
      </Section>

      <Section title="Display">
        <ul className="display-list">
          {displays.map((d) => (
            <li key={d.id}>
              <strong>{d.label}</strong>
              {d.primary && <span className="badge">Main</span>}
              <span className="muted small">
                {d.bounds.width}×{d.bounds.height} pt · {d.scaleFactor}× {d.scaleFactor > 1 ? '(Retina)' : ''} ·{' '}
                {app.instances.filter((i) => i.displayId === d.id).length} characters
              </span>
            </li>
          ))}
        </ul>
        <Toggle
          label="Show over full-screen apps"
          hint="Raises the overlay above full-screen windows and the menu bar. macOS may still hide it in some full-screen Spaces."
          checked={s.aboveFullScreen}
          onChange={(aboveFullScreen) => set({ aboveFullScreen })}
        />
      </Section>

      <Section title="Sound" description="Off by default. Sounds are short synthesised effects, played only when you interact or, optionally, now and then.">
        <Toggle label="Enable sound" checked={s.sound.enabled} onChange={(enabled) => set({ sound: { enabled } })} />
        <Slider label="Volume" disabled={!s.sound.enabled} value={s.sound.volume} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(volume) => set({ sound: { volume } })} />
        <Toggle label="Occasional idle sounds" disabled={!s.sound.enabled} hint="A purr or chirp every few minutes." checked={s.sound.idleSounds} onChange={(idleSounds) => set({ sound: { idleSounds } })} />
      </Section>

      <Section title="Focus mode" description="Pauses every character and silences sound. Nothing about what you are doing is monitored.">
        <Toggle label="Focus mode on" checked={s.focus.active} onChange={(active) => set({ focus: { active } })} />
        <Toggle label="Also hide characters during focus" checked={s.focus.hideCharacters} onChange={(hideCharacters) => set({ focus: { hideCharacters } })} />
        <Toggle label="Scheduled focus" hint="Turns focus on and off automatically every day." checked={s.focus.schedule.enabled} onChange={(enabled) => set({ focus: { schedule: { enabled } } })} />
        <div className="row gap">
          <label className="field inline">
            <span className="field-label">From</span>
            <input type="time" value={s.focus.schedule.start} disabled={!s.focus.schedule.enabled} onChange={(e) => set({ focus: { schedule: { start: e.target.value } } })} />
          </label>
          <label className="field inline">
            <span className="field-label">To</span>
            <input type="time" value={s.focus.schedule.end} disabled={!s.focus.schedule.enabled} onChange={(e) => set({ focus: { schedule: { end: e.target.value } } })} />
          </label>
        </div>
      </Section>

      <Section title="Performance">
        <Segmented
          label="Frame rate"
          value={String(s.fps)}
          options={[{ value: '30', label: '30 fps' }, { value: '45', label: '45 fps' }, { value: '60', label: '60 fps' }]}
          onChange={(v) => set({ fps: Number(v) as 30 | 45 | 60 })}
        />
        <Slider label="Maximum characters" value={s.maxCharacters} min={1} max={24} onChange={(maxCharacters) => set({ maxCharacters })} />
        <p className="muted small">Rendering stops completely when every character is paused or hidden.</p>
      </Section>

      <Section title="Keyboard shortcuts" description="Global shortcuts work from any app. Use names like CommandOrControl+Alt+P.">
        {(Object.keys(SHORTCUT_LABELS) as (keyof Shortcuts)[]).map((k) => (
          <ShortcutField key={k} label={SHORTCUT_LABELS[k]} value={s.shortcuts[k]} error={errors[k]} onSave={(v) => set({ shortcuts: { [k]: v } })} />
        ))}
      </Section>

      <Section title="General">
        <Toggle label="Show in Dock" hint="Screenly always stays in the menu bar." checked={s.showInDock} onChange={(showInDock) => set({ showInDock })} />
        <Toggle label="Open at login" checked={s.launchAtLogin} onChange={(launchAtLogin) => set({ launchAtLogin })} />
        <div className="row gap">
          <button className="btn" onClick={() => void api.openDataFolder()}>Open data folder</button>
          <button className="btn danger" onClick={() => void api.quit()}>Quit Screenly</button>
        </div>
      </Section>
    </div>
  )
}

function ShortcutField(props: { label: string; value: string; error?: string; onSave: (v: string) => void }): ReactNode {
  const [v, setV] = useState(props.value)
  const [recording, setRecording] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => setV(props.value), [props.value])

  return (
    <div className="shortcut">
      <span className="field-label">{props.label}</span>
      <input
        ref={input}
        className={props.error ? 'invalid' : ''}
        value={recording ? 'Press keys…' : v}
        readOnly={recording}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => {
          setRecording(false)
          if (v !== props.value) props.onSave(v)
        }}
        onKeyDown={(e) => {
          if (!recording) {
            if (e.key === 'Enter') props.onSave(v)
            return
          }
          e.preventDefault()
          if (['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) return
          const parts = [e.metaKey || e.ctrlKey ? 'CommandOrControl' : '', e.altKey ? 'Alt' : '', e.shiftKey ? 'Shift' : ''].filter(Boolean)
          const key = e.code.startsWith('Key') ? e.code.slice(3) : e.code.startsWith('Digit') ? e.code.slice(5) : e.key.length === 1 ? e.key.toUpperCase() : e.key
          const accel = [...parts, key].join('+')
          setV(accel)
          setRecording(false)
          props.onSave(accel)
        }}
      />
      <button
        className="btn small"
        onClick={() => {
          setRecording(true)
          input.current?.focus()
        }}
      >{recording ? 'Listening' : 'Record'}</button>
      <button className="btn small" onClick={() => props.onSave('')} title="Disable this shortcut">Clear</button>
      {props.error && <span className="error small">{props.error}</span>}
    </div>
  )
}
