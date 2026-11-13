import type { ReactNode } from 'react'
import { BEHAVIOUR_LABELS, STATE_LABELS } from '../../../shared/defaults'
import { foodsFor } from '../../../shared/food'
import type { Behaviour } from '../../../shared/types'
import { api, findCharacter, run, useUi } from '../store'
import { Empty, Icon, PageHeader, Slider, Thumb, pct } from '../ui'
import { HangingPlace } from './HangingPlace'

export function Active(): ReactNode {
  const app = useUi((s) => s.app)!
  const status = useUi((s) => s.status)
  const displays = useUi((s) => s.displays)
  const { edit, go } = useUi.getState()
  const list = app.instances

  return (
    <div className="page">
      <PageHeader
        title="Active Characters"
        subtitle={`${list.length} of ${app.settings.maxCharacters} slots in use.`}
        actions={
          list.length > 0 && (
            <>
              <button className="btn" onClick={() => void run(api.feedAll(), 'Dinner time')}>Feed everyone</button>
              <button className="btn" onClick={() => api.updateSettings({ pausedAll: !app.settings.pausedAll })}>
                <Icon name={app.settings.pausedAll ? 'play' : 'pause'} /> {app.settings.pausedAll ? 'Resume all' : 'Pause all'}
              </button>
              <button
                className="btn danger"
                onClick={() => {
                  if (confirm('Remove every character from your desktop? Your library is not affected.')) void run(api.clearInstances(), 'Desktop cleared')
                }}
              >
                Remove all
              </button>
            </>
          )
        }
      />
      {list.length === 0 ? (
        <Empty
          title="Your desktop is empty"
          body="Add a character from the library and it will appear on your screen straight away."
          action={<button className="btn primary" onClick={() => go('library')}>Browse characters</button>}
        />
      ) : (
        <div className="table">
          {list.map((inst) => {
            const def = findCharacter(app, inst.characterId)
            const st = status[inst.instanceId]
            const display = displays.find((d) => d.id === inst.displayId)
            return (
              <div className={`table-row${inst.hidden ? ' dimmed' : ''}`} key={inst.instanceId}>
                <Thumb def={def} size={48} />
                <div className="cell-name">
                  <strong>{def?.name ?? 'Missing character'}</strong>
                  <span className="muted small">
                    {inst.paused || app.settings.pausedAll ? 'Paused' : inst.hidden ? 'Hidden' : st ? STATE_LABELS[st.state] : '…'}
                    {' · '}x {Math.round(st?.x ?? inst.x)}, y {Math.round(st?.y ?? inst.y)}
                    {displays.length > 1 && display ? ` · ${display.label}` : ''}
                  </span>
                </div>
                <select
                  className="cell-select"
                  value={inst.behaviour}
                  onChange={(e) => void api.updateInstance(inst.instanceId, { behaviour: e.target.value as Behaviour })}
                  aria-label="Behaviour"
                >
                  {(def?.behaviours ?? [inst.behaviour]).map((b) => (
                    <option key={b} value={b}>{BEHAVIOUR_LABELS[b]}</option>
                  ))}
                </select>
                <div className="cell-slider">
                  <Slider label="Size" value={inst.appearance.scale} min={0.1} max={2} step={0.01} format={pct} onChange={(scale) => void api.updateInstance(inst.instanceId, { appearance: { scale } })} />
                  <Slider label="Opacity" value={inst.appearance.opacity} min={0.1} max={1} step={0.01} format={pct} onChange={(opacity) => void api.updateInstance(inst.instanceId, { appearance: { opacity } })} />
                  {inst.behaviour === 'hang' && <HangingPlace inst={inst} compact />}
                </div>
                <div className="cell-actions">
                  {def && foodsFor(def)[0] && (
                    <button className="icon-btn food-icon" title={`Feed ${foodsFor(def)[0].name.toLowerCase()}`} onClick={() => void run(api.feed(inst.instanceId))}>
                      {foodsFor(def)[0].emoji}
                    </button>
                  )}
                  <button className="icon-btn" title={inst.paused ? 'Resume' : 'Pause'} onClick={() => void api.updateInstance(inst.instanceId, { paused: !inst.paused })}>
                    <Icon name={inst.paused ? 'play' : 'pause'} />
                  </button>
                  <button className="icon-btn" title={inst.hidden ? 'Show' : 'Hide'} onClick={() => void api.updateInstance(inst.instanceId, { hidden: !inst.hidden })}>
                    <Icon name={inst.hidden ? 'eye' : 'eyeoff'} />
                  </button>
                  <button className="icon-btn" title="Customise" onClick={() => edit(inst.instanceId)}><Icon name="edit" /></button>
                  <button className="icon-btn" title="Duplicate" onClick={() => void run(api.duplicateInstance(inst.instanceId))}><Icon name="copy" /></button>
                  <button className="icon-btn danger" title="Remove" onClick={() => void api.removeInstance(inst.instanceId)}><Icon name="trash" /></button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
