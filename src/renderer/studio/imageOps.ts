// Pure canvas image operations for the Studio. Everything runs locally in the
// renderer; no image ever leaves the device.

export const MAX_SIDE = 1600

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w))
  c.height = Math.max(1, Math.round(h))
  return c
}

export function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  return c.getContext('2d', { willReadFrequently: true })!
}

export function cloneCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = makeCanvas(src.width, src.height)
  ctx2d(c).drawImage(src, 0, 0)
  return c
}

/** Draw an image source into a canvas, downscaling so the longest side is at most MAX_SIDE. */
export function toCanvas(src: CanvasImageSource, width: number, height: number, maxSide = MAX_SIDE): HTMLCanvasElement {
  const k = Math.min(1, maxSide / Math.max(width, height))
  const c = makeCanvas(width * k, height * k)
  const g = ctx2d(c)
  g.imageSmoothingQuality = 'high'
  g.drawImage(src, 0, 0, c.width, c.height)
  return c
}

export async function blobToImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return img
  } finally {
    // The decoded image keeps its pixels; the URL is no longer needed.
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}

export interface DecodedFrame {
  canvas: HTMLCanvasElement
  duration: number
}

/** Decode every frame of an animated GIF / WebP with WebCodecs, or the single frame of a still image. */
export async function decodeFrames(file: Blob, type: string): Promise<DecodedFrame[]> {
  const Decoder = (globalThis as unknown as { ImageDecoder?: typeof ImageDecoder }).ImageDecoder
  if ((type === 'image/gif' || type === 'image/webp') && Decoder) {
    try {
      if (await Decoder.isTypeSupported(type)) {
        const dec = new Decoder({ data: await file.arrayBuffer(), type })
        await dec.tracks.ready
        const count = dec.tracks.selectedTrack?.frameCount ?? 1
        if (count > 1) {
          const out: DecodedFrame[] = []
          for (let i = 0; i < Math.min(count, 120); i++) {
            const { image } = await dec.decode({ frameIndex: i })
            const c = toCanvas(image, image.displayWidth, image.displayHeight)
            out.push({ canvas: c, duration: Math.max(20, Math.round((image.duration ?? 100000) / 1000)) })
            image.close()
          }
          dec.close()
          return out
        }
        dec.close()
      }
    } catch (err) {
      console.warn('[studio] animated decode failed, using first frame', err)
    }
  }
  const img = await blobToImage(file)
  return [{ canvas: toCanvas(img, img.naturalWidth, img.naturalHeight), duration: 120 }]
}

const idx = (x: number, y: number, w: number): number => (y * w + x) * 4

/** True if a meaningful share of the border is already transparent. */
export function hasTransparentBorder(c: HTMLCanvasElement): boolean {
  const { width: w, height: h } = c
  const d = ctx2d(c).getImageData(0, 0, w, h).data
  let clear = 0
  let total = 0
  const sample = (x: number, y: number): void => {
    total++
    if (d[idx(x, y, w) + 3] < 16) clear++
  }
  for (let x = 0; x < w; x += 3) { sample(x, 0); sample(x, h - 1) }
  for (let y = 0; y < h; y += 3) { sample(0, y); sample(w - 1, y) }
  return clear / total > 0.6
}

/**
 * Remove a background by flood-filling from the image border. Pixels similar
 * to the dominant border colour (within `tolerance`, 0..100) are cleared;
 * pixels near the boundary get partial alpha for a soft edge.
 * Works well for plain or gently graded backgrounds; busy photos need the
 * eraser and restore brushes.
 */
