/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { color, durationMs, motion, themeVars } from './tokens'

// Read the stylesheet off disk rather than importing it: vitest is configured
// with `css: false`, which stubs every CSS import (including `?raw`) to an empty
// string. This test must see the real bytes.
const cssSource = readFileSync(join(import.meta.dirname, 'index.css'), 'utf8')

/**
 * The single-source-of-truth guard.
 *
 * tokens.ts is canonical; index.css's `@theme` block mirrors it. This test does
 * not check that either file is "non-empty" — it PARSES the stylesheet, pulls
 * every custom property out of the `@theme` block, and asserts an exact
 * bidirectional match. Adding a token to one file without the other fails here.
 */

/** Extract the body of the top-level `@theme { ... }` block by brace counting. */
function extractThemeBlock(css: string): string {
  const start = css.indexOf('@theme')
  if (start === -1) throw new Error('index.css has no @theme block')

  const open = css.indexOf('{', start)
  if (open === -1) throw new Error('@theme block is missing its opening brace')

  let depth = 0
  for (let i = open; i < css.length; i += 1) {
    const ch = css[i]
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return css.slice(open + 1, i)
    }
  }
  throw new Error('@theme block is never closed')
}

/** Collapse whitespace runs so `cubic-bezier(0.2, 0.8, …)` compares stably. */
function normalize(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

function parseThemeVars(css: string): Record<string, string> {
  const block = extractThemeBlock(css).replace(/\/\*[\s\S]*?\*\//g, '')
  const declarations = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi
  const out: Record<string, string> = {}

  for (const match of block.matchAll(declarations)) {
    const name = match[1]
    if (name in out) throw new Error(`duplicate @theme declaration: ${name}`)
    out[name] = normalize(match[2])
  }
  return out
}

const parsed = parseThemeVars(cssSource)
const canonical = Object.fromEntries(
  Object.entries(themeVars).map(([name, value]) => [name, normalize(value)]),
)

describe('token mirror: tokens.ts <-> index.css @theme', () => {
  it('parses a non-trivial number of custom properties out of the @theme block', () => {
    // Guards the parser itself: a regex that silently matched nothing would
    // make every comparison below vacuously true.
    expect(Object.keys(parsed).length).toBeGreaterThan(40)
    expect(parsed['--color-coherence-400']).toBe('#35dcf2')
  })

  it('declares every tokens.ts token in @theme, with an identical value', () => {
    const missing: string[] = []
    const mismatched: Array<[string, string, string]> = []

    for (const [name, value] of Object.entries(canonical)) {
      if (!(name in parsed)) missing.push(name)
      else if (parsed[name] !== value) mismatched.push([name, value, parsed[name]])
    }

    expect({ missing, mismatched }).toEqual({ missing: [], mismatched: [] })
  })

  it('declares no @theme custom property that tokens.ts does not export', () => {
    const extra = Object.keys(parsed).filter((name) => !(name in canonical))
    expect(extra).toEqual([])
  })

  it('matches key-for-key so neither file can grow a token alone', () => {
    expect(Object.keys(parsed).sort()).toEqual(Object.keys(canonical).sort())
  })
})

describe('token invariants the design direction depends on', () => {
  it('reserves the coherence hue: no other token shares its value', () => {
    const coherence = new Set<string>(Object.values(color.coherence))
    const others = Object.entries(color)
      .filter(([group]) => group !== 'coherence')
      .flatMap(([, group]) => Object.values(group as Record<string, string>))

    expect(others.filter((hex) => coherence.has(hex))).toEqual([])
  })

  it('reserves the alarm hue: no other token shares its value', () => {
    const alarm = new Set<string>(Object.values(color.alarm))
    const others = Object.entries(color)
      .filter(([group]) => group !== 'alarm')
      .flatMap(([, group]) => Object.values(group as Record<string, string>))

    expect(others.filter((hex) => alarm.has(hex))).toEqual([])
  })

  it('exposes motion durations to JS as numbers parsed from the CSS strings', () => {
    expect(durationMs('pulse')).toBe(420)
    expect(`${durationMs('gauge')}ms`).toBe(motion.gauge)
  })
})
