import { Texture } from 'pixi.js'

const cache = new Map<string, Promise<Texture>>()

/** Load an image URL into a texture once; repeated calls share the same promise. */
export function loadTexture(url: string): Promise<Texture> {
  let p = cache.get(url)
  if (!p) {
    p = (async () => {
      // fetch + ImageBitmap keeps the pixels CORS-clean for WebGL uploads.
      const res = await fetch(url, { mode: 'cors' })
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.slice(0, 80)}`)
      const bitmap = await createImageBitmap(await res.blob(), { premultiplyAlpha: 'premultiply' })
      return Texture.from(bitmap)
    })()
    p.catch(() => cache.delete(url))
    cache.set(url, p)
  }
  return p
}

/** Free every cached texture whose URL starts with `prefix` (e.g. a character that was edited or removed). */
export function releaseTextures(prefix: string): void {
  for (const [url, p] of cache) {
    if (!url.startsWith(prefix)) continue
    cache.delete(url)
    void p.then((t) => t.destroy(true)).catch(() => {})
  }
}
