import { Application, Graphics } from 'pixi.js'
import { useEffect, useState } from 'react'
import { characterAssetUrl } from '../../shared/ipc'
import type { CharacterDefinition, RigId } from '../../shared/types'
import { RIGS } from '../engine/rigs'

// Library thumbnails for procedural characters: draw each rig once into a
// shared offscreen renderer and cache the PNG data URL.

let appPromise: Promise<Application> | null = null
const cache = new Map<string, Promise<string>>()

function renderer(): Promise<Application> {
  if (!appPromise) {
    appPromise = (async () => {
      const app = new Application()
      await app.init({ width: 256, height: 256, backgroundAlpha: 0, antialias: true, resolution: 2, preference: 'webgl' })
      return app
    })()
  }
  return appPromise
}

function rigThumb(rig: RigId): Promise<string> {
  let p = cache.get(rig)
  if (!p) {
    p = (async () => {
      const app = await renderer()
      const g = new Graphics()
      const r = RIGS[rig]
      const scale = 150 / Math.max(r.height, r.width)
      g.scale.set(scale)
      const state = r.origin === 'hang' ? 'hanging' : 'idle'
      r.draw(g, { state, t: 0.4, phase: 0.8, blink: false, look: 0, effort: 1 })
      const url = await app.renderer.extract.base64({ target: g, resolution: 2 })
      g.destroy()
      return url
    })()
    cache.set(rig, p)
  }
  return p
}

export function useThumb(def: CharacterDefinition | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    if (!def) return
    if (def.kind === 'procedural' && def.rig) void rigThumb(def.rig).then((u) => alive && setUrl(u))
    else {
      const p = def.preview ?? def.animations?.idle?.frames[0]?.file
      setUrl(p ? characterAssetUrl(def, p) : null)
    }
    return () => {
      alive = false
    }
  }, [def?.id, def?.updatedAt, def?.rig])
  return url
}
