import './electron-mock'
import { describe, expect, it } from 'vitest'
import { BUILT_IN_CHARACTERS, DEFAULT_SETTINGS, newInstance } from '../src/shared/defaults'
import { mergeKnown, sanitizeInstance, sanitizeSettings } from '../src/main/store'
import { sanitizeDefinition, saveCustomCharacter } from '../src/main/asset-manager'
import type { CharacterDefinition } from '../src/shared/types'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])

describe('IPC validation (mergeKnown)', () => {
  it('ignores unknown keys and type changes', () => {
    const base = { a: 1, nested: { b: 'x' } }
    const out = mergeKnown(base, { a: 'evil', c: 3, nested: { b: 'ok', z: 1 } })
    expect(out).toEqual({ a: 1, nested: { b: 'ok' } })
  })

  it('rejects non-finite numbers', () => {
    expect(mergeKnown({ n: 2 }, { n: Infinity })).toEqual({ n: 2 })
  })
})

describe('sanitizers', () => {
  it('clamps character settings into safe ranges', () => {
    const i = newInstance(BUILT_IN_CHARACTERS[0], 1, 1000)
    i.appearance.scale = 50
    i.appearance.opacity = -1
    i.hanging.threadColor = 'red; background:url(x)'
    i.affection = 900
    const s = sanitizeInstance(i)
    expect(s.appearance.scale).toBe(2)
    expect(s.appearance.opacity).toBe(0.1)
    expect(s.hanging.threadColor).toMatch(/^#[0-9a-f]{6}$/i)
    expect(s.affection).toBe(100)
  })

  it('keeps global settings valid', () => {
    const s = sanitizeSettings({ ...DEFAULT_SETTINGS, maxCharacters: 999, fps: 7 as never, shortcuts: { ...DEFAULT_SETTINGS.shortcuts, openPanel: '<script>' } })
    expect(s.maxCharacters).toBe(24)
    expect(s.fps).toBe(30)
    expect(s.shortcuts.openPanel).toBe(DEFAULT_SETTINGS.shortcuts.openPanel)
  })
})

describe('custom character files', () => {
  const def = (files: string[]): CharacterDefinition => ({
    id: '', name: 'Test', category: 'custom', builtIn: false, kind: 'image', behaviours: ['walk'], defaultBehaviour: 'walk',
    baseSize: 100, defaultOpacity: 1, defaultSpeed: 60, facing: 'right',
    animations: { idle: { loop: true, frames: files.map((file) => ({ file, duration: 100 })) } }
  })

  it('drops frames that point outside the character folder', () => {
    const d = sanitizeDefinition(def(['../../settings/state.json', 'processed/ok.png']), 'c_x')
    expect(d.animations?.idle?.frames.map((f) => f.file)).toEqual(['processed/ok.png'])
  })

  it('refuses path traversal in file names', () => {
    const r = saveCustomCharacter({ definition: def(['processed/a.png']), files: { '../evil.png': PNG } })
    expect(r.ok).toBe(false)
  })

  it('refuses files that are not images', () => {
    const r = saveCustomCharacter({ definition: def(['processed/a.png']), files: { 'processed/a.png': new TextEncoder().encode('#!/bin/sh\nrm -rf ~') } })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/not a supported image/)
  })

  it('saves a valid character', () => {
    const r = saveCustomCharacter({ definition: { ...def(['processed/a.png']), legLine: 5 }, files: { 'processed/a.png': PNG } })
    expect(r.ok).toBe(true)
  })

  it('clamps the leg line', () => {
    expect(sanitizeDefinition({ ...def(['processed/a.png']), legLine: 5 }, 'c_x').legLine).toBe(0.95)
    expect(sanitizeDefinition({ ...def(['processed/a.png']), legLine: 0 }, 'c_x').legLine).toBeUndefined()
  })
})
