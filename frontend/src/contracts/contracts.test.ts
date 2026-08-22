import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { EVENT_TYPES, isEvent, parseEventLine, type DhruvaEvent } from './index'

const schema = JSON.parse(readFileSync('../shared/schema/run_event.schema.json', 'utf8'))

describe('contract drift', () => {
  it('EVENT_TYPES matches the canonical schema element-for-element', () => {
    expect([...EVENT_TYPES]).toEqual(schema.$defs.EventType.enum)
  })

  it('LearningKind matches the schema', () => {
    expect(schema.$defs.LearningKind.enum).toEqual([
      'fact',
      'constraint',
      'failed_approach',
      'resource',
      'api_shape',
    ])
  })
})

describe('mock fixtures', () => {
  const load = (name: string): DhruvaEvent[] =>
    readFileSync(`../fixtures/mock/${name}.jsonl`, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(parseEventLine)

  it.each(['happy', 'breach'])('%s parses with gapless monotonic seq', (name) => {
    const events = load(name)
    expect(events.length).toBeGreaterThan(20)
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i))
    for (const e of events) expect(EVENT_TYPES).toContain(e.type)
  })

  it('breach run: every evicted learning traces to a poisoned seq, no retained one does', () => {
    const events = load('breach')
    const poison = new Set(
      events
        .filter((e) => (isEvent('observation')(e) && e.payload.poisoned) || isEvent('injection')(e))
        .map((e) => e.seq),
    )
    const sources = new Map(
      events.filter(isEvent('learning')).map((e) => [e.payload.entry_id, e.payload.source_seqs]),
    )
    const audit = events.find(isEvent('ledger_audit'))!
    const touches = (id: string) => (sources.get(id) ?? []).some((s) => poison.has(s))

    expect(audit.payload.evicted.length).toBeGreaterThan(0)
    expect(audit.payload.retained.filter(touches)).toEqual([])
    expect(audit.payload.evicted.filter((x) => !touches(x.entry_id))).toEqual([])
  })

  it('breach run: the rollback target is a confirmed checkpoint (v3 rule)', () => {
    const events = load('breach')
    const rollback = events.find(isEvent('rollback'))!
    const target = events
      .filter(isEvent('checkpoint'))
      .find((c) => c.payload.id === rollback.payload.target_checkpoint_id)
    expect(target?.payload.confirmed).toBe(true)
  })
})
