import type { RigId } from '../../shared/types'

/**
 * Tiny synthesised sound effects (Web Audio), so no audio files are shipped.
 * Sounds are off by default and gated by the global + per-character settings.
 */
export type SoundKind = 'meow' | 'woof' | 'chirp' | 'squeak' | 'purr' | 'flutter' | 'pop' | 'crunch'

export const RIG_SOUNDS: Partial<Record<RigId, { interact: SoundKind; idle?: SoundKind; move?: SoundKind }>> = {
  cat: { interact: 'meow', idle: 'purr' },
  puppy: { interact: 'woof' },
  bird: { interact: 'chirp', idle: 'chirp', move: 'flutter' },
  butterfly: { interact: 'pop' },
  dragonfly: { interact: 'pop', move: 'flutter' },
  bat: { interact: 'squeak', move: 'flutter' },
  squirrel: { interact: 'squeak' },
  rabbit: { interact: 'squeak' },
  penguin: { interact: 'squeak' },
  spider: { interact: 'pop' },
  gecko: { interact: 'chirp' }
}

let ctx: AudioContext | null = null

function audio(): AudioContext {
  if (!ctx) ctx = new AudioContext()
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

function tone(type: OscillatorType, freqs: [number, number][], dur: number, vol: number, filter?: number): void {
  const a = audio()
  const t0 = a.currentTime
  const osc = a.createOscillator()
  const gain = a.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freqs[0][1], t0)
  for (const [at, f] of freqs) osc.frequency.linearRampToValueAtTime(f, t0 + at * dur)
  gain.gain.setValueAtTime(0, t0)
  gain.gain.linearRampToValueAtTime(vol, t0 + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  let node: AudioNode = osc
  if (filter) {
    const f = a.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.value = filter
    osc.connect(f)
    node = f
  }
  node.connect(gain).connect(a.destination)
  osc.start(t0)
  osc.stop(t0 + dur + 0.05)
}

function noise(dur: number, vol: number, amHz: number, filter: number): void {
  const a = audio()
  const len = Math.floor(a.sampleRate * dur)
  const buf = a.createBuffer(1, len, a.sampleRate)
  const d = buf.getChannelData(0)
  let last = 0
  for (let i = 0; i < len; i++) {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02 // brown-ish
    const env = Math.sin((i / len) * Math.PI)
    d[i] = last * 3.5 * env * (0.6 + 0.4 * Math.sin((i / a.sampleRate) * amHz * Math.PI * 2))
  }
  const src = a.createBufferSource()
  src.buffer = buf
  const f = a.createBiquadFilter()
  f.type = 'lowpass'
  f.frequency.value = filter
  const g = a.createGain()
  g.gain.value = vol
  src.connect(f).connect(g).connect(a.destination)
  src.start()
}

export function play(kind: SoundKind, volume: number): void {
  if (volume <= 0) return
  const v = Math.min(1, volume) * 0.35
  try {
    switch (kind) {
      case 'meow':
        tone('sawtooth', [[0, 520], [0.25, 760], [0.7, 640], [1, 480]], 0.55, v * 0.6, 1600)
        break
      case 'woof':
        tone('square', [[0, 260], [0.3, 180], [1, 120]], 0.18, v * 0.5, 900)
        setTimeout(() => tone('square', [[0, 280], [0.3, 190], [1, 130]], 0.16, v * 0.45, 900), 210)
        break
      case 'chirp':
        tone('sine', [[0, 2400], [0.5, 3400], [1, 2800]], 0.09, v * 0.6)
        setTimeout(() => tone('sine', [[0, 2600], [0.5, 3600], [1, 3000]], 0.08, v * 0.5), 120)
        break
      case 'squeak':
        tone('sine', [[0, 900], [0.4, 1500], [1, 1200]], 0.14, v * 0.7)
        break
      case 'purr':
        noise(1.4, v * 1.4, 24, 260)
        break
      case 'flutter':
        noise(0.25, v * 0.6, 40, 1800)
        break
      case 'crunch':
        // A short, dry chew: two quick bursts of filtered noise.
        noise(0.07, v * 1.6, 90, 2600)
        setTimeout(() => noise(0.06, v * 1.2, 70, 2200), 90)
        break
      case 'pop':
        tone('triangle', [[0, 600], [1, 1100]], 0.08, v * 0.8)
        break
    }
  } catch {
    /* audio unavailable — ignore */
  }
}