export function removeBackground(c: HTMLCanvasElement, tolerance: number, softness: number): number {
  const { width: w, height: h } = c
  const g = ctx2d(c)
  const img = g.getImageData(0, 0, w, h)
  const d = img.data

  // Dominant border colour via a coarse histogram.
  const hist = new Map<number, { n: number; r: number; g: number; b: number }>()
  const add = (x: number, y: number): void => {
    const i = idx(x, y, w)
    if (d[i + 3] < 16) return
    const key = ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4)
    const e = hist.get(key) ?? { n: 0, r: 0, g: 0, b: 0 }
    e.n++
    e.r += d[i]
    e.g += d[i + 1]
    e.b += d[i + 2]
    hist.set(key, e)
  }
  for (let x = 0; x < w; x++) { add(x, 0); add(x, h - 1) }
  for (let y = 0; y < h; y++) { add(0, y); add(w - 1, y) }
  let best = { n: 0, r: 255, g: 255, b: 255 }
  for (const e of hist.values()) if (e.n > best.n) best = e
  if (best.n === 0) return 0
  const br = best.r / best.n
  const bg = best.g / best.n
  const bb = best.b / best.n

  const tol = (tolerance / 100) * 160 + 6
  const soft = tol * (1 + softness / 50)
  const dist = (i: number): number => {
    const dr = d[i] - br
    const dg = d[i + 1] - bg
    const db = d[i + 2] - bb
    return Math.sqrt(dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11) * 1.7
  }

  const seen = new Uint8Array(w * h)
  const stack = new Int32Array(w * h)
  let sp = 0
  const push = (p: number): void => {
    if (seen[p]) return
    seen[p] = 1
    stack[sp++] = p
  }
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x) }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1) }

  let removed = 0
  while (sp > 0) {
    const p = stack[--sp]
    const i = p * 4
    const a = d[i + 3]
    const dd = a < 16 ? 0 : dist(i)
    if (dd > soft) continue
    if (dd <= tol) {
      d[i + 3] = 0
      removed++
    } else {
      // In the soft band: fade instead of a hard cut, and stop spreading.
      d[i + 3] = Math.min(a, Math.round(((dd - tol) / (soft - tol)) * 255))
      continue
    }
    const x = p % w
    const y = (p / w) | 0
    if (x > 0) push(p - 1)
    if (x < w - 1) push(p + 1)
    if (y > 0) push(p - w)
    if (y < h - 1) push(p + w)
  }
  g.putImageData(img, 0, 0)
  return removed / (w * h)
}

/** Shrink the opaque region by `px` (removes coloured fringes left from the old background). */
export function erodeEdges(c: HTMLCanvasElement, px: number): void {
  const { width: w, height: h } = c
  const g = ctx2d(c)
  const img = g.getImageData(0, 0, w, h)
  const d = img.data
  for (let pass = 0; pass < px; pass++) {
    const a = new Uint8ClampedArray(w * h)
    for (let p = 0; p < w * h; p++) a[p] = d[p * 4 + 3]
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x
        let m = a[p]
        if (x > 0) m = Math.min(m, a[p - 1])
        if (x < w - 1) m = Math.min(m, a[p + 1])
        if (y > 0) m = Math.min(m, a[p - w])
        if (y < h - 1) m = Math.min(m, a[p + w])
        d[p * 4 + 3] = m
      }
    }
  }
  g.putImageData(img, 0, 0)
}

/** Soften the edge of the opaque region by blurring alpha inward over `px` pixels. */
export function featherEdges(c: HTMLCanvasElement, px: number): void {
  if (px <= 0) return
  const { width: w, height: h } = c
  const g = ctx2d(c)
  const img = g.getImageData(0, 0, w, h)
  const d = img.data
  const a = new Float32Array(w * h)
  for (let p = 0; p < w * h; p++) a[p] = d[p * 4 + 3]
  const tmp = new Float32Array(w * h)
  const r = Math.max(1, Math.round(px))
  // separable box blur, two passes ≈ gaussian
  for (let k = 0; k < 2; k++) {
    for (let y = 0; y < h; y++) {
      let acc = 0
      for (let x = -r; x <= r; x++) acc += a[y * w + Math.min(w - 1, Math.max(0, x))]
      for (let x = 0; x < w; x++) {
        tmp[y * w + x] = acc / (2 * r + 1)
        acc += a[y * w + Math.min(w - 1, x + r + 1)] - a[y * w + Math.max(0, x - r)]
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0
      for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]
      for (let y = 0; y < h; y++) {
        a[y * w + x] = acc / (2 * r + 1)
        acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]
      }
    }
  }
  for (let p = 0; p < w * h; p++) d[p * 4 + 3] = Math.min(d[p * 4 + 3], Math.round(a[p]))
  g.putImageData(img, 0, 0)
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Bounding box of pixels with alpha above a threshold, or null if fully transparent. */
export function opaqueBounds(c: HTMLCanvasElement, threshold = 10): Rect | null {
  const { width: w, height: h } = c
  const d = ctx2d(c).getImageData(0, 0, w, h).data
  let minX = w, minY = h, maxX = -1, maxY = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[idx(x, y, w) + 3] > threshold) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

export function crop(c: HTMLCanvasElement, r: Rect): HTMLCanvasElement {
  const x = Math.max(0, Math.floor(r.x))
  const y = Math.max(0, Math.floor(r.y))
  const w = Math.min(c.width - x, Math.ceil(r.w))
  const h = Math.min(c.height - y, Math.ceil(r.h))
  const out = makeCanvas(w, h)
  ctx2d(out).drawImage(c, x, y, w, h, 0, 0, w, h)
  return out
}

