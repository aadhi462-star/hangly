import { useState, type ReactNode } from 'react'
import { BEHAVIOUR_LABELS } from '../../shared/defaults'
import type { Behaviour } from '../../shared/types'
import { HangingControls } from '../control/pages/HangingControls'
import { Section, Segmented, Slider } from '../control/ui'
import { ImageEditor } from './ImageEditor'
import { LivePreview } from './LivePreview'
import { behaviourSupport, type StudioDoc } from './model'

interface Props {
  doc: StudioDoc
  version: number
  pixels: number
  onChange(): void
}

const ALL: Behaviour[] = ['walk', 'hang', 'fly', 'climb', 'stationary']

/** Stage 4: choose behaviours, size and facing; the dedicated hanging editor lives here. */
export function BehaviourStep({ doc, version, pixels, onChange }: Props): ReactNode {
  const support = behaviourSupport(doc)
  const [hangOpen, setHangOpen] = useState(doc.behaviours.includes('hang'))
  const firstIdle = doc.frames.find((f) => f.id === doc.sequences.idle?.frameIds[0])
  const hangFrame = doc.frames.find((f) => f.id === doc.sequences.hang?.frameIds[0]) ?? firstIdle

  function toggle(b: Behaviour): void {
    const on = doc.behaviours.includes(b)
    if (on && doc.behaviours.length === 1) return
    doc.behaviours = on ? doc.behaviours.filter((x) => x !== b) : [...doc.behaviours, b]
    if (!doc.behaviours.includes(doc.defaultBehaviour)) doc.defaultBehaviour = doc.behaviours[0]
    if (b === 'hang' && !on) setHangOpen(true)
    onChange()
  }

  return (
    <div className="col gap">
      <Section title="Character">
        <label className="field">
          <span className="field-label">Name</span>
          <input value={doc.name} maxLength={60} onChange={(e) => { doc.name = e.target.value; onChange() }} />
        </label>
        <Slider label="Height on screen" value={doc.baseSize} min={24} max={480} format={(v) => `${v}px`} onChange={(v) => { doc.baseSize = v; onChange() }} />
        <Slider label="Default speed" value={doc.defaultSpeed} min={0} max={300} format={(v) => `${v} px/s`} onChange={(v) => { doc.defaultSpeed = v; onChange() }} />
        <Segmented
          label="The artwork faces"
          value={doc.facing}
          options={[{ value: 'left', label: '← Left' }, { value: 'right', label: 'Right →' }]}
          onChange={(facing) => { doc.facing = facing; onChange() }}
        />
      </Section>

      <Section title="Behaviours" description="Choose everything this character can do. Only behaviours your frames support are offered.">
        <div className="behaviour-grid">
          {ALL.map((b) => {
            const on = doc.behaviours.includes(b)
            return (
              <button key={b} className={`behaviour-opt${on ? ' on' : ''}`} disabled={!support[b].ok} onClick={() => toggle(b)} aria-pressed={on}>
                <strong>{on ? '✓ ' : ''}{BEHAVIOUR_LABELS[b]}</strong>
                <span className="muted">{support[b].note}</span>
              </button>
            )
          })}
        </div>
        <Segmented
          label="Starts as"
          value={doc.defaultBehaviour}
          options={doc.behaviours.map((b) => ({ value: b, label: BEHAVIOUR_LABELS[b] }))}
          onChange={(b) => { doc.defaultBehaviour = b; onChange() }}
        />
      </Section>

      {doc.behaviours.includes('hang') && hangFrame && (
        <Section
          title="Hanging editor"
          description="Click the image where the thread attaches, then tune the thread and swing. The preview is live."
          actions={<button className="link" onClick={() => setHangOpen(!hangOpen)}>{hangOpen ? 'Collapse' : 'Expand'}</button>}
        >
          {hangOpen && (
            <div className="studio-grid">
              <div className="col gap">
                <div>
                  <ImageEditor
                    height={300}
                    frame={hangFrame}
                    tool="anchor"
                    brush={10}
                    hardness={0.5}
                    version={version}
                    cropRect={null}
                    onCropRect={() => {}}
                    onStrokeStart={() => {}}
                    onStrokeEnd={() => {}}
                    anchor={{ x: doc.hanging.attachX, y: doc.hanging.attachY }}
                    onAnchor={(a) => {
                      doc.hanging = { ...doc.hanging, attachX: a.x, attachY: a.y }
                      onChange()
                    }}
                  />
                </div>
                <LivePreview
                  doc={doc}
                  version={pixels}
                  behaviour="hang"
                  scale={1}
                  opacity={1}
                  speed={1}
                  animSpeed={1}
                  backdrop="dark"
                  resetKey={0}
                  height={360}
                />
              </div>
              <div className="col">
                <HangingControls
                  value={doc.hanging}
                  showAnchor
                  onChange={(patch) => {
                    doc.hanging = { ...doc.hanging, ...patch }
                    onChange()
                  }}
                />
              </div>
            </div>
          )}
        </Section>
      )}
    </div>
  )
}
