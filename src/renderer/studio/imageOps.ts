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
 * Remove a background by flood-filling from the image border.
 *
 * The fill grows pixel to pixel: a neighbour joins the background when it is
 * close to the pixel it was reached from (so smooth gradients and vignettes are
 * followed) and not wildly different from the dominant border colour (so the
 * fill can't creep across a low-contrast subject). Pixels at the stopping edge
 * get partial alpha for a soft cut. `tolerance` and `softness` are 0..100.
 * Works well for studio-style and plain backgrounds; busy photos need the
 * eraser and restore brushes.
 *
 * With `at`, it works as a magic wand: the fill starts from that pixel and
 * uses its colour as the reference, which clears enclosed gaps the border
 * fill can't reach.
 */
export function removeBackground(c: HTMLCanvasElement, tolerance: number, softness: number, at?: { x: number; y: number }): number {
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
  const ax = at ? Math.floor(at.x) : -1
  const ay = at ? Math.floor(at.y) : -1
  if (at) {
    if (ax < 0 || ay < 0 || ax >= w || ay >= h) return 0
    const i = idx(ax, ay, w)
    best = { n: 1, r: d[i], g: d[i + 1], b: d[i + 2] }
  }
  if (best.n === 0) return 0
  const bgR = best.r / best.n
  const bgG = best.g / best.n
  const bgB = best.b / best.n

  const dist = (r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number => {
    const dr = r1 - r2
    const dg = g1 - g2
    const db = b1 - b2
    return Math.sqrt(dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11) * 1.7
  }
  const step = 6 + (tolerance / 100) * 40 // max difference between neighbouring background pixels
  // Max drift from the reference colour. The wand is kept tight: it clears one
  // uniform gap and must not creep through soft shadows into the subject.
  const global = at ? 12 + (tolerance / 100) * 90 : 30 + (tolerance / 100) * 300
  const soft = step * (1.5 + softness / 25)

  const seen = new Uint8Array(w * h)
  const stack = new Int32Array(w * h)
  let sp = 0
  let removed = 0
  const accept = (p: number): void => {
    seen[p] = 1
    stack[sp++] = p
  }
  const seed = (p: number): void => {
    if (seen[p]) return
    const i = p * 4
    if (d[i + 3] < 16 || dist(d[i], d[i + 1], d[i + 2], bgR, bgG, bgB) <= global) accept(p)
  }
  if (at) accept(ay * w + ax)
  else {
    for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x) }
    for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1) }
  }

  // Original colours of accepted pixels are needed after their alpha is cleared.
  const src = new Uint8ClampedArray(d)
  const visit = (q: number, from: number): void => {
    if (seen[q]) return
    const i = q * 4
    const f = from * 4
    if (src[i + 3] < 16) return accept(q)
    const local = dist(src[i], src[i + 1], src[i + 2], src[f], src[f + 1], src[f + 2])
    const drift = dist(src[i], src[i + 1], src[i + 2], bgR, bgG, bgB)
    if (local <= step && drift <= global) return accept(q)
    if (local <= soft && drift <= global * 1.3) {
      // Edge pixel: fade rather than cut, and stop spreading here.
      seen[q] = 2
      d[i + 3] = Math.min(d[i + 3], Math.round(((local - step) / (soft - step)) * 255))
    }
  }
  while (sp > 0) {
    const p = stack[--sp]
    if (d[p * 4 + 3] !== 0) {
      d[p * 4 + 3] = 0
      removed++
    }
    const x = p % w
    if (x > 0) visit(p - 1, p)
    if (x < w - 1) visit(p + 1, p)
    if (p >= w) visit(p - w, p)
    if (p < w * (h - 1)) visit(p + w, p)
  }

  // Second, relaxed pass: background-looking pixels that border the cleared
  // area (leftover haze in gaps and along the outline) are cleared too, as
  // long as they stay far closer to the background than to the subject.
  const relaxedStep = step * 2.5
  const relaxedDrift = global * 0.6
  const edge: number[] = []
  for (let p = 0; p < w * h; p++) if (seen[p] === 1) edge.push(p)
  for (let k = 0; k < edge.length; k++) {
    const p = edge[k]
    const x = p % w
    for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) {
      if (q < 0 || q >= w * h || seen[q] === 1) continue
      const i = q * 4
      const f = p * 4
      const local = dist(src[i], src[i + 1], src[i + 2], src[f], src[f + 1], src[f + 2])
      const drift = dist(src[i], src[i + 1], src[i + 2], bgR, bgG, bgB)
      if (local > relaxedStep || drift > relaxedDrift) continue
      seen[q] = 1
      if (d[i + 3] !== 0) removed++
      d[i + 3] = 0
      edge.push(q)
    }
  }
  g.putImageData(img, 0, 0)
  return removed / (w * h)
}

