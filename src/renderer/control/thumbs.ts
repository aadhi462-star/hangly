import { Application, Container, Graphics } from 'pixi.js'
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

function rigThumb(rig: RigId, pose: 'idle' | 'hanging' | 'flying'): Promise<string> {
  const key = `${rig}:${pose}`
  let p = cache.get(key)
  if (!p) {
    p = (async () => {
      const app = await renderer()
      const g = new Graphics()
      const r = RIGS[rig]
      // Render large (≈420px, at 2× density) so previews stay crisp on big cards and Retina screens.
      // The scale goes on a wrapper: extract renders its target at the target's own local scale.
      const scale = 420 / Math.max(r.height, r.width)
      const state = pose
      r.draw(g, { state, t: 0.4, phase: 0.8, blink: false, look: 0, effort: 1 })
      const wrap = new Container()
      wrap.addChild(g)
      g.scale.set(scale)
      const url = await app.renderer.extract.base64({ target: wrap, resolution: 2 })
      wrap.destroy({ children: true })
      return url
    })()
    cache.set(key, p)
  }
  return p
}

export function useThumb(def: CharacterDefinition | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    if (!def) return
    if (def.kind === 'procedural' && def.rig) {
      // Show the pose of the character's default behaviour (e.g. the bat in flight).
      const pose = def.defaultBehaviour === 'fly' ? 'flying' : def.defaultBehaviour === 'hang' ? 'hanging' : 'idle'
      void rigThumb(def.rig, pose).then((u) => alive && setUrl(u))
    }
    else {
      const p = def.preview ?? def.animations?.idle?.frames[0]?.file
      setUrl(p ? characterAssetUrl(def, p) : null)
    }
    return () => {
      alive = false
    }
  }, [def?.id, def?.updatedAt, def?.rig, def?.defaultBehaviour])
  return url
}
