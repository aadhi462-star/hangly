import type {
  AppState,
  Behaviour,
  CharacterDefinition,
  CharacterInstance,
  HangingConfig,
  Profile,
  Settings
} from './types'

export const MAX_CHARACTERS_HARD_LIMIT = 24

export const DEFAULT_HANGING: HangingConfig = {
  attachX: 0.5,
  attachY: 0.05,
  threadColor: '#e8e8f0',
  threadWidth: 1.2,
  length: 180,
  descentDistance: 260,
  amplitude: 18,
  frequency: 1,
  damping: 0.25,
  descentSpeed: 70,
  ascentSpeed: 90,
  rotation: 0,
  returnToTop: true,
  idleSway: true,
  anchorFrom: 'screen'
}

const b = (...xs: Behaviour[]): Behaviour[] => xs

/** Built-in characters. All artwork is original and drawn procedurally at runtime. */
export const BUILT_IN_CHARACTERS: CharacterDefinition[] = [
  {
    id: 'cat', name: 'Marmalade the Cat', category: 'walking', builtIn: true, kind: 'procedural', rig: 'cat',
    behaviours: b('walk', 'stationary'), defaultBehaviour: 'walk', baseSize: 70, defaultOpacity: 1, defaultSpeed: 55,
    facing: 'right', description: 'A ginger tabby that wanders, sits, stretches and naps.'
  },
  {
    id: 'puppy', name: 'Biscuit the Puppy', category: 'walking', builtIn: true, kind: 'procedural', rig: 'puppy',
    behaviours: b('walk', 'stationary'), defaultBehaviour: 'walk', baseSize: 72, defaultOpacity: 1, defaultSpeed: 65,
    facing: 'right', description: 'A golden retriever puppy with floppy ears and a waggy tail.'
  },
  {
    id: 'rabbit', name: 'Clover the Rabbit', category: 'walking', builtIn: true, kind: 'procedural', rig: 'rabbit',
    behaviours: b('walk', 'stationary'), defaultBehaviour: 'walk', baseSize: 62, defaultOpacity: 1, defaultSpeed: 60,
    facing: 'right', description: 'Hops along the bottom of your screen.'
  },
  {
    id: 'penguin', name: 'Pip the Penguin', category: 'walking', builtIn: true, kind: 'procedural', rig: 'penguin',
    behaviours: b('walk', 'stationary'), defaultBehaviour: 'walk', baseSize: 70, defaultOpacity: 1, defaultSpeed: 32,
    facing: 'right', description: 'Waddles. Slowly. With dignity.'
  },
  {
    id: 'squirrel', name: 'Hazel the Squirrel', category: 'climbing', builtIn: true, kind: 'procedural', rig: 'squirrel',
    behaviours: b('walk', 'climb', 'stationary'), defaultBehaviour: 'walk', baseSize: 58, defaultOpacity: 1, defaultSpeed: 80,
    facing: 'right', description: 'Scurries along the bottom and up the screen edges.'
  },
  {
    id: 'spider', name: 'Silk the Spider', category: 'hanging', builtIn: true, kind: 'procedural', rig: 'spider',
    behaviours: b('hang', 'stationary'), defaultBehaviour: 'hang', baseSize: 46, defaultOpacity: 1, defaultSpeed: 70,
    facing: 'right', description: 'Dangles from a silk thread, descends, climbs back and swings.',
    hanging: { ...DEFAULT_HANGING, attachX: 0.5, attachY: 0.12 }
  },
  {
    id: 'bat', name: 'Echo the Bat', category: 'hanging', builtIn: true, kind: 'procedural', rig: 'bat',
    behaviours: b('hang', 'fly'), defaultBehaviour: 'hang', baseSize: 56, defaultOpacity: 1, defaultSpeed: 140,
    facing: 'right', description: 'Hangs upside down from the top edge, or flutters around.',
    hanging: { ...DEFAULT_HANGING, length: 0, descentDistance: 0, attachY: 0, amplitude: 8, threadWidth: 0 }
  },
  {
    id: 'bird', name: 'Robin', category: 'flying', builtIn: true, kind: 'procedural', rig: 'bird',
    behaviours: b('fly', 'walk', 'stationary'), defaultBehaviour: 'fly', baseSize: 44, defaultOpacity: 1, defaultSpeed: 150,
    facing: 'right', description: 'Flies around and lands on the bottom edge for a rest.'
  },
  {
    id: 'butterfly', name: 'Monarch Butterfly', category: 'flying', builtIn: true, kind: 'procedural', rig: 'butterfly',
    behaviours: b('fly', 'stationary'), defaultBehaviour: 'fly', baseSize: 40, defaultOpacity: 1, defaultSpeed: 70,
    facing: 'right', description: 'Drifts lazily across the screen.'
  },
  {
    id: 'dragonfly', name: 'Dart the Dragonfly', category: 'flying', builtIn: true, kind: 'procedural', rig: 'dragonfly',
    behaviours: b('fly', 'stationary'), defaultBehaviour: 'fly', baseSize: 40, defaultOpacity: 1, defaultSpeed: 190,
    facing: 'right', description: 'Darts, hovers, darts again.'
  },
  {
    id: 'gecko', name: 'Sticky the Gecko', category: 'climbing', builtIn: true, kind: 'procedural', rig: 'gecko',
    behaviours: b('climb', 'stationary'), defaultBehaviour: 'climb', baseSize: 70, defaultOpacity: 1, defaultSpeed: 50,
    facing: 'right', description: 'Climbs up and down the edges of your display.'
  }
]


