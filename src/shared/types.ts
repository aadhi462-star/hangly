// Shared data model. Everything in AppState is plain JSON so it can cross IPC
// and be persisted to disk as-is.

export type Behaviour = 'walk' | 'hang' | 'fly' | 'climb' | 'stationary'

export type CharacterCategory = 'walking' | 'hanging' | 'flying' | 'climbing' | 'custom'

/** Built-in characters are drawn procedurally; each id maps to a rig in renderer/engine/rigs.ts. */
export type RigId =
  | 'cat'
  | 'puppy'
  | 'rabbit'
  | 'penguin'
  | 'spider'
  | 'bat'
  | 'bird'
  | 'butterfly'
  | 'dragonfly'
  | 'gecko'
  | 'squirrel'

/** Behaviour-engine states. A character only enters states its behaviour supports. */
export type CharState =
  | 'idle'
  | 'walking'
  | 'running'
  | 'sitting'
  | 'sleeping'
  | 'looking'
  | 'stretching'
  | 'hanging'
  | 'descending'
  | 'ascending'
  | 'swinging'
  | 'climbing'
  | 'flying'
  | 'landing'
  | 'interacting'
  | 'eating'
  | 'dragging'

export interface HangingConfig {
  /** Suspension point on the character, as a fraction of its width/height (0..1). */
  attachX: number
  attachY: number
  threadColor: string
  threadWidth: number
  /** Resting thread length in px (at 100% scale). */
  length: number
  /** Max distance the character descends below its resting length, px. */
  descentDistance: number
  /** Swing amplitude in degrees when actively swinging. */
  amplitude: number
  /** Swing frequency multiplier (1 = natural pendulum for the length). */
  frequency: number
  /** 0 = never settles, 1 = settles almost immediately. */
  damping: number
  descentSpeed: number
  ascentSpeed: number
  /** Extra rotation of the body while hanging, degrees. */
  rotation: number
  returnToTop: boolean
  idleSway: boolean
  /** Where the thread is tied: the very top of the screen, or just below the menu bar. */
  anchorFrom: 'screen' | 'menubar'
}

export interface AnimationFrame {
  /** Path relative to the character's folder, e.g. "processed/frame-0.png". */
  file: string
  /** Duration in ms. */
  duration: number
}

export interface AnimationSequence {
  frames: AnimationFrame[]
  loop: boolean
}

/** Sequence names the behaviour engine looks for, with fallbacks to "idle". */
export type SequenceName = 'idle' | 'walk' | 'run' | 'hang' | 'fly' | 'climb' | 'sleep' | 'interact'

export interface CharacterDefinition {
  id: string
  name: string
  category: CharacterCategory
  builtIn: boolean
  kind: 'procedural' | 'image'
  rig?: RigId
  behaviours: Behaviour[]
  defaultBehaviour: Behaviour
  /** Rendered height in px at 100% scale. */
  baseSize: number
  defaultOpacity: number
  defaultSpeed: number
  /** Which way the artwork faces natively. Procedural rigs face right. */
  facing: 'left' | 'right'
  animations?: Partial<Record<SequenceName, AnimationSequence>>
  hanging?: HangingConfig
  /** Relative path to a preview image (image characters only). */
  preview?: string
  description?: string
  /**
   * Single-image walkers: where the legs start, as a fraction of the image height
   * (0.4–0.95). The strip below is split into front and back legs that swing while
   * walking. Unset or 0 = off.
   */
  legLine?: number
  createdAt?: number
  updatedAt?: number
}

export interface Appearance {
  scale: number // 0.1..2
  opacity: number // 0.1..1
  rotation: number // degrees
  flipX: boolean
  flipY: boolean
  brightness: number // 0.3..1.7
  shadow: boolean
  shadowIntensity: number // 0..1
}

export interface Movement {
  walkSpeed: number // px/s
  runSpeed: number
  climbSpeed: number
  flySpeed: number
  /** Animation playback speed, independent of movement speed. */
  animSpeed: number
  /** Probability weight for doing something rather than idling, 0..1. */
  activity: number
  /** Average idle duration in seconds. */
  idleSeconds: number
  randomMovement: boolean
  autoMovement: boolean
  direction: 'auto' | 'left' | 'right'
  followCursor: boolean
  fixedPosition: boolean
  /** Walk area as fractions of the display width. */
  areaMin: number
  areaMax: number
}

