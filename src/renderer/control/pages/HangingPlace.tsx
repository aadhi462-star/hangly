import type { ReactNode } from 'react'
import type { CharacterInstance } from '../../../shared/types'
import { api, useUi } from '../store'
import { Segmented, Slider } from '../ui'

/** Where a hanging character hangs: across the screen, what it's tied to, and how far down. */
export function HangingPlace({ inst, compact }: { inst: CharacterInstance; compact?: boolean }): ReactNode {
  const displays = useUi((s) => s.displays)
  const live = useUi((s) => s.status[inst.instanceId])
  const width = displays.find((d) => d.id === inst.displayId)?.workArea.width ?? 1440
  const x = live?.x ?? inst.x
  const moveTo = (frac: number): void => void api.repositionInstance(inst.instanceId, { x: Math.round(frac * width) })

  if (compact) {
    return <Slider label="Position" value={Math.min(1, Math.max(0, x / width))} min={0} max={1} step={0.005} format={(v) => `${Math.round(v * 100)}%`} onChange={moveTo} />
  }
  return (
    <>
      <h4>Hanging place</h4>
      <Slider label="Across the screen" value={Math.min(1, Math.max(0, x / width))} min={0} max={1} step={0.005} format={(v) => `${Math.round(v * 100)}%`} onChange={moveTo} />
      <div className="row gap" style={{ margin: '2px 0 8px' }}>
        <button className="btn small" onClick={() => moveTo(0.06)}>Left</button>
        <button className="btn small" onClick={() => moveTo(0.5)}>Centre</button>
        <button className="btn small" onClick={() => moveTo(0.94)}>Right</button>
      </div>
      <Segmented
        label="Hang from"
        value={inst.hanging.anchorFrom}
        options={[
          { value: 'screen', label: 'Top of screen' },
          { value: 'menubar', label: 'Below menu bar' }
        ]}
        onChange={(anchorFrom) => void api.updateInstance(inst.instanceId, { hanging: { anchorFrom } })}
      />
      <Slider
        label="Thread length"
        value={inst.hanging.length}
        min={0}
        max={900}
        format={(v) => `${v}px`}
        onChange={(length) => void api.updateInstance(inst.instanceId, { hanging: { length } })}
      />
    </>
  )
}
