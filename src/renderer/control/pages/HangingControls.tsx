import type { ReactNode } from 'react'
import type { DeepPartial } from '../../../shared/ipc'
import type { HangingConfig } from '../../../shared/types'
import { api, ask, run, useUi } from '../store'
import { Slider, Toggle } from '../ui'

/** Thread / swing controls shared by the Customise drawer and the Studio hanging editor. */
export function HangingControls(props: {
  value: HangingConfig
  onChange: (patch: DeepPartial<HangingConfig>) => void
  /** The Studio sets the suspension point by clicking the image instead. */
  showAnchor?: boolean
}): ReactNode {
  const h = props.value
  const set = props.onChange
  const presets = useUi((s) => s.app?.hangingPresets ?? [])
  return (
    <>
      {props.showAnchor && (
        <>
          <Slider label="Suspension point X" value={h.attachX} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(attachX) => set({ attachX })} />
          <Slider label="Suspension point Y" value={h.attachY} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(attachY) => set({ attachY })} />
        </>
      )}
      <h4>Thread</h4>
      <Slider label="Thread length" value={h.length} min={0} max={900} format={(v) => `${v}px`} onChange={(length) => set({ length })} />
      <Slider label="Thickness" value={h.threadWidth} min={0} max={6} step={0.1} format={(v) => (v === 0 ? 'Hidden' : `${v.toFixed(1)}px`)} onChange={(threadWidth) => set({ threadWidth })} />
      <label className="field row-field">
        <span className="field-label">Colour</span>
        <input type="color" value={h.threadColor} onChange={(e) => set({ threadColor: e.target.value })} />
        <span className="muted small">{h.threadColor}</span>
      </label>
      <h4>Swing</h4>
      <Slider label="Swing amplitude" value={h.amplitude} min={0} max={70} format={(v) => `${v}°`} onChange={(amplitude) => set({ amplitude })} />
      <Slider label="Swing frequency" value={h.frequency} min={0.2} max={4} step={0.05} format={(v) => `${v.toFixed(2)}×`} onChange={(frequency) => set({ frequency })} />
      <Slider label="Damping" value={h.damping} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(damping) => set({ damping })} />
      <Slider label="Body rotation" value={h.rotation} min={-180} max={180} format={(v) => `${v}°`} onChange={(rotation) => set({ rotation })} />
      <Toggle label="Idle sway" hint="A gentle sway while hanging still." checked={h.idleSway} onChange={(idleSway) => set({ idleSway })} />
      <h4>Descend and return</h4>
      <Slider label="Descent distance" value={h.descentDistance} min={0} max={900} format={(v) => `${v}px`} onChange={(descentDistance) => set({ descentDistance })} />
      <Slider label="Descent speed" value={h.descentSpeed} min={5} max={400} format={(v) => `${v} px/s`} onChange={(descentSpeed) => set({ descentSpeed })} />
      <Slider label="Ascent speed" value={h.ascentSpeed} min={5} max={400} format={(v) => `${v} px/s`} onChange={(ascentSpeed) => set({ ascentSpeed })} />
      <Toggle label="Return to top" hint="Sometimes climbs all the way up to the top edge before coming back down." checked={h.returnToTop} onChange={(returnToTop) => set({ returnToTop })} />
      <h4>Presets</h4>
      <div className="row gap wrap">
        {presets.map((p) => (
          <span className="chip-btn" key={p.id}>
            <button onClick={() => set(p.config)}>{p.name}</button>
            <button aria-label={`Delete ${p.name}`} onClick={() => void api.deleteHangingPreset(p.id)}>✕</button>
          </span>
        ))}
        <button
          className="btn small"
          onClick={async () => {
            const name = await ask('Name this hanging preset', 'My hanging style')
            if (name) void run(api.saveHangingPreset(name, h), 'Hanging preset saved')
          }}
        >
          Save as preset
        </button>
      </div>
    </>
  )
}
