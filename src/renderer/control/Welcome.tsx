import { useState, type ReactNode } from 'react'
import { api, run, useUi } from './store'
import { Thumb } from './ui'
import { findCharacter } from './store'

const STARTERS = ['cat', 'puppy', 'spider', 'bird']

/** Three-step first-run tour: add a character, move it, discover the right-click menu. */
export function Welcome(): ReactNode {
  const app = useUi((s) => s.app)!
  const [step, setStep] = useState(0)
  const [added, setAdded] = useState<string | null>(null)
  const done = (): void => void api.updateSettings({ onboarded: true })

  const steps = [
    {
      title: 'Welcome to Screenly',
      body: 'Characters that live on your screen: they walk along the Dock, hang from the top edge and stand on your windows. Pick one to start.',
      content: (
        <div className="welcome-picks">
          {STARTERS.map((id) => {
            const def = findCharacter(app, id)
            return (
              <button
                key={id}
                className={`welcome-pick${added === id ? ' on' : ''}`}
                onClick={async () => {
                  const r = await run(api.addInstance(id))
                  if (r) {
                    setAdded(id)
                    setStep(1)
                  }
                }}
              >
                <Thumb def={def} size={72} />
                <span>{def?.name.split(' ')[0]}</span>
              </button>
            )
          })}
        </div>
      )
    },
    {
      title: 'Move them anywhere',
      body: 'Drag a character on your desktop. Drop it on a window and it lands on top; drop it near the top edge and it hangs; drop it against a side and climbers start climbing.',
      content: <div className="welcome-art" aria-hidden>🖱️ → 🪟</div>
    },
    {
      title: 'Right-click for more',
      body: 'Right-click a character to feed it, pause it or customise it. The paw in the menu bar has everything else, and ⌘⌥H hides every character instantly.',
      content: <div className="welcome-art" aria-hidden>🐾 🍗 ⏸</div>
    }
  ]
  const s = steps[step]

  return (
    <div className="modal-backdrop">
      <div className="modal welcome" role="dialog" aria-label="Welcome">
        <div className="welcome-dots" aria-hidden>
          {steps.map((_, i) => <span key={i} className={i === step ? 'on' : ''} />)}
        </div>
        <h2>{s.title}</h2>
        <p className="muted">{s.body}</p>
        {s.content}
        <div className="row gap end">
          <button className="btn" onClick={done}>{step === steps.length - 1 ? 'Close' : 'Skip tour'}</button>
          {step > 0 && <button className="btn" onClick={() => setStep(step - 1)}>Back</button>}
          {step < steps.length - 1 ? (
            <button className="btn primary" onClick={() => setStep(step + 1)}>{step === 0 && !added ? 'Not now, next' : 'Next'}</button>
          ) : (
            <button className="btn primary" onClick={done}>Start using Screenly</button>
          )}
        </div>
      </div>
    </div>
  )
}
