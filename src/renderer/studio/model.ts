import { DEFAULT_HANGING } from '../../shared/defaults'
import type { SaveCharacterRequest } from '../../shared/ipc'
import type { Behaviour, CharacterDefinition, HangingConfig, SequenceName } from '../../shared/types'
import { blobToImage, canvasToPng, cloneCanvas, makeCanvas, toCanvas } from './imageOps'

export interface StudioFrame {
  id: string
  label: string
  /** The edited image. */
  work: HTMLCanvasElement
  /** Unedited pixels at the same geometry as `work`; the restore brush copies from here. */
  source: HTMLCanvasElement
  /** The file as imported, saved untouched under original/. */
  original?: { bytes: Uint8Array; ext: string }
  duration: number
  history: { undo: Snapshot[]; redo: Snapshot[]; initial: Snapshot }
}

interface Snapshot {
  work: HTMLCanvasElement
  source: HTMLCanvasElement
}

export interface SequenceDraft {
  frameIds: string[]
  loop: boolean
}

export interface StudioDoc {
  editId: string | null
  name: string
  frames: StudioFrame[]
  sequences: Partial<Record<SequenceName, SequenceDraft>>
  behaviours: Behaviour[]
  defaultBehaviour: Behaviour
  baseSize: number
  defaultSpeed: number
  facing: 'left' | 'right'
  hanging: HangingConfig
  createdAt?: number
}

export const SEQUENCE_LABELS: Record<SequenceName, string> = {
  idle: 'Idle',
  walk: 'Walking',
  run: 'Running',
  hang: 'Hanging',
  fly: 'Flying',
  climb: 'Climbing',
  sleep: 'Sleeping',
  interact: 'Interacting'
}

const HISTORY_LIMIT = 12
let seq = 0
export const uid = (): string => `f${Date.now().toString(36)}${(seq++).toString(36)}`

export function emptyDoc(): StudioDoc {
  return {
    editId: null,
    name: 'My character',
    frames: [],
    sequences: {},
    behaviours: ['walk', 'stationary'],
    defaultBehaviour: 'walk',
    baseSize: 120,
    defaultSpeed: 60,
    facing: 'right',
    hanging: { ...DEFAULT_HANGING, attachY: 0.02 }
  }
}

export function newFrame(canvas: HTMLCanvasElement, label: string, duration = 120, original?: StudioFrame['original']): StudioFrame {
  const work = canvas
  const source = cloneCanvas(canvas)
  return {
    id: uid(),
    label,
    work,
    source,
    original,
    duration,
    history: { undo: [], redo: [], initial: { work: cloneCanvas(work), source: cloneCanvas(source) } }
  }
}

/** Call before any edit; `geometry` edits (crop/rotate/resize) also snapshot the source. */
export function pushHistory(f: StudioFrame): void {
  f.history.undo.push({ work: cloneCanvas(f.work), source: f.source })
  if (f.history.undo.length > HISTORY_LIMIT) f.history.undo.shift()
  f.history.redo = []
}

export function undo(f: StudioFrame): boolean {
  const s = f.history.undo.pop()
  if (!s) return false
  f.history.redo.push({ work: f.work, source: f.source })
  f.work = s.work
  f.source = s.source
  return true
}

export function redo(f: StudioFrame): boolean {
  const s = f.history.redo.pop()
  if (!s) return false
  f.history.undo.push({ work: f.work, source: f.source })
  f.work = s.work
  f.source = s.source
  return true
}

export function resetFrame(f: StudioFrame): void {
  pushHistory(f)
  f.work = cloneCanvas(f.history.initial.work)
  f.source = cloneCanvas(f.history.initial.source)
}

/** Replace a frame's working image with a geometry-changed version of both work and source. */
export function applyGeometry(f: StudioFrame, op: (c: HTMLCanvasElement) => HTMLCanvasElement): void {
  pushHistory(f)
  f.work = op(f.work)
  f.source = op(f.source)
}

/** Which behaviours a document can honestly support, and why. */
export function behaviourSupport(doc: StudioDoc): Record<Behaviour, { ok: boolean; note: string }> {
  const n = (name: SequenceName): number => doc.sequences[name]?.frameIds.length ?? 0
  const idle = n('idle')
  const motion = (seqName: SequenceName, verb: string): string =>
    n(seqName) > 1 ? `Uses your ${n(seqName)}-frame ${verb} animation.` : `Single image: moves with a procedural ${verb === 'walking' ? 'bob and tilt' : 'motion'}, no leg animation.`
  return {
    walk: { ok: idle > 0, note: motion('walk', 'walking') },
    hang: { ok: idle > 0, note: 'Suspension, swinging and rotation work with any image.' },
    fly: { ok: idle > 0, note: n('fly') > 1 ? `Uses your ${n('fly')}-frame flying animation.` : 'Glides with a gentle bob. Add flying frames for wing beats.' },
    climb: { ok: idle > 0, note: motion('climb', 'climbing') },
    stationary: { ok: idle > 0, note: 'Stays in place with a breathing idle.' }
  }
}

