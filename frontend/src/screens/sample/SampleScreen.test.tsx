import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { EVENT_TYPES } from '../../components/core'
import { SampleScreen } from './SampleScreen'
import { SAMPLE_ARCS, SAMPLE_CHECKPOINTS, SAMPLE_COHERENCE, SAMPLE_RUN } from './fixture'

describe('sample run fixture', () => {
  it('is a monotonic seq run of ~40 events', () => {
    expect(SAMPLE_RUN.length).toBeGreaterThanOrEqual(38)
    expect(SAMPLE_RUN.length).toBeLessThanOrEqual(45)
    for (let i = 1; i < SAMPLE_RUN.length; i += 1) {
      expect(SAMPLE_RUN[i].seq).toBeGreaterThan(SAMPLE_RUN[i - 1].seq)
    }
  })

  it('only uses frozen event types and ISO timestamps', () => {
    for (const event of SAMPLE_RUN) {
      expect(EVENT_TYPES).toContain(event.type)
      expect(event.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
      expect(event.run_id).toBe('run_sample_a1')
    }
  })

  it('carries 3 checkpoints, one breach and one rollback', () => {
    const count = (t: string) => SAMPLE_RUN.filter((e) => e.type === t).length
    expect(count('checkpoint')).toBe(3)
    expect(count('breach')).toBe(1)
    expect(count('rollback')).toBe(1)
    expect(SAMPLE_CHECKPOINTS).toHaveLength(3)
  })

  it('decays coherence into a breach and recovers', () => {
    expect(SAMPLE_COHERENCE.length).toBeGreaterThanOrEqual(5)
    expect(Math.min(...SAMPLE_COHERENCE)).toBeLessThan(0.55)
    expect(SAMPLE_COHERENCE[0]).toBeGreaterThan(0.9)
    expect(SAMPLE_COHERENCE[SAMPLE_COHERENCE.length - 1]).toBeGreaterThan(0.9)
  })

  it('points the rollback arc back at the second checkpoint', () => {
    const rollback = SAMPLE_RUN.find((e) => e.type === 'rollback')
    expect(rollback?.payload.target_checkpoint_id).toBe('ckpt-02')
    expect(SAMPLE_ARCS[0].toSeq).toBe(SAMPLE_CHECKPOINTS[1].seq)
    expect(SAMPLE_ARCS[0].fromSeq).toBe(SAMPLE_RUN.find((e) => e.type === 'breach')?.seq)
  })
})

describe('SampleScreen', () => {
  it('composes all five core components', () => {
    const { container } = render(<SampleScreen />)

    // Panel x5
    expect(container.querySelectorAll('section')).toHaveLength(5)
    // TimelineTrack
    expect(screen.getByTestId('timeline-scroller')).toBeInTheDocument()
    // CoherenceGauge — the run ends coherent
    expect(screen.getByText('0.93')).toBeInTheDocument()
    expect(screen.getByText('PASS')).toBeInTheDocument()
    // CheckpointDiamond x4 (three minted, one pending)
    expect(container.querySelectorAll('[data-checkpoint-id]')).toHaveLength(4)
    // EventGlyph — the whole 17-type index is on screen
    expect(container.querySelectorAll('[data-event-type]').length).toBeGreaterThanOrEqual(17)
  })

  it('wires the timeline selection through to the inspector', () => {
    render(<SampleScreen />)
    expect(screen.getByText(/Select an event on the track/)).toBeInTheDocument()

    fireEvent.click(document.querySelector('[data-seq="29"]') as HTMLElement)
    expect(screen.getByText(/"rule_fired": "C < theta_breach"/)).toBeInTheDocument()
    expect(screen.getByText('seq 29 · 09:02:54')).toBeInTheDocument()
  })

  it('wires checkpoint clicks', () => {
    render(<SampleScreen />)
    expect(screen.getByText('click a checkpoint to pin it')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText(/Checkpoint ckpt-02/))
    expect(screen.getByText('pinned: ckpt-02')).toBeInTheDocument()
  })

  it('renders without console errors', () => {
    const errors: unknown[] = []
    const original = console.error
    console.error = (...args: unknown[]) => errors.push(args)
    try {
      render(<SampleScreen />)
    } finally {
      console.error = original
    }
    expect(errors).toEqual([])
  })
})
