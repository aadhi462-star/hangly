import { useEffect, useRef, useState, type ReactNode } from 'react'
import { api, findCharacter, run, useUi } from '../control/store'
import { PageHeader } from '../control/ui'
import { releaseTextures } from '../engine/textures'
import { assetUrl } from '../../shared/ipc'
import { AnimateStep } from './AnimateStep'
import { BehaviourStep } from './BehaviourStep'
import { ImportStep } from './ImportStep'
import { PrepareStep } from './PrepareStep'
import { PreviewStep } from './PreviewStep'
import { buildSaveRequest, emptyDoc, loadDoc, type StudioDoc } from './model'

const STEPS = ['Import', 'Prepare', 'Animate', 'Configure behaviour', 'Preview and deploy'] as const

/**
 * Character Studio: image → desktop companion in five stages. The document is
 * mutable (canvases are edited in place); `version` is bumped to re-render.
 */
export function Studio(): ReactNode {
  const editId = useUi((s) => s.studioEdit)
  const app = useUi((s) => s.app)
  const docRef = useRef<StudioDoc>(emptyDoc())
  const [version, setVersion] = useState(0)
  // Separate counter for frame pixels/sequences so the live preview re-encodes only when needed.
  const [pixels, setPixels] = useState(0)
  const [step, setStep] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [loading, setLoading] = useState(!!editId)
  const [saving, setSaving] = useState(false)
  const doc = docRef.current
  const bump = (): void => setVersion((v) => v + 1)
  const bumpPixels = (): void => {
    bump()
    setPixels((v) => v + 1)
  }

  useEffect(() => {
    if (!editId) return
    const def = findCharacter(app, editId)
    if (!def) {
      setLoading(false)
      return
    }
    void loadDoc(def, async (path) => {
      const r = await api.readCharacterFile(def.id, path)
      return r.ok && r.value ? r.value : null
    }).then((d) => {
      docRef.current = d
      setSelected(d.frames[0]?.id ?? null)
      setLoading(false)
      setStep(1)
      bumpPixels()
    })
  }, [editId])

  async function save(addToDesktop: boolean): Promise<void> {
    setSaving(true)
    try {
      const req = await buildSaveRequest(doc)
      const id = await run(api.saveCustomCharacter(req))
      if (typeof id !== 'string') return
      if (doc.editId) releaseTextures(assetUrl(id, '').replace(/\/$/, ''))
      doc.editId = id
      // Saving again while tweaking must not stack another copy on the desktop:
      // copies already there pick up the new version automatically.
      const onDesktop = useUi.getState().app?.instances.some((i) => i.characterId === id)
      if (addToDesktop && !onDesktop) await run(api.addInstance(id), `${doc.name} is on your desktop`)
      else if (addToDesktop) useUi.getState().toast(`${doc.name} updated on your desktop`)
      else useUi.getState().toast(`${doc.name} saved to your library`)
      bump()
    } finally {
      setSaving(false)
    }
  }

  const hasFrames = doc.frames.length > 0
  const hasIdle = (doc.sequences.idle?.frameIds.length ?? 0) > 0
  const canEnter = (i: number): boolean => i === 0 || (i <= 2 ? hasFrames : hasIdle)

  if (loading) return <div className="page"><p className="muted">Loading character…</p></div>

  return (
    <div className="page wide">
      <PageHeader
        title="Character Studio"
        subtitle={doc.editId ? `Editing “${doc.name}”` : 'Turn your own images into desktop companions.'}
        actions={
          <>
            {hasFrames && (
              <button
                className="btn"
                onClick={() => {
                  if (!confirm('Start over? Unsaved changes in the Studio will be lost.')) return
                  docRef.current = emptyDoc()
                  useUi.setState({ studioEdit: null })
                  setSelected(null)
                  setStep(0)
                  bumpPixels()
                }}
              >
                Start over
              </button>
            )}
            {step < STEPS.length - 1 && (
              <button className="btn primary" disabled={!canEnter(step + 1)} onClick={() => setStep(step + 1)}>
                Next: {STEPS[step + 1]}
              </button>
            )}
          </>
        }
      />
      <nav className="stepper" aria-label="Studio steps">
        {STEPS.map((label, i) => (
          <button key={label} className={`${i === step ? 'on' : ''}${i < step ? ' done' : ''}`} disabled={!canEnter(i)} onClick={() => setStep(i)}>
            <span className="num">{i < step ? '✓' : i + 1}</span>
            {label}
          </button>
        ))}
      </nav>

      {step === 0 && <ImportStep doc={doc} selected={selected} onSelect={setSelected} onChange={bumpPixels} />}
      {step === 1 && <PrepareStep doc={doc} selected={selected} onSelect={setSelected} onChange={bumpPixels} />}
      {step === 2 && <AnimateStep doc={doc} onChange={bumpPixels} />}
      {step === 3 && <BehaviourStep doc={doc} version={version} pixels={pixels} onChange={bump} />}
      {step === 4 && (
        <PreviewStep
          doc={doc}
          pixels={pixels}
          saving={saving}
          onDesktop={!!doc.editId && !!app?.instances.some((i) => i.characterId === doc.editId)}
          onSave={(add) => void save(add)}
        />
      )}
    </div>
  )
}