export interface Interaction {
  clickToInteract: boolean
  draggable: boolean
  /** When true the character never captures the mouse. */
  clickThrough: boolean
  locked: boolean
}

export interface CharacterInstance {
  instanceId: string
  characterId: string
  displayId: number
  behaviour: Behaviour
  /** Position in display-local px (work-area relative). For hanging this is the anchor x. */
  x: number
  y: number
  /** Bumped whenever the panel explicitly repositions, so the overlay knows to jump. */
  positionVersion: number
  appearance: Appearance
  movement: Movement
  hanging: HangingConfig
  interaction: Interaction
  paused: boolean
  hidden: boolean
  muted: boolean
  addedAt: number
  /** When it last finished eating (ms since epoch), 0 if never. */
  lastFed: number
  /** Affection 0..100 at `affectionAt`; see shared/mood.ts for how it fades. */
  affection: number
  affectionAt: number
}

export interface Shortcuts {
  togglePause: string
  emergencyHide: string
  openPanel: string
  toggleInteraction: string
}

export interface Settings {
  globalOpacity: number
  pausedAll: boolean
  hiddenAll: boolean
  /** When false, every character is click-through regardless of its own setting. */
  interactionEnabled: boolean
  maxCharacters: number
  fps: 30 | 45 | 60
  aboveFullScreen: boolean
  showInDock: boolean
  launchAtLogin: boolean
  theme: 'system' | 'light' | 'dark'
  sound: { enabled: boolean; volume: number; idleSounds: boolean }
  focus: {
    active: boolean
    hideCharacters: boolean
    schedule: { enabled: boolean; start: string; end: string }
  }
  shortcuts: Shortcuts
  /** Global multipliers set by profiles. */
  profile: { scale: number; activity: number; speed: number; idle: number }
  activeProfileId: string
  avoidOverlap: boolean
  /** Characters stand on, walk along and fall between the tops of app windows. */
  standOnWindows: boolean
  /** Dropping a character near the top makes it hang, near a side makes it climb. */
  adaptOnDrop: boolean
  /** Characters get sleepy in the evening and lively in the morning. */
  dayNight: boolean
  /** Characters look at the cursor, startle at fast movements and greet each other. */
  lively: boolean
  /** The first-run welcome tour has been completed or dismissed. */
  onboarded: boolean
  hiddenBuiltIns: string[]
}

export interface Profile {
  id: string
  name: string
  builtIn: boolean
  description: string
  values: Settings['profile']
  /** Optional snapshot of the active characters, restored when the profile is applied. */
  instances?: CharacterInstance[]
  pause?: boolean
  focus?: boolean
}

export interface HangingPreset {
  id: string
  name: string
  config: HangingConfig
}

export interface AppState {
  version: 1
  settings: Settings
  instances: CharacterInstance[]
  customCharacters: CharacterDefinition[]
  profiles: Profile[]
  hangingPresets: HangingPreset[]
  recent: string[]
}

export interface DisplayInfo {
  id: number
  label: string
  primary: boolean
  /** Full display bounds in global coordinates. */
  bounds: { x: number; y: number; width: number; height: number }
  workArea: { x: number; y: number; width: number; height: number }
  scaleFactor: number
}

/** Live status the overlay reports for the Active Characters view. Not persisted. */
export interface InstanceStatus {
  instanceId: string
  state: CharState
  x: number
  y: number
}

/** Sent to each overlay window on start and whenever the display changes. */
export interface OverlayInit {
  display: DisplayInfo
  /** Actual window bounds; may differ from display bounds if macOS constrains it. */
  windowBounds: { x: number; y: number; width: number; height: number }
}

/** A character package on disk / in an export file. */
export interface CharacterPackage {
  format: 'screenly-character'
  version: 1
  definition: CharacterDefinition
  /** relative path -> base64 PNG/JPEG/WebP bytes */
  files: Record<string, string>
}
