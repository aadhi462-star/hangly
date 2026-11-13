import { dialog, net, protocol } from 'electron'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DEFAULT_HANGING } from '../shared/defaults'
import { ASSET_SCHEME, type Result, type SaveCharacterRequest } from '../shared/ipc'
import type { AnimationSequence, Behaviour, CharacterDefinition, CharacterPackage, SequenceName } from '../shared/types'
import { dataDir, mergeKnown, store } from './store'

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const FILE_RE = /^(original|processed)\/[A-Za-z0-9_.-]{1,80}\.(png|jpe?g|webp|gif)$/i
const MAX_FILE_BYTES = 30 * 1024 * 1024
const MAX_FILES = 400
const BEHAVIOURS: Behaviour[] = ['walk', 'hang', 'fly', 'climb', 'stationary']
const SEQUENCES: SequenceName[] = ['idle', 'walk', 'run', 'hang', 'fly', 'climb', 'sleep', 'interact']

export const customRoot = (): string => {
  const d = join(dataDir(), 'characters', 'custom')
  mkdirSync(d, { recursive: true })
  return d
}

/** Resolve a path inside a character folder, refusing anything that escapes it. */
function safePath(id: string, rel: string): string | null {
  if (!ID_RE.test(id)) return null
  const base = resolve(customRoot(), id)
  const full = resolve(base, rel)
  if (full !== base && !full.startsWith(base + sep)) return null
  return full
}

/** Must be called before app 'ready'. */
export function registerAssetScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: ASSET_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }
  ])
}

/** screenly://char/<id>/<relative path> → read-only access to custom character assets. */
export function handleAssetProtocol(): void {
  protocol.handle(ASSET_SCHEME, async (req) => {
    try {
      const url = new URL(req.url)
      if (url.hostname !== 'char') return new Response('Not found', { status: 404 })
      const [id, ...rest] = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
      const rel = rest.join('/')
      if (!FILE_RE.test(rel)) return new Response('Forbidden', { status: 403 })
      const file = safePath(id, rel)
      if (!file || !existsSync(file)) return new Response('Not found', { status: 404 })
      const res = await net.fetch(pathToFileURL(file).toString())
      // Pages are file:// so WebGL needs an explicit CORS grant to upload these pixels.
      const headers = new Headers(res.headers)
      headers.set('Access-Control-Allow-Origin', '*')
      return new Response(res.body, { status: res.status, headers })
    } catch {
      return new Response('Bad request', { status: 400 })
    }
  })
}

function sniffImage(bytes: Uint8Array): boolean {
  const b = bytes
  const png = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
  const jpg = b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
  const gif = b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46
  const webp = b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45
  return png || jpg || gif || webp
}

const clamp = (v: unknown, lo: number, hi: number, d: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d

/** Validate a renderer-supplied definition, keeping only known, well-typed fields. */
export function sanitizeDefinition(raw: CharacterDefinition, id: string): CharacterDefinition {
  const behaviours = Array.isArray(raw.behaviours) ? raw.behaviours.filter((b) => BEHAVIOURS.includes(b)) : []
  if (behaviours.length === 0) behaviours.push('stationary')
  const animations: CharacterDefinition['animations'] = {}
  if (raw.animations && typeof raw.animations === 'object') {
    for (const name of SEQUENCES) {
      const seq = (raw.animations as Record<string, AnimationSequence | undefined>)[name]
      if (!seq || !Array.isArray(seq.frames)) continue
      const frames = seq.frames
        .filter((f) => f && typeof f.file === 'string' && FILE_RE.test(f.file))
        .slice(0, 240)
        .map((f) => ({ file: f.file, duration: clamp(f.duration, 16, 5000, 100) }))
      if (frames.length) animations[name] = { frames, loop: seq.loop !== false }
    }
  }
  const now = Date.now()
  return {
    id,
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 60) : 'My character',
    category: 'custom',
    builtIn: false,
    kind: 'image',
    behaviours,
    defaultBehaviour: behaviours.includes(raw.defaultBehaviour) ? raw.defaultBehaviour : behaviours[0],
    baseSize: clamp(raw.baseSize, 16, 800, 120),
    defaultOpacity: clamp(raw.defaultOpacity, 0.1, 1, 1),
    defaultSpeed: clamp(raw.defaultSpeed, 0, 600, 60),
    facing: raw.facing === 'left' ? 'left' : 'right',
    animations,
    hanging: mergeKnown(structuredClone(DEFAULT_HANGING), raw.hanging),
    preview: typeof raw.preview === 'string' && FILE_RE.test(raw.preview) ? raw.preview : undefined,
    legLine: typeof raw.legLine === 'number' && raw.legLine > 0 ? clamp(raw.legLine, 0.4, 0.95, 0.72) : undefined,
    description: typeof raw.description === 'string' ? raw.description.slice(0, 280) : undefined,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : now,
    updatedAt: now
  }
}

