import { useState, type ReactNode } from 'react'
import { BEHAVIOUR_LABELS } from '../../shared/defaults'
import type { Behaviour } from '../../shared/types'
import { Section, Segmented, Slider, pct } from '../control/ui'
import { LivePreview, type Backdrop } from './LivePreview'
import type { StudioDoc } from './model'

interface Props {
  doc: StudioDoc
  pixels: number
  saving: boolean
  /** A copy of this character is already on the desktop. */
  onDesktop: boolean
  onSave(addToDesktop: boolean): void
}

/** Stage 5: try the character on a simulated desktop, then save it or put it on the real one. */
export function PreviewStep({ doc, pixels, saving, onDesktop, onSave }: Props): ReactNode {
  const [behaviour, setBehaviour] = useState<Behaviour>(doc.defaultBehaviour)
  const [scale, setScale] = useState(1)
  const [opacity, setOpacity] = useState(1)
  const [speed, setSpeed] = useState(1)
  const [animSpeed, setAnimSpeed] = useState(1)
  const [backdrop, setBackdrop] = useState<Backdrop>('light')
  const [resetKey, setResetKey] = useState(0)
  const b = doc.behaviours.includes(behaviour) ? behaviour : doc.behaviours[0]

  return (
    <div className="studio-grid">
      <div className="col gap">
        <LivePreview doc={doc} version={pixels} behaviour={b} scale={scale} opacity={opacity} speed={speed} animSpeed={animSpeed} backdrop={backdrop} resetKey={resetKey} />
        <p className="muted small">This is the real Screenly engine. Drag the character, click it, or rub the cursor over it to pet it.</p>
      </div>
      <aside className="studio-side">
        <Section title="Test">
          <Segmented label="Behaviour" value={b} options={doc.behaviours.map((x) => ({ value: x, label: BEHAVIOUR_LABELS[x] }))} onChange={setBehaviour} />
          <Slider label="Size" value={scale} min={0.1} max={2} step={0.01} format={pct} onChange={setScale} />
          <Slider label="Opacity" value={opacity} min={0.1} max={1} step={0.01} format={pct} onChange={setOpacity} />
          <Slider label="Movement speed" value={speed} min={0.1} max={3} step={0.05} format={(v) => `${v.toFixed(2)}×`} onChange={setSpeed} />
          <Slider label="Animation speed" value={animSpeed} min={0.1} max={4} step={0.05} format={(v) => `${v.toFixed(2)}×`} onChange={setAnimSpeed} />
          <Segmented
            label="Background"
            value={backdrop}
            options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'sunset', label: 'Sunset' }, { value: 'meadow', label: 'Meadow' }]}
            onChange={setBackdrop}
          />
          <button className="btn small" onClick={() => setResetKey((k) => k + 1)}>Reset position</button>
        </Section>
        <Section title={doc.editId ? 'Update character' : 'Finish'}>
          <p className="muted small">Size and speed here are only for testing; each copy on your desktop has its own settings.</p>
          <div className="col gap">
            <button className="btn" disabled={saving} onClick={() => onSave(false)}>{saving ? 'Saving…' : doc.editId ? 'Save changes' : 'Save character'}</button>
            <button className="btn primary" disabled={saving} onClick={() => onSave(true)}>
              {onDesktop ? 'Save and update on desktop' : 'Save and add to desktop'}
            </button>
          </div>
        </Section>
      </aside>
    </div>
  )
}