export const DEFAULT_SETTINGS: Settings = {
  globalOpacity: 1,
  pausedAll: false,
  hiddenAll: false,
  interactionEnabled: true,
  maxCharacters: 8,
  fps: 30,
  aboveFullScreen: false,
  showInDock: true,
  launchAtLogin: false,
  theme: 'system',
  sound: { enabled: false, volume: 0.4, idleSounds: false },
  focus: { active: false, hideCharacters: false, schedule: { enabled: false, start: '09:00', end: '12:00' } },
  shortcuts: {
    togglePause: 'CommandOrControl+Alt+P',
    emergencyHide: 'CommandOrControl+Alt+H',
    openPanel: 'CommandOrControl+Alt+S',
    toggleInteraction: 'CommandOrControl+Alt+I'
  },
  profile: { scale: 1, activity: 1, speed: 1, idle: 1 },
  activeProfileId: 'playful',
  avoidOverlap: true,
  standOnWindows: true,
  adaptOnDrop: true,
  hiddenBuiltIns: []
}

export const BUILT_IN_PROFILES: Profile[] = [
  {
    id: 'minimal', name: 'Minimal', builtIn: true, description: 'Small characters, little movement, low distraction.',
    values: { scale: 0.7, activity: 0.35, speed: 0.8, idle: 1.8 }
  },
  {
    id: 'playful', name: 'Playful', builtIn: true, description: 'Frequent movement, random animations, more interaction.',
    values: { scale: 1, activity: 1, speed: 1, idle: 1 }
  },
  {
    id: 'relaxed', name: 'Relaxed', builtIn: true, description: 'Slow movement and long, lazy idle periods.',
    values: { scale: 1, activity: 0.5, speed: 0.6, idle: 2.5 }
  },
  {
    id: 'focus', name: 'Focus', builtIn: true, description: 'Pauses every character and silences sound.',
    values: { scale: 0.8, activity: 0.2, speed: 0.6, idle: 3 }, focus: true
  }
]

export function defaultState(): AppState {
  return {
    version: 1,
    settings: structuredClone(DEFAULT_SETTINGS),
    instances: [],
    customCharacters: [],
    profiles: structuredClone(BUILT_IN_PROFILES),
    hangingPresets: [],
    recent: []
  }
}

export function newInstance(def: CharacterDefinition, displayId: number, workWidth: number): CharacterInstance {
  const behaviour = def.defaultBehaviour
  return {
    instanceId: `i_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    characterId: def.id,
    displayId,
    behaviour,
    x: Math.round(workWidth * (0.2 + Math.random() * 0.6)),
    y: 0,
    positionVersion: 1,
    appearance: {
      scale: 1, opacity: def.defaultOpacity, rotation: 0, flipX: false, flipY: false,
      brightness: 1, shadow: behaviour === 'walk' || behaviour === 'stationary', shadowIntensity: 0.35
    },
    movement: {
      walkSpeed: def.defaultSpeed,
      runSpeed: def.defaultSpeed * 2.4,
      climbSpeed: Math.max(30, def.defaultSpeed * 0.8),
      flySpeed: def.behaviours.includes('fly') ? def.defaultSpeed : 140,
      animSpeed: 1,
      activity: 0.6,
      idleSeconds: 4,
      randomMovement: true,
      autoMovement: true,
      direction: 'auto',
      followCursor: false,
      fixedPosition: false,
      areaMin: 0,
      areaMax: 1
    },
    hanging: structuredClone(def.hanging ?? DEFAULT_HANGING),
    interaction: { clickToInteract: true, draggable: true, clickThrough: false, locked: false },
    paused: false,
    hidden: false,
    muted: false,
    addedAt: Date.now()
  }
}

export const STATE_LABELS: Record<string, string> = {
  idle: 'Idle', walking: 'Walking', running: 'Running', sitting: 'Sitting', sleeping: 'Sleeping',
  looking: 'Looking around', stretching: 'Stretching', hanging: 'Hanging', descending: 'Descending',
  ascending: 'Ascending', swinging: 'Swinging', climbing: 'Climbing', flying: 'Flying', landing: 'Landing',
  interacting: 'Interacting', eating: 'Eating', dragging: 'Being dragged'
}

export const BEHAVIOUR_LABELS: Record<Behaviour, string> = {
  walk: 'Walking', hang: 'Hanging', fly: 'Flying', climb: 'Climbing', stationary: 'Stationary'
}
