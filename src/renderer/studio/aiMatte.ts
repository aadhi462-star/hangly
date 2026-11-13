// AI background removal with a local segmentation model (ormbg, Apache-2.0).
// Inference runs on this Mac (WebGPU when available, otherwise WebAssembly).
// Only the model files are downloaded, once, from Hugging Face; images are
// never uploaded anywhere. The download is pinned to one commit of the model
// repository and every file is checked against its SHA-256 before it is used.
import ortMjs from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url'
import ortWasm from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url'
import { ctx2d } from './imageOps'

export const AI_MODEL = { id: 'onnx-community/ormbg-ONNX', sizeMb: 176, name: 'ormbg' }

export interface AiProgress {
  stage: 'download' | 'load' | 'run'
  /** 0..1 while downloading */
  progress?: number
}

/** The exact commit of onnx-community/ormbg-ONNX that was reviewed. */
const MODEL_REVISION = '034e2d884afbab897e10e78fc5bb566b29533fd6'
/** SHA-256 of every file the pipeline loads at that commit. Anything else is refused. */
const PINNED_FILES: Record<string, string> = {
  'config.json': 'd0b94ab052ace79177085c66a00a3f014a973edb09999cb0108bb01e65ded060',
  'preprocessor_config.json': 'ed502c6ea29c5fb8aafdafdc5bcf1657dfca09888ff753e5c358672ebcfd448d',
  'onnx/model.onnx': '2830b6f461809cdc7e2f15d19fc1a898b14ad53504640d4147b525d53ebb09c9'
}
const CACHE_NAME = 'screenly-models-v1'

export class IntegrityError extends Error {}

/** The pinned file a URL refers to, or null if it isn't one of them. */
function pinnedFile(url: string): string | null {
  const prefix = `https://huggingface.co/${AI_MODEL.id}/resolve/${MODEL_REVISION}/`
  if (!url.startsWith(prefix)) return null
  const file = decodeURIComponent(url.slice(prefix.length).split('?')[0])
  return file in PINNED_FILES ? file : null
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Returns the bytes as a Response only if their fingerprint matches the pinned one. */
async function verified(file: string, bytes: ArrayBuffer): Promise<Response> {
  const got = await sha256(bytes)
  if (got !== PINNED_FILES[file]) {
    throw new IntegrityError(
      `The AI model file "${file}" failed its integrity check (got ${got.slice(0, 12)}…, ${bytes.byteLength} bytes), so it was not used`
    )
  }
  return new Response(bytes, { status: 200, headers: { 'content-length': String(bytes.byteLength) } })
}

/** Downloads a pinned file with progress, then verifies it. Any other URL is refused. */
function verifyingFetch(onProgress: (p: AiProgress) => void) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const file = pinnedFile(url)
    if (!file) throw new IntegrityError(`Blocked an unexpected download: ${url}`)
    // Size probes (HEAD or a byte-range request) only read metadata; full downloads are verified below.
    const headers = new Headers(init?.headers)
    if (init?.method === 'HEAD' || headers.has('range')) return fetch(url, init)
    const res = await fetch(url, init)
    if (!res.ok || !res.body) return res
    const total = Number(res.headers.get('content-length')) || 0
    const reader = res.body.getReader()
    const chunks: Uint8Array[] = []
    let loaded = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      loaded += value.byteLength
      if (total && file.endsWith('.onnx')) onProgress({ stage: 'download', progress: loaded / total })
    }
    const bytes = new Uint8Array(loaded)
    let at = 0
    for (const c of chunks) {
      bytes.set(c, at)
      at += c.byteLength
    }
    return verified(file, bytes.buffer)
  }
}

/** Keeps verified files between sessions and re-checks them every time they are read back. */
const verifyingCache = {
  async match(key: string): Promise<Response | undefined> {
    const file = pinnedFile(key)
    if (!file) return undefined
    const cache = await caches.open(CACHE_NAME)
    const hit = await cache.match(key)
    if (!hit) return undefined
    try {
      return await verified(file, await hit.arrayBuffer())
    } catch {
      // Modified on disk: throw it away and download a fresh, verified copy.
      await cache.delete(key)
      return undefined
    }
  },
  async put(key: string, response: Response): Promise<void> {
    if (!pinnedFile(key)) return
    const cache = await caches.open(CACHE_NAME)
    await cache.put(key, response)
  }
}

type Segmenter = (input: unknown) => Promise<{ width: number; height: number; channels: number; data: Uint8ClampedArray }>
type Device = 'webgpu' | 'wasm'

const segmenters = new Map<Device, Promise<Segmenter>>()
/** Set once WebGPU fails on this machine (some GPUs lack the shader limits the model needs). */
let gpuBroken = false
const USE_WEBGPU = false

