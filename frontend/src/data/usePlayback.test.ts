import { describe, expect, it } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { usePlayback } from './usePlayback'
import type { DhruvaEvent } from '../contracts'

const ev = (seq: number, type: DhruvaEvent['type'], payload = {}): DhruvaEvent =>
  ({ run_id: 'r', seq, ts: 't', type, payload }) as DhruvaEvent

const RUN: DhruvaEvent[] = [
  ev(0, 'task_start', { task: 'x', mode: 'supervised', spec_hash: 'a' }),
  ev(1, 'action', { step: 1, description: 'd', tool: 't', args_digest: 'x' }),
  ev(2, 'injection', { scenario: 's1', at_step: 1 }),
  ev(3, 'breach', { verification_ref: 1, rule_fired: 'below_breach_threshold' }),
  ev(4, 'rollback', { from_seq: 3, target_checkpoint_id: 'c', discarded_range: [1, 3] }),
]

describe('usePlayback', () => {
  it('starts paused at the first event', () => {
    const { result } = renderHook(() => usePlayback(RUN, 1000))
    expect(result.current.index).toBe(0)
    expect(result.current.playing).toBe(false)
  })

  it('seeking pauses, so a presenter can stop on a beat and talk', () => {
    const { result } = renderHook(() => usePlayback(RUN, 1000))
    act(() => result.current.play())
    act(() => result.current.seek(3))
    expect(result.current.index).toBe(3)
    expect(result.current.playing).toBe(false)
  })

  it('clamps a seek past the end', () => {
    const { result } = renderHook(() => usePlayback(RUN, 1000))
    act(() => result.current.seek(999))
    expect(result.current.index).toBe(RUN.length - 1)
    expect(result.current.atEnd).toBe(true)
  })

  it('restart returns to the beginning and plays', () => {
    const { result } = renderHook(() => usePlayback(RUN, 1000))
    act(() => result.current.seek(4))
    act(() => result.current.restart())
    expect(result.current.index).toBe(0)
    expect(result.current.playing).toBe(true)
  })

  it('handles an empty run without dividing by zero', () => {
    const { result } = renderHook(() => usePlayback([], 1000))
    expect(result.current.progress).toBe(0)
    expect(result.current.atEnd).toBe(false)
    act(() => result.current.play())
    expect(result.current.index).toBe(0)
  })
})