/** Rotate by any angle, growing the canvas so nothing is clipped. */
export function rotate(c: HTMLCanvasElement, deg: number): HTMLCanvasElement {
  const r = (deg * Math.PI) / 180
  const cos = Math.abs(Math.cos(r))
  const sin = Math.abs(Math.sin(r))
  const out = makeCanvas(c.width * cos + c.height * sin, c.width * sin + c.height * cos)
  const g = ctx2d(out)
  g.translate(out.width / 2, out.height / 2)
  g.rotate(r)
  g.drawImage(c, -c.width / 2, -c.height / 2)
  return out
}

export function resize(c: HTMLCanvasElement, factor: number): HTMLCanvasElement {
  const out = makeCanvas(c.width * factor, c.height * factor)
  const g = ctx2d(out)
  g.imageSmoothingQuality = 'high'
  g.drawImage(c, 0, 0, out.width, out.height)
  return out
}

export function flip(c: HTMLCanvasElement): HTMLCanvasElement {
  const out = makeCanvas(c.width, c.height)
  const g = ctx2d(out)
  g.translate(c.width, 0)
  g.scale(-1, 1)
  g.drawImage(c, 0, 0)
  return out
}

/** Paint one brush dab. Erase clears alpha; restore copies pixels back from `source`. */
export function dab(work: HTMLCanvasElement, source: HTMLCanvasElement, mode: 'erase' | 'restore', x: number, y: number, radius: number, hardness: number): void {
  const g = ctx2d(work)
  const grad = g.createRadialGradient(x, y, radius * hardness, x, y, radius)
  grad.addColorStop(0, 'rgba(0,0,0,1)')
  grad.addColorStop(1, 'rgba(0,0,0,0)')
  if (mode === 'erase') {
    g.save()
    g.globalCompositeOperation = 'destination-out'
    g.fillStyle = grad
    g.beginPath()
    g.arc(x, y, radius, 0, Math.PI * 2)
    g.fill()
    g.restore()
    return
  }
  const size = Math.ceil(radius * 2) + 2
  const tmp = makeCanvas(size, size)
  const t = ctx2d(tmp)
  const ox = x - size / 2
  const oy = y - size / 2
  t.drawImage(source, -ox, -oy)
  t.globalCompositeOperation = 'destination-in'
  const tg = t.createRadialGradient(size / 2, size / 2, radius * hardness, size / 2, size / 2, radius)
  tg.addColorStop(0, 'rgba(0,0,0,1)')
  tg.addColorStop(1, 'rgba(0,0,0,0)')
  t.fillStyle = tg
  t.fillRect(0, 0, size, size)
  g.drawImage(tmp, ox, oy)
}

/** Find grid cells in a sprite sheet by looking for fully transparent (or background-coloured) rows/columns. */
export function detectGrid(c: HTMLCanvasElement): { rows: number; cols: number } {
  const { width: w, height: h } = c
  const d = ctx2d(c).getImageData(0, 0, w, h).data
  const transparent = hasTransparentBorder(c)
  const r0 = d[0], g0 = d[1], b0 = d[2]
  const empty = (i: number): boolean =>
    transparent ? d[i + 3] < 12 : Math.abs(d[i] - r0) + Math.abs(d[i + 1] - g0) + Math.abs(d[i + 2] - b0) < 30
  const colEmpty = (x: number): boolean => {
    for (let y = 0; y < h; y += 2) if (!empty(idx(x, y, w))) return false
    return true
  }
  const rowEmpty = (y: number): boolean => {
    for (let x = 0; x < w; x += 2) if (!empty(idx(x, y, w))) return false
    return true
  }
  const runs = (n: number, isEmpty: (i: number) => boolean): number => {
    let count = 0
    let inContent = false
    for (let i = 0; i < n; i++) {
      const e = isEmpty(i)
      if (!e && !inContent) count++
      inContent = !e
    }
    return Math.max(1, count)
  }
  return { cols: Math.min(32, runs(w, colEmpty)), rows: Math.min(32, runs(h, rowEmpty)) }
}

export function sliceGrid(c: HTMLCanvasElement, rows: number, cols: number, cells: number[]): HTMLCanvasElement[] {
  const cw = c.width / cols
  const ch = c.height / rows
  return cells.map((cell) => {
    const r = Math.floor(cell / cols)
    const col = cell % cols
    return crop(c, { x: col * cw, y: r * ch, w: cw, h: ch })
  })
}

export async function canvasToPng(c: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('encode failed'))), 'image/png'))
  return new Uint8Array(await blob.arrayBuffer())
}
