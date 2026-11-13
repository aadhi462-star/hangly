import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { SequenceName } from '../../shared/types'
import { Section, Slider, Toggle } from '../control/ui'
import { FrameThumb } from './ImportStep'
import { cloneCanvas } from './imageOps'
import { SEQUENCE_LABELS, newFrame, type StudioDoc } from './model'

interface Props {
  doc: StudioDoc
  onChange(): void
}

const NAMES = Object.keys(SEQUENCE_LABELS) as SequenceName[]

/** Stage 3: build animation sequences from the prepared frames on a timeline. */
export function AnimateStep({ doc, onChange }: Props): ReactNode {
  const [name, setName] = useState<SequenceName>('idle')
  const [playing, setPlaying] = useState(true)
  const [cursor, setCursor] = useState(0)
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const seq = doc.sequences[name]
  const ids = seq?.frameIds ?? []
  const frames = ids.map((id) => doc.frames.find((f) => f.id === id)).filter((f): f is NonNullable<typeof f> => !!f)

  // Playback clock for the preview, using each frame's own duration.
  const timer = useRef<number | null>(null)
  useEffect(() => {
    if (!playing || frames.length < 2) return
    const f = frames[Math.min(cursor, frames.length - 1)]
    timer.current = window.setTimeout(() => {
      const next = cursor + 1
      setCursor(next >= frames.length ? (seq?.loop ? 0 : frames.length - 1) : next)
      if (next >= frames.length && !seq?.loop) setPlaying(false)
    }, f?.duration ?? 100)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [playing, cursor, frames.length, seq?.loop, name])
  useEffect(() => setCursor(0), [name])

  const ensure = (): NonNullable<StudioDoc['sequences'][SequenceName]> => (doc.sequences[name] ??= { frameIds: [], loop: true })
  const mutate = (fn: (list: string[]) => void): void => {
    const s = ensure()
    fn(s.frameIds)
    onChange()
  }
  const current = frames[Math.min(cursor, Math.max(0, frames.length - 1))]
  const totalMs = frames.reduce((a, f) => a + f.duration, 0)

  return (
    <div className="studio-grid">
      <div className="col gap">
        <div className="seq-tabs">
          {NAMES.map((n) => (
            <button key={n} className={n === name ? 'on' : ''} onClick={() => setName(n)}>
              {SEQUENCE_LABELS[n]}
              <span className="count">{doc.sequences[n]?.frameIds.length ?? 0}</span>
            </button>
          ))}
        </div>

        <Section
          title={`${SEQUENCE_LABELS[name]} timeline`}
          description={frames.length ? `${frames.length} frames · ${(totalMs / 1000).toFixed(2)}s per loop` : 'Add frames from the pool below. Empty sequences fall back to Idle.'}
          actions={
            <div className="row gap">
              <button className="btn small" disabled={frames.length < 2} onClick={() => setPlaying(!playing)}>{playing ? '❚❚ Pause' : '▶ Play'}</button>
              <Toggle label="Loop" checked={seq?.loop ?? true} onChange={(loop) => { ensure().loop = loop; onChange() }} />
            </div>
          }
        >
          {frames.length > 1 && (
            <input
              type="range"
              min={0}
              max={frames.length - 1}
              value={Math.min(cursor, frames.length - 1)}
              style={{ ['--pct' as string]: `${(cursor / Math.max(1, frames.length - 1)) * 100}%`, width: '100%' }}
              onChange={(e) => {
                setPlaying(false)
                setCursor(Number(e.target.value))
              }}
              aria-label="Scrub frames"
            />
          )}
          <div className="frames">
            {frames.map((f, i) => (
              <div
                key={`${f.id}-${i}`}
                className={`frame${i === cursor ? ' playing' : ''}`}
                draggable
                onDragStart={() => setDragFrom(i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragFrom === null || dragFrom === i) return
                  mutate((list) => {
                    const [m] = list.splice(dragFrom, 1)
                    list.splice(i, 0, m)
                  })
                  setDragFrom(null)
                }}
                onClick={() => {
                  setPlaying(false)
                  setCursor(i)
                }}
              >
                <span className="idx">{i + 1}</span>
                <FrameThumb canvas={f.work} size={80} />
                <label className="row gap small" title="Frame duration">
                  <input
                    type="number"
                    min={16}
                    max={5000}
                    value={f.duration}
                    onChange={(e) => {
                      f.duration = Math.max(16, Math.min(5000, Number(e.target.value) || 100))
                      onChange()
                    }}
                  />
                  ms
                </label>
                <div className="frame-tools">
                  <button title="Move left" disabled={i === 0} onClick={(e) => { e.stopPropagation(); mutate((l) => { [l[i - 1], l[i]] = [l[i], l[i - 1]] }) }}>◀</button>
                  <button
                    title="Duplicate frame"
                    onClick={(e) => {
                      e.stopPropagation()
                      // A duplicated frame is a separate image so it can be edited independently.
                      const copy = newFrame(cloneCanvas(f.work), `${f.label} copy`, f.duration)
                      copy.source = cloneCanvas(f.source)
                      doc.frames.push(copy)
                      mutate((l) => l.splice(i + 1, 0, copy.id))
                    }}
                  >
                    ⧉
                  </button>
                  <button title="Remove from sequence" onClick={(e) => { e.stopPropagation(); mutate((l) => l.splice(i, 1)) }}>✕</button>
                  <button title="Move right" disabled={i === frames.length - 1} onClick={(e) => { e.stopPropagation(); mutate((l) => { [l[i + 1], l[i]] = [l[i], l[i + 1]] }) }}>▶</button>
                </div>
              </div>
            ))}
          </div>
          <div className="row gap wrap">
            <span className="muted small">Set every frame to</span>
            {[6, 8, 12, 24].map((fps) => (
              <button key={fps} className="btn small" disabled={!frames.length} onClick={() => { frames.forEach((f) => (f.duration = Math.round(1000 / fps))); onChange() }}>
                {fps} fps
              </button>
            ))}
          </div>
        </Section>

        <Section title="Frame pool" description="Click a frame to add it to the end of this sequence.">
          <div className="pool">
            {doc.frames.map((f, i) => (
              <button key={f.id} title={f.label} onClick={() => mutate((l) => l.push(f.id))}>
                <FrameThumb canvas={f.work} size={52} />
                <span className="small muted">{i + 1}</span>
              </button>
            ))}
          </div>
          {name !== 'idle' && (doc.sequences.idle?.frameIds.length ?? 0) > 0 && (
            <button className="btn small" style={{ marginTop: 8 }} onClick={() => mutate((l) => l.splice(0, l.length, ...doc.sequences.idle!.frameIds))}>
              Copy frames from Idle
            </button>
          )}
        </Section>
      </div>

      <aside className="studio-side">
        <Section title="Preview">
          <div className="anim-preview checker">{current ? <FrameThumb canvas={current.work} size={180} /> : <span className="muted small">No frames</span>}</div>
          {frames.length > 0 && (
            <Slider
              label="Speed (all)"
              value={Math.round(1000 / (totalMs / frames.length))}
              min={1}
              max={30}
              format={(v) => `${v} fps`}
              onChange={(fps) => { frames.forEach((f) => (f.duration = Math.round(1000 / fps))); onChange() }}
            />
          )}
        </Section>
        <div className="limit-note">
          <strong>About single images.</strong> One still picture can hang, swing, rotate, glide and bob convincingly, but it can’t produce real leg
          movement for walking or running. For that, import several frames (a GIF, a sprite sheet or numbered images) and put them in the Walking
          sequence.
          <br />
          <br />
          <strong>Not available yet:</strong> splitting a single image into body-part layers with bones (skeletal rigging) and AI-assisted
          segmentation. They are on the roadmap; nothing here pretends to do them.
        </div>
      </aside>
    </div>
  )
}