async function load(device: Device, onProgress: (p: AiProgress) => void): Promise<Segmenter> {
  const { env, pipeline } = await import('@huggingface/transformers')
  // Use the runtime files bundled with the app instead of a CDN.
  const wasm = env.backends.onnx.wasm as { wasmPaths?: unknown } | undefined
  if (wasm) wasm.wasmPaths = { mjs: ortMjs, wasm: ortWasm }
  env.allowLocalModels = false
  // Some loaders ignore the revision option, so pin the commit in the URL pattern itself.
  env.remoteHost = 'https://huggingface.co/'
  env.remotePathTemplate = `{model}/resolve/${MODEL_REVISION}/`
  // Every model file goes through the verifying download and cache above.
  env.fetch = verifyingFetch(onProgress) as typeof env.fetch
  env.useBrowserCache = false
  env.useCustomCache = typeof caches !== 'undefined'
  env.customCache = env.useCustomCache ? (verifyingCache as unknown as typeof env.customCache) : null

  const files = new Map<string, { loaded: number; total: number }>()
  const progress_callback = (e: { status: string; file?: string; loaded?: number; total?: number }): void => {
    if (e.status === 'progress' && e.file && e.total) {
      files.set(e.file, { loaded: e.loaded ?? 0, total: e.total })
      let loaded = 0
      let total = 0
      for (const f of files.values()) {
        loaded += f.loaded
        total += f.total
      }
      onProgress({ stage: 'download', progress: total ? loaded / total : 0 })
    } else if (e.status === 'ready') onProgress({ stage: 'load' })
  }
  return pipeline('background-removal', AI_MODEL.id, { dtype: 'fp32', device, revision: MODEL_REVISION, progress_callback }) as unknown as Promise<Segmenter>
}

function segmenter(device: Device, onProgress: (p: AiProgress) => void): Promise<Segmenter> {
  let s = segmenters.get(device)
  if (!s) {
    s = load(device, onProgress)
    s.catch(() => segmenters.delete(device))
    segmenters.set(device, s)
  }
  return s
}

async function hasGpu(): Promise<boolean> {
  // WebGPU is opt-in: on some Macs the model exceeds the GPU's shader limits and
  // the runtime keeps using WebGPU even for a 'wasm' session, so CPU is the default.
  if (!USE_WEBGPU || gpuBroken || !('gpu' in navigator)) return false
  const gpu = (navigator as unknown as { gpu: { requestAdapter(): Promise<unknown> } }).gpu
  return !!(await gpu.requestAdapter().catch(() => null))
}

/**
 * Cut out the subject: the model's soft mask becomes the canvas alpha (never
 * raising existing alpha). Returns the share of pixels made transparent.
 */
export async function aiRemoveBackground(c: HTMLCanvasElement, onProgress: (p: AiProgress) => void): Promise<number> {
  const { RawImage } = await import('@huggingface/transformers')
  const input = RawImage.fromCanvas(c)
  let out: Awaited<ReturnType<Segmenter>>
  if (await hasGpu()) {
    try {
      const run = await segmenter('webgpu', onProgress)
      onProgress({ stage: 'run' })
      out = await run(input)
    } catch (err) {
      console.warn('[studio] WebGPU inference failed, using the CPU instead', err)
      gpuBroken = true
      const run = await segmenter('wasm', onProgress)
      onProgress({ stage: 'run' })
      out = await run(input)
    }
  } else {
    const run = await segmenter('wasm', onProgress)
    onProgress({ stage: 'run' })
    out = await run(input)
  }
  const { width: w, height: h } = c
  if (out.width !== w || out.height !== h || out.channels !== 4) throw new Error('Unexpected mask size from the model.')
  const mask = fillInteriorHoles(out.data, w, h)
  const g = ctx2d(c)
  const img = g.getImageData(0, 0, w, h)
  let cleared = 0
  for (let p = 0; p < w * h; p++) {
    const a = mask[p]
    if (a < img.data[p * 4 + 3]) img.data[p * 4 + 3] = a
    if (a < 8) cleared++
  }
  g.putImageData(img, 0, 0)
  return cleared / (w * h)
}

/**
 * Models sometimes make light details inside the subject (a silver chest
 * emblem, eye lenses) partly transparent. A real soft edge always sits next to
 * clear background, so translucent pixels with no clear background within a
 * few pixels are made solid. Gaps the model is sure about (alpha ≈ 0) stay open.
 */
function fillInteriorHoles(rgba: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const reach = 4
  const mask = new Uint8ClampedArray(w * h)
  const dist = new Uint8Array(w * h).fill(255)
  const queue = new Int32Array(w * h)
  let head = 0
  let tail = 0
  for (let p = 0; p < w * h; p++) {
    mask[p] = rgba[p * 4 + 3]
    if (mask[p] < 10) {
      dist[p] = 0
      queue[tail++] = p
    }
  }
  while (head < tail) {
    const p = queue[head++]
    const nd = dist[p] + 1
    if (nd > reach) continue
    const x = p % w
    for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) {
      if (q < 0 || q >= w * h || dist[q] <= nd) continue
      dist[q] = nd
      queue[tail++] = q
    }
  }
  for (let p = 0; p < w * h; p++) if (mask[p] < 255 && dist[p] > reach) mask[p] = 255
  return mask
}