/**
 * Remove colour fringes (the light or dark halo left from the old background).
 * Pixels within `radius` of transparency take the average colour of solid
 * pixels just inside them; their alpha is kept, so the edge stays smooth.
 * Semi-transparent pixels with no solid pixels nearby are leftover background
 * haze and are cleared, and tiny detached specks are removed.
 */
export function defringe(c: HTMLCanvasElement, radius = 2): void {
  const { width: w, height: h } = c
  const g = ctx2d(c)
  const img = g.getImageData(0, 0, w, h)
  const d = img.data
  // Distance (in steps) from the nearest mostly-transparent pixel, capped.
  const cap = radius + 3
  const dist = new Uint8Array(w * h).fill(cap)
  const queue = new Int32Array(w * h)
  let head = 0
  let tail = 0
  for (let p = 0; p < w * h; p++) {
    if (d[p * 4 + 3] < 128) {
      dist[p] = 0
      queue[tail++] = p
    }
  }
  while (head < tail) {
    const p = queue[head++]
    const nd = dist[p] + 1
    if (nd >= cap) continue
    const x = p % w
    const ns = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]
    for (const q of ns) {
      if (q < 0 || q >= w * h || dist[q] <= nd) continue
      dist[q] = nd
      queue[tail++] = q
    }
  }
  const src = new Uint8ClampedArray(d)
  const win = radius + 2
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      if (src[p * 4 + 3] === 0 || dist[p] > radius) continue
      let r = 0, gg = 0, b = 0, n = 0
      for (let dy = -win; dy <= win; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= h) continue
        for (let dx = -win; dx <= win; dx++) {
          const xx = x + dx
          if (xx < 0 || xx >= w) continue
          const q = yy * w + xx
          if (dist[q] <= radius || src[q * 4 + 3] < 250) continue
          r += src[q * 4]
          gg += src[q * 4 + 1]
          b += src[q * 4 + 2]
          n++
        }
      }
      if (!n) {
        if (src[p * 4 + 3] < 250) d[p * 4 + 3] = 0
        continue
      }
      d[p * 4] = r / n
      d[p * 4 + 1] = gg / n
      d[p * 4 + 2] = b / n
    }
  }
  removeSpecks(d, w, h, Math.max(12, Math.round(w * h * 0.0004)))
  g.putImageData(img, 0, 0)
}

/** Clear connected groups of visible pixels smaller than `minArea` (in place on RGBA data). */
function removeSpecks(d: Uint8ClampedArray, w: number, h: number, minArea: number): void {
  const label = new Uint8Array(w * h)
  const stack = new Int32Array(w * h)
  const members: number[] = []
  for (let s = 0; s < w * h; s++) {
    if (label[s] || d[s * 4 + 3] < 8) continue
    let sp = 0
    members.length = 0
    stack[sp++] = s
    label[s] = 1
    while (sp > 0) {
      const p = stack[--sp]
      members.push(p)
      const x = p % w
      const y = (p / w) | 0
      // 8-connected so thin diagonal lines (like a web strand) stay one piece.
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx
          const yy = y + dy
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
          const q = yy * w + xx
          if (label[q] || d[q * 4 + 3] < 8) continue
          label[q] = 1
          stack[sp++] = q
        }
      }
    }
    if (members.length < minArea) for (const p of members) d[p * 4 + 3] = 0
  }
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