const newId = (): string => `c_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

export function saveCustomCharacter(req: SaveCharacterRequest): Result<string> {
  const existing = req.definition?.id && store.state.customCharacters.find((c) => c.id === req.definition.id)
  const id = existing ? req.definition.id : newId()
  const files = Object.entries(req.files ?? {})
  if (files.length > MAX_FILES) return { ok: false, error: 'Too many files in one character.' }
  for (const [rel, bytes] of files) {
    if (!FILE_RE.test(rel)) return { ok: false, error: `Rejected file name: ${rel}` }
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_FILE_BYTES) return { ok: false, error: `${rel} is too large.` }
    if (!sniffImage(bytes)) return { ok: false, error: `${rel} is not a supported image.` }
  }
  const def = sanitizeDefinition(req.definition, id)
  // Every frame the definition points at must exist after this save.
  const incoming = new Set(files.map(([rel]) => rel))
  const missing = Object.values(def.animations ?? {})
    .flatMap((s) => s!.frames.map((f) => f.file))
    .find((f) => !incoming.has(f) && !existsSync(safePath(id, f) ?? ''))
  if (missing) return { ok: false, error: `Missing frame: ${missing}` }
  if (!def.animations?.idle) return { ok: false, error: 'A character needs at least an idle frame.' }

  for (const [rel, bytes] of files) {
    const full = safePath(id, rel)
    if (!full) return { ok: false, error: 'Invalid path' }
    // Originals are never overwritten once stored.
    if (rel.startsWith('original/') && existsSync(full)) continue
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, bytes)
  }
  writeFileSync(join(customRoot(), id, 'configuration.json'), JSON.stringify(def, null, 2))
  store.mutate((s) => {
    const i = s.customCharacters.findIndex((c) => c.id === id)
    if (i >= 0) s.customCharacters[i] = def
    else s.customCharacters.push(def)
  })
  return { ok: true, value: id }
}

export function deleteCustomCharacter(id: string): Result {
  const dir = safePath(id, '.')
  if (!dir) return { ok: false, error: 'Invalid id' }
  rmSync(dir, { recursive: true, force: true })
  store.mutate((s) => {
    s.customCharacters = s.customCharacters.filter((c) => c.id !== id)
    s.instances = s.instances.filter((i) => i.characterId !== id)
    s.recent = s.recent.filter((r) => r !== id)
  })
  return { ok: true }
}

export function duplicateCustomCharacter(id: string): Result<string> {
  const def = store.state.customCharacters.find((c) => c.id === id)
  const src = safePath(id, '.')
  if (!def || !src) return { ok: false, error: 'Character not found' }
  const copyId = newId()
  cpSync(src, join(customRoot(), copyId), { recursive: true })
  const copy = { ...structuredClone(def), id: copyId, name: `${def.name} copy`, createdAt: Date.now(), updatedAt: Date.now() }
  writeFileSync(join(customRoot(), copyId, 'configuration.json'), JSON.stringify(copy, null, 2))
  store.mutate((s) => void s.customCharacters.push(copy))
  return { ok: true, value: copyId }
}

export function readCharacterFile(id: string, rel: string): Result<Uint8Array> {
  if (!FILE_RE.test(rel)) return { ok: false, error: 'Invalid path' }
  const full = safePath(id, rel)
  if (!full || !existsSync(full)) return { ok: false, error: 'Not found' }
  return { ok: true, value: new Uint8Array(readFileSync(full)) }
}

function listFiles(dir: string, base = dir): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? listFiles(full, base) : [relative(base, full).split(sep).join('/')]
  })
}

export async function exportCharacter(id: string): Promise<Result<string>> {
  const def = store.state.customCharacters.find((c) => c.id === id)
  const dir = safePath(id, '.')
  if (!def || !dir) return { ok: false, error: 'Only custom characters can be exported.' }
  const files: Record<string, string> = {}
  for (const rel of listFiles(dir)) if (FILE_RE.test(rel)) files[rel] = readFileSync(join(dir, rel)).toString('base64')
  const pkg: CharacterPackage = { format: 'screenly-character', version: 1, definition: def, files }
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Export character',
    defaultPath: `${def.name.replace(/[^\w -]/g, '')}.screenly`,
    filters: [{ name: 'Screenly character', extensions: ['screenly'] }]
  })
  if (canceled || !filePath) return { ok: false, error: 'cancelled' }
  writeFileSync(filePath, JSON.stringify(pkg))
  return { ok: true, value: filePath }
}

export async function importCharacter(): Promise<Result<string>> {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Import character',
    properties: ['openFile'],
    // .screenpal files come from before the app was renamed; they import the same way.
    filters: [{ name: 'Screenly character', extensions: ['screenly', 'screenpal', 'json'] }]
  })
  if (canceled || !filePaths[0]) return { ok: false, error: 'cancelled' }
  try {
    if (statSync(filePaths[0]).size > 400 * 1024 * 1024) return { ok: false, error: 'File is too large.' }
    const pkg = JSON.parse(readFileSync(filePaths[0], 'utf8')) as CharacterPackage
    const knownFormat = pkg.format === 'screenly-character' || (pkg.format as string) === 'screenpals-character'
    if (!knownFormat || pkg.version !== 1 || !pkg.definition || typeof pkg.files !== 'object') {
      return { ok: false, error: 'This is not a Screenly character package.' }
    }
    const files: Record<string, Uint8Array> = {}
    for (const [rel, b64] of Object.entries(pkg.files)) {
      if (typeof b64 !== 'string') continue
      files[rel] = new Uint8Array(Buffer.from(b64, 'base64'))
    }
    // Always import as a new character, never overwrite an existing one.
    return saveCustomCharacter({ definition: { ...pkg.definition, id: '' }, files })
  } catch (err) {
    return { ok: false, error: `Could not read package: ${(err as Error).message}` }
  }
}
