import { useEffect, useState, type ReactNode } from 'react'
import { BEHAVIOUR_LABELS, STATE_LABELS } from '../../../shared/defaults'
import { canEat, foodsFor } from '../../../shared/food'
import type { DeepPartial } from '../../../shared/ipc'
import type { Behaviour, CharacterInstance } from '../../../shared/types'
import { api, findCharacter, removeWithUndo, run, useUi } from '../store'
import { Icon, Segmented, Slider, Thumb, Toggle, pct } from '../ui'
import { HangingControls } from './HangingControls'
import { HangingPlace } from './HangingPlace'

type Tab = 'appearance' | 'movement' | 'position' | 'interaction' | 'hanging'

const SIZES = [
  { label: 'Tiny', value: 0.4 },
  { label: 'Small', value: 0.7 },
  { label: 'Medium', value: 1 },
  { label: 'Large', value: 1.5 }
]

/** Slide-over panel with every per-character control. Changes apply live. */
export function Customize({ instanceId }: { instanceId: string }): ReactNode {
  const app = useUi((s) => s.app)!
  const displays = useUi((s) => s.displays)
  const st = useUi((s) => s.status[instanceId])
  const close = (): void => useUi.getState().edit(null)
  const [tab, setTab] = useState<Tab>('appearance')
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const inst = app.instances.find((i) => i.instanceId === instanceId)
  const def = inst && findCharacter(app, inst.characterId)
  if (!inst || !def) return null

  const set = (patch: DeepPartial<CharacterInstance>): void => void api.updateInstance(instanceId, patch)
  const ap = inst.appearance
  const mv = inst.movement
  const it = inst.interaction
  const sizePreset = SIZES.find((s) => Math.abs(s.value - ap.scale) < 0.001)?.label ?? 'Custom'
  const tabs: { value: Tab; label: string }[] = [
    { value: 'appearance', label: 'Appearance' },
    { value: 'movement', label: 'Movement' },
    { value: 'position', label: 'Position' },
    { value: 'interaction', label: 'Interaction' }
  ]
  if (inst.behaviour === 'hang') tabs.push({ value: 'hanging', label: 'Hanging' })

  return (
    <div className="drawer-backdrop" onClick={close}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`Customise ${def.name}`}>
        <header className="drawer-head">
          <Thumb def={def} size={52} />
          <div className="grow">
            <h2>{def.name}</h2>
            <p className="muted small">
              {inst.paused ? 'Paused' : inst.hidden ? 'Hidden' : st ? STATE_LABELS[st.state] : 'Starting…'} · changes apply instantly
            </p>
          </div>
          <button className="icon-btn" onClick={close} aria-label="Close">✕</button>
        </header>

        <div className="drawer-quick">
          <Segmented<Behaviour>
            label="Behaviour"
            value={inst.behaviour}
            options={def.behaviours.map((b) => ({ value: b, label: BEHAVIOUR_LABELS[b] }))}
            onChange={(behaviour) => {
              set({ behaviour })
              if (tab === 'hanging' && behaviour !== 'hang') setTab('appearance')
            }}
          />
          <div className="row gap wrap">
            <button className="btn small" onClick={() => set({ paused: !inst.paused })}>
              <Icon name={inst.paused ? 'play' : 'pause'} /> {inst.paused ? 'Resume' : 'Pause'}
            </button>
            <button className="btn small" onClick={() => set({ hidden: !inst.hidden })}>
              <Icon name={inst.hidden ? 'eye' : 'eyeoff'} /> {inst.hidden ? 'Show' : 'Hide'}
            </button>
            <button className="btn small" onClick={() => void run(api.resetInstance(instanceId), 'Reset to defaults')}>
              <Icon name="reset" /> Reset
            </button>
            <button className="btn small" onClick={() => void run(api.duplicateInstance(instanceId), 'Duplicated')}>
              <Icon name="copy" /> Duplicate
            </button>
            <button className="btn small danger" onClick={() => { void removeWithUndo(instanceId); close() }}>
              <Icon name="trash" /> Remove
            </button>
          </div>
        </div>

        {canEat(def) && (
        <div className="feed-row">
          <span className="field-label">Feed</span>
          {foodsFor(def).map((f) => (
            <button key={f.id} className="food-btn" title={`Give ${f.name.toLowerCase()}`} onClick={() => void run(api.feed(instanceId, f.id))}>
              <span aria-hidden>{f.emoji}</span> {f.name}
            </button>
          ))}
          <span className="muted small">Tip: right-click it on the desktop for its food menu.</span>
        </div>
        )}

        <nav className="tabs">
          {tabs.map((t) => (
            <button key={t.value} className={tab === t.value ? 'on' : ''} onClick={() => setTab(t.value)}>{t.label}</button>
          ))}
        </nav>

        <div className="drawer-body">
          {tab === 'appearance' && (
            <>
              <Segmented
                label="Size"
                value={sizePreset}
                options={[...SIZES.map((s) => ({ value: s.label, label: s.label })), { value: 'Custom', label: 'Custom', disabled: true }]}
                onChange={(v) => set({ appearance: { scale: SIZES.find((s) => s.label === v)!.value } })}
              />
              <Slider label="Size" value={ap.scale} min={0.1} max={2} step={0.01} format={pct} onChange={(scale) => set({ appearance: { scale } })} />
              <Slider label="Opacity" value={ap.opacity} min={0.1} max={1} step={0.01} format={pct} onChange={(opacity) => set({ appearance: { opacity } })} />
              <Slider label="Rotation" value={ap.rotation} min={-180} max={180} format={(v) => `${v}°`} onChange={(rotation) => set({ appearance: { rotation } })} />
              <Slider label="Brightness" value={ap.brightness} min={0.3} max={1.7} step={0.01} format={pct} onChange={(brightness) => set({ appearance: { brightness } })} />
              <Slider label="Animation speed" value={mv.animSpeed} min={0.1} max={4} step={0.05} format={(v) => `${v.toFixed(2)}×`} onChange={(animSpeed) => set({ movement: { animSpeed } })} />
              <Toggle label="Flip horizontally" checked={ap.flipX} onChange={(flipX) => set({ appearance: { flipX } })} />
              <Toggle label="Flip vertically" hint="Useful for upside-down hanging art." checked={ap.flipY} onChange={(flipY) => set({ appearance: { flipY } })} />
              <Toggle label="Shadow" checked={ap.shadow} onChange={(shadow) => set({ appearance: { shadow } })} />
              <Slider label="Shadow intensity" disabled={!ap.shadow} value={ap.shadowIntensity} min={0} max={1} step={0.01} format={pct} onChange={(shadowIntensity) => set({ appearance: { shadowIntensity } })} />
            </>
          )}

          {tab === 'movement' && (
            <>
              <Toggle label="Automatic movement" hint="When off, the character stays put and only plays idle animations." checked={mv.autoMovement} onChange={(autoMovement) => set({ movement: { autoMovement } })} />
              <Toggle label="Random behaviour" hint="Mixes in idling, sitting, looking around and naps." checked={mv.randomMovement} onChange={(randomMovement) => set({ movement: { randomMovement } })} />
              <Toggle label="Follow mouse cursor" checked={mv.followCursor} onChange={(followCursor) => set({ movement: { followCursor } })} />
              <Toggle label="Fixed position" hint="Never moves from where you put it." checked={mv.fixedPosition} onChange={(fixedPosition) => set({ movement: { fixedPosition } })} />
              <Segmented
                label="Direction"
                value={mv.direction}
                options={[{ value: 'auto', label: 'Either way' }, { value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }]}
                onChange={(direction) => set({ movement: { direction } })}
              />
              <h4>Speeds</h4>
              {(inst.behaviour === 'walk') && (
                <>
                  <Slider label="Walking speed" value={mv.walkSpeed} min={0} max={300} format={(v) => `${v} px/s`} onChange={(walkSpeed) => set({ movement: { walkSpeed } })} />
                  <Slider label="Running speed" value={mv.runSpeed} min={0} max={700} format={(v) => `${v} px/s`} onChange={(runSpeed) => set({ movement: { runSpeed } })} />
                </>
              )}
              {inst.behaviour === 'climb' && (
                <Slider label="Climbing speed" value={mv.climbSpeed} min={0} max={300} format={(v) => `${v} px/s`} onChange={(climbSpeed) => set({ movement: { climbSpeed } })} />
              )}
              {inst.behaviour === 'fly' && (
                <Slider label="Flying speed" value={mv.flySpeed} min={0} max={600} format={(v) => `${v} px/s`} onChange={(flySpeed) => set({ movement: { flySpeed } })} />
              )}
              {inst.behaviour === 'hang' && (
                <>
                  <Slider label="Descent speed" value={inst.hanging.descentSpeed} min={5} max={400} format={(v) => `${v} px/s`} onChange={(descentSpeed) => set({ hanging: { descentSpeed } })} />
                  <Slider label="Ascent speed" value={inst.hanging.ascentSpeed} min={5} max={400} format={(v) => `${v} px/s`} onChange={(ascentSpeed) => set({ hanging: { ascentSpeed } })} />
                  <Slider label="Swing speed" value={inst.hanging.frequency} min={0.2} max={4} step={0.05} format={(v) => `${v.toFixed(2)}×`} onChange={(frequency) => set({ hanging: { frequency } })} />
                </>
              )}
              <Slider label="Animation speed" value={mv.animSpeed} min={0.1} max={4} step={0.05} format={(v) => `${v.toFixed(2)}×`} onChange={(animSpeed) => set({ movement: { animSpeed } })} />
              <h4>Rhythm</h4>
              <Slider label="Activity" value={mv.activity} min={0} max={1} step={0.01} format={pct} onChange={(activity) => set({ movement: { activity } })} />
              <Slider label="Idle duration" value={mv.idleSeconds} min={0.5} max={30} step={0.5} format={(v) => `${v}s`} onChange={(idleSeconds) => set({ movement: { idleSeconds } })} />
              {inst.behaviour === 'walk' && (
                <>
                  <h4>Walking area</h4>
                  <Slider label="From" value={mv.areaMin} min={0} max={0.9} step={0.01} format={pct} onChange={(areaMin) => set({ movement: { areaMin } })} />
                  <Slider label="To" value={mv.areaMax} min={0.1} max={1} step={0.01} format={pct} onChange={(areaMax) => set({ movement: { areaMax } })} />
                </>
              )}
            </>
          )}

          {tab === 'position' && (
            <>
              {inst.behaviour === 'hang' && <HangingPlace inst={inst} />}
              <p className="muted small">
                Current: x {Math.round(st?.x ?? inst.x)}, y {Math.round(st?.y ?? inst.y)} on{' '}
                {displays.find((d) => d.id === inst.displayId)?.label ?? 'display'}. You can also drag the character on screen.
              </p>
              <div className="align-grid">
                {(['top', 'left', 'center', 'right', 'bottom'] as const).map((a) => (
                  <button key={a} className={`btn small align-${a}`} onClick={() => void api.repositionInstance(instanceId, { align: a })}>
                    {a[0].toUpperCase() + a.slice(1)}
                  </button>
                ))}
              </div>
              <PositionInputs instanceId={instanceId} x={st?.x ?? inst.x} y={st?.y ?? inst.y} />
              <button className="btn small" onClick={() => void api.repositionInstance(instanceId, { align: 'default' })}>
                <Icon name="reset" /> Restore default position
              </button>
              {displays.length > 1 && (
                <label className="field">
                  <span className="field-label">Display</span>
                  <select value={inst.displayId} onChange={(e) => void api.repositionInstance(instanceId, { displayId: Number(e.target.value), align: 'default' })}>
                    {displays.map((d) => (
                      <option key={d.id} value={d.id}>{d.label}{d.primary ? ' (main)' : ''} — {d.bounds.width}×{d.bounds.height}</option>
                    ))}
                  </select>
                </label>
              )}
              <Toggle label="Lock position" hint="Prevents dragging." checked={it.locked} onChange={(locked) => set({ interaction: { locked } })} />
            </>
          )}

          {tab === 'interaction' && (
            <>
              <Toggle label="Click to interact" hint="Click for a reaction; rub the cursor over it to pet it." checked={it.clickToInteract} onChange={(clickToInteract) => set({ interaction: { clickToInteract } })} />
              <Toggle label="Drag to move" checked={it.draggable} onChange={(draggable) => set({ interaction: { draggable } })} />
              <Toggle label="Click-through" hint="The mouse passes straight through this character." checked={it.clickThrough} onChange={(clickThrough) => set({ interaction: { clickThrough } })} />
              <Toggle label="Mute this character" checked={inst.muted} onChange={(muted) => set({ muted })} />
              {!app.settings.interactionEnabled && <p className="notice">Interaction is switched off globally, so every character is click-through right now.</p>}
            </>
          )}

          {tab === 'hanging' && (
            <>
              <HangingPlace inst={inst} />
              <HangingControls value={inst.hanging} onChange={(hanging) => set({ hanging })} showAnchor />
            </>
          )}
        </div>
      </aside>
    </div>
  )
}

function PositionInputs({ instanceId, x, y }: { instanceId: string; x: number; y: number }): ReactNode {
  const [vx, setVx] = useState(String(Math.round(x)))
  const [vy, setVy] = useState(String(Math.round(y)))
  return (
    <form
      className="row gap"
      onSubmit={(e) => {
        e.preventDefault()
        void api.repositionInstance(instanceId, { x: Number(vx) || 0, y: Number(vy) || 0 })
      }}
    >
      <label className="field inline"><span className="field-label">X</span><input type="number" value={vx} onChange={(e) => setVx(e.target.value)} /></label>
      <label className="field inline"><span className="field-label">Y</span><input type="number" value={vy} onChange={(e) => setVy(e.target.value)} /></label>
      <button className="btn small" type="submit">Move</button>
    </form>
  )
}
