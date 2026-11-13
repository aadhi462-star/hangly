// AI background removal with a local segmentation model (ormbg, Apache-2.0).
// Inference runs on this Mac (WebGPU when available, otherwise WebAssembly).
// Only the model weights are downloaded, once, from Hugging Face; images are
// never uploaded anywhere.
import ortMjs from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url'
import ortWasm from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url'
import { ctx2d } from './imageOps'

export const AI_MODEL = { id: 'onnx-community/ormbg-ONNX', sizeMb: 176, name: 'ormbg' }

export interface AiProgress {
  stage: 'download' | 'load' | 'run'
  /** 0..1 while downloading */
  progress?: number
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
  return pipeline('background-removal', AI_MODEL.id, { dtype: 'fp32', device, progress_callback }) as unknown as Promise<Segmenter>
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