/** Encode the document into files + a definition for the main process. */
export async function buildSaveRequest(doc: StudioDoc): Promise<SaveCharacterRequest> {
  const files: Record<string, Uint8Array> = {}
  const fileFor = new Map<string, string>()
  let i = 0
  for (const f of doc.frames) {
    const used = Object.values(doc.sequences).some((s) => s?.frameIds.includes(f.id))
    if (!used) continue
    const path = `processed/frame-${i++}-${f.id}.png`
    files[path] = await canvasToPng(f.work)
    fileFor.set(f.id, path)
    if (f.original) files[`original/${f.id}.${f.original.ext}`] = f.original.bytes
  }
  const animations: CharacterDefinition['animations'] = {}
  for (const [name, s] of Object.entries(doc.sequences) as [SequenceName, SequenceDraft | undefined][]) {
    if (!s || s.frameIds.length === 0) continue
    animations[name] = {
      loop: s.loop,
      frames: s.frameIds
        .map((id) => {
          const f = doc.frames.find((x) => x.id === id)
          const file = fileFor.get(id)
          return f && file ? { file, duration: f.duration } : null
        })
        .filter((x): x is { file: string; duration: number } => !!x)
    }
  }
  const preview = animations.idle?.frames[0]?.file
  return {
    definition: {
      id: doc.editId ?? '',
      name: doc.name,
      category: 'custom',
      builtIn: false,
      kind: 'image',
      behaviours: doc.behaviours,
      defaultBehaviour: doc.behaviours.includes(doc.defaultBehaviour) ? doc.defaultBehaviour : doc.behaviours[0],
      baseSize: doc.baseSize,
      defaultOpacity: 1,
      defaultSpeed: doc.defaultSpeed,
      facing: doc.facing,
      animations,
      hanging: doc.hanging,
      preview,
      createdAt: doc.createdAt
    },
    files
  }
}

/** Load a saved custom character back into an editable document. */
export async function loadDoc(def: CharacterDefinition, read: (path: string) => Promise<Uint8Array | null>): Promise<StudioDoc> {
  const doc: StudioDoc = {
    ...emptyDoc(),
    editId: def.id,
    name: def.name,
    behaviours: def.behaviours,
    defaultBehaviour: def.defaultBehaviour,
    baseSize: def.baseSize,
    defaultSpeed: def.defaultSpeed,
    facing: def.facing,
    hanging: { ...DEFAULT_HANGING, ...def.hanging },
    createdAt: def.createdAt
  }
  const byFile = new Map<string, StudioFrame>()
  for (const [name, s] of Object.entries(def.animations ?? {}) as [SequenceName, NonNullable<CharacterDefinition['animations']>[SequenceName]][]) {
    if (!s) continue
    const ids: string[] = []
    for (const fr of s.frames) {
      let f = byFile.get(fr.file)
      if (!f) {
        const bytes = await read(fr.file)
        const img = bytes ? await blobToImage(new Blob([bytes as BlobPart], { type: 'image/png' })) : null
        const canvas = img ? toCanvas(img, img.naturalWidth, img.naturalHeight) : makeCanvas(64, 64)
        f = newFrame(canvas, `Frame ${byFile.size + 1}`, fr.duration)
        byFile.set(fr.file, f)
        doc.frames.push(f)
      }
      ids.push(f.id)
    }
    doc.sequences[name] = { frameIds: ids, loop: s.loop }
  }
  return doc
}

/** Definition + resolver for previewing an unsaved document with the real engine. */
export function previewDefinition(doc: StudioDoc, version: number): { def: CharacterDefinition; urls: Map<string, string> } {
  const urls = new Map<string, string>()
  const animations: CharacterDefinition['animations'] = {}
  for (const [name, s] of Object.entries(doc.sequences) as [SequenceName, SequenceDraft | undefined][]) {
    if (!s?.frameIds.length) continue
    animations[name] = {
      loop: s.loop,
      frames: s.frameIds
        .map((id) => doc.frames.find((f) => f.id === id))
        .filter((f): f is StudioFrame => !!f)
        .map((f) => {
          const key = `preview/${f.id}-${version}.png`
          if (!urls.has(key)) urls.set(key, f.work.toDataURL('image/png'))
          return { file: key, duration: f.duration }
        })
    }
  }
  return {
    def: {
      id: '__studio_preview__',
      name: doc.name,
      category: 'custom',
      builtIn: false,
      kind: 'image',
      behaviours: doc.behaviours,
      defaultBehaviour: doc.defaultBehaviour,
      baseSize: doc.baseSize,
      defaultOpacity: 1,
      defaultSpeed: doc.defaultSpeed,
      facing: doc.facing,
      animations,
      hanging: doc.hanging,
      updatedAt: version
    },
    urls
  }
}
