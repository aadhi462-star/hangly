import { useEffect, useRef, useState, type ReactNode } from 'react'
import { BEHAVIOUR_LABELS, BUILT_IN_CHARACTERS } from '../../../shared/defaults'
import type { CharacterCategory, CharacterDefinition } from '../../../shared/types'
import { allCharacters, api, run, useUi } from '../store'
import { Empty, Icon, PageHeader, Segmented, Thumb } from '../ui'

const CATS: { value: 'all' | CharacterCategory; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'walking', label: 'Walking' },
  { value: 'hanging', label: 'Hanging' },
  { value: 'flying', label: 'Flying' },
  { value: 'climbing', label: 'Climbing' },
  { value: 'custom', label: 'My characters' }
]

export function Library(): ReactNode {
  const app = useUi((s) => s.app)!
  const [cat, setCat] = useState<'all' | CharacterCategory>('all')
  const [q, setQ] = useState('')
  const [showHidden, setShowHidden] = useState(false)
  const search = useRef<HTMLInputElement>(null)
  useEffect(() => {
    // "/" jumps to search, like most apps with a list to filter.
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === '/' && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault()
        search.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const { openStudio, edit } = useUi.getState()

  const chars = allCharacters(app, showHidden).filter(
    (c) =>
      (cat === 'all' || c.category === cat || (cat === 'climbing' && c.behaviours.includes('climb'))) &&
      c.name.toLowerCase().includes(q.trim().toLowerCase())
  )
  const hiddenCount = app.settings.hiddenBuiltIns.length

  async function customise(def: CharacterDefinition): Promise<void> {
    const existing = app.instances.find((i) => i.characterId === def.id)
    if (existing) return edit(existing.instanceId)
    const id = await run(api.addInstance(def.id))
    if (typeof id === 'string') edit(id)
  }

  return (
    <div className="page">
      <PageHeader
        title="Character Library"
        subtitle={`${BUILT_IN_CHARACTERS.length} built-in characters and ${app.customCharacters.length} of your own.`}
        actions={
          <>
            <button className="btn" onClick={() => void run(api.importCharacter(), 'Character imported')}>
              <Icon name="import" /> Import
            </button>
            <button className="btn primary" onClick={() => openStudio(null)}>
              <Icon name="studio" /> New character
            </button>
          </>
        }
      />
      <div className="toolbar">
        <Segmented value={cat} options={CATS} onChange={setCat} />
        <input ref={search} className="search" placeholder="Search characters  /" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {chars.length === 0 ? (
        cat === 'custom' ? (
          <Empty
            title="No characters of your own yet"
            body="Open Character Studio to turn any image into a desktop companion: remove the background, crop it, choose how it moves."
            action={<button className="btn primary" onClick={() => openStudio(null)}>Open Character Studio</button>}
          />
        ) : (
          <Empty title="Nothing matches" body="Try another category or search term." />
        )
      ) : (
        <div className="grid">
          {chars.map((def) => {
            const hidden = app.settings.hiddenBuiltIns.includes(def.id)
            const count = app.instances.filter((i) => i.characterId === def.id).length
            return (
              <article className={`card char-card${hidden ? ' dimmed' : ''}`} key={def.id}>
                <div className={`char-art ${def.defaultBehaviour}`}>
                  {def.defaultBehaviour === 'hang' && (def.hanging?.threadWidth ?? 1) > 0 && <span className="art-thread" aria-hidden />}
                  <Thumb def={def} fill />
                  {count > 0 && <span className="badge">{count} active</span>}
                </div>
                <div className="char-meta">
                  <h3>{def.name}</h3>
                  <p className="muted small">{def.builtIn ? def.category[0].toUpperCase() + def.category.slice(1) : 'Custom character'}</p>
                  {def.description && <p className="small desc">{def.description}</p>}
                  <div className="chips">
                    {def.behaviours.map((b) => (
                      <span className="chip" key={b}>{BEHAVIOUR_LABELS[b]}</span>
                    ))}
                  </div>
                </div>
                <div className="card-actions">
                  <button className="btn primary small" onClick={() => void run(api.addInstance(def.id), `${def.name} is on your desktop`)}>
                    Add to desktop
                  </button>
                  <button className="btn small" onClick={() => void customise(def)}>Customise</button>
                  {def.builtIn ? (
                    <button className="icon-btn" title={hidden ? 'Show in library' : 'Hide from library'} onClick={() => void api.setBuiltInHidden(def.id, !hidden)}>
                      <Icon name={hidden ? 'eye' : 'eyeoff'} />
                    </button>
                  ) : (
                    <>
                      <button className="icon-btn" title="Edit in Studio" onClick={() => openStudio(def.id)}><Icon name="edit" /></button>
                      <button className="icon-btn" title="Duplicate" onClick={() => void run(api.duplicateCustomCharacter(def.id), 'Duplicated')}><Icon name="copy" /></button>
                      <button className="icon-btn" title="Export" onClick={() => void run(api.exportCharacter(def.id), 'Exported')}><Icon name="export" /></button>
                      <button
                        className="icon-btn danger"
                        title="Delete"
                        onClick={() => {
                          if (confirm(`Delete “${def.name}”? Its files will be removed from Screenly. This cannot be undone.`)) void run(api.deleteCustomCharacter(def.id), 'Deleted')
                        }}
                      >
                        <Icon name="trash" />
                      </button>
                    </>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}
      {hiddenCount > 0 && (
        <button className="link" onClick={() => setShowHidden(!showHidden)}>
          {showHidden ? 'Hide hidden characters' : `Show ${hiddenCount} hidden built-in character${hiddenCount > 1 ? 's' : ''}`}
        </button>
      )}
    </div>
  )
}
