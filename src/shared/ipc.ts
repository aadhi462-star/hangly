import type {
  AppState,
  Behaviour,
  CharacterDefinition,
  CharacterInstance,
  DisplayInfo,
  HangingConfig,
  InstanceStatus,
  OverlayInit,
  Settings
} from './types'

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K] }

export interface Result<T = undefined> {
  ok: boolean
  error?: string
  value?: T
}

export type Align = 'left' | 'right' | 'center' | 'top' | 'bottom' | 'default'

export interface SaveCharacterRequest {
  definition: CharacterDefinition
  /** relative path -> file bytes. Only "original/*" and "processed/*" paths are accepted. */
  files: Record<string, Uint8Array>
}

export type Page = 'home' | 'library' | 'studio' | 'active' | 'presets' | 'settings'

/** The API the preload script exposes on window.screenly. */
export interface ScreenlyApi {
  platform: string
  getState(): Promise<AppState>
  getDisplays(): Promise<DisplayInfo[]>
  getShortcutErrors(): Promise<Record<string, string>>
  onState(cb: (s: AppState) => void): () => void
  onStatus(cb: (s: InstanceStatus[]) => void): () => void
  onDisplays(cb: (d: DisplayInfo[]) => void): () => void
  onNavigate(cb: (page: Page) => void): () => void
  onShortcutErrors(cb: (e: Record<string, string>) => void): () => void

  addInstance(characterId: string, displayId?: number): Promise<Result<string>>
  updateInstance(instanceId: string, patch: DeepPartial<CharacterInstance>): Promise<Result>
  removeInstance(instanceId: string): Promise<Result>
  duplicateInstance(instanceId: string): Promise<Result<string>>
  repositionInstance(instanceId: string, pos: { x?: number; y?: number; align?: Align; displayId?: number }): Promise<Result>
  resetInstance(instanceId: string): Promise<Result>
  clearInstances(): Promise<Result>

  updateSettings(patch: DeepPartial<Settings>): Promise<Result>
  applyProfile(id: string): Promise<Result>
  saveProfile(name: string, includeCharacters: boolean): Promise<Result<string>>
  renameProfile(id: string, name: string): Promise<Result>
  duplicateProfile(id: string): Promise<Result<string>>
  deleteProfile(id: string): Promise<Result>

  saveCustomCharacter(req: SaveCharacterRequest): Promise<Result<string>>
  deleteCustomCharacter(id: string): Promise<Result>
  duplicateCustomCharacter(id: string): Promise<Result<string>>
  exportCharacter(id: string): Promise<Result<string>>
  importCharacter(): Promise<Result<string>>
  readCharacterFile(id: string, path: string): Promise<Result<Uint8Array>>
  setBuiltInHidden(id: string, hidden: boolean): Promise<Result>

  saveHangingPreset(name: string, config: HangingConfig): Promise<Result<string>>
  deleteHangingPreset(id: string): Promise<Result>

  /** Offer a character one of its foods (validated against its diet in main). */
  feed(instanceId: string, foodId?: string): Promise<Result>
  feedAll(): Promise<Result>

  openDataFolder(): Promise<void>
  quit(): Promise<void>

  overlay: {
    onInit(cb: (init: OverlayInit) => void): () => void
    /** Global cursor position, pushed by main while the overlay is visible. */
    onCursor(cb: (p: { x: number; y: number }) => void): () => void
    /** Main asks this overlay to offer a character some food. */
    onFeed(cb: (req: { instanceId: string; foodId: string }) => void): () => void
    /** Window rectangles in global coordinates, front to back. */
    onSurfaces(cb: (rects: { id: number; x: number; y: number; w: number; h: number }[]) => void): () => void
    /** Ask main to switch a character's behaviour after a drop (validated in main). */
    adapt(instanceId: string, behaviour: Behaviour, x: number, y: number): void
    setInteractive(interactive: boolean): void
    reportStatus(status: InstanceStatus[]): void
    ready(): void
  }
}

export const ASSET_SCHEME = 'screenly'

/** URL of an image belonging to one of the user's own characters. */
export function characterAssetUrl(def: { id: string; updatedAt?: number }, path: string): string {
  return assetUrl(def.id, path, def.updatedAt)
}

export function assetUrl(characterId: string, path: string, version?: number): string {
  const v = version ? `?v=${version}` : ''
  return `${ASSET_SCHEME}://char/${encodeURIComponent(characterId)}/${path.split('/').map(encodeURIComponent).join('/')}${v}`
}
