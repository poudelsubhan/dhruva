import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import TwinView from './TwinView'
import { coherenceHalfLife } from '../../data/derive'
import type { DhruvaEvent } from '../../contracts'

function verification(seq: number, coherence: number): DhruvaEvent {
  return {
    run_id: 'r',
    seq,
    ts: 't',
    type: 'verification',
    payload: {
      window: [seq - 1, seq],
      alignment: coherence,
      repetition: 1,
      progress: 1,
      coherence,
      verdict: coherence < 0.55 ? 'breach' : coherence < 0.7 ? 'warn' : 'pass',
      rationale: '',
    },
  }
}

/** Supervised holds; unsupervised decays through 0.5 between seq 30 and 40. */
const SUPERVISED = [0.95, 0.9, 0.88, 0.92].map((c, i) => verification(i * 10, c))
const UNSUPERVISED = [0.95, 0.8, 0.6, 0.4].map((c, i) => verification(i * 10, c))

describe('coherenceHalfLife', () => {
  it('interpolates the first crossing of 0.5', () => {
    const points = [
      { seq: 30, coherence: 0.6, verdict: 'warn' as const },
      { seq: 40, coherence: 0.4, verdict: 'breach' as const },
    ]
    // 0.6 -> 0.4 across 10 seq; 0.5 sits exactly halfway.
    expect(coherenceHalfLife(points)).toBeCloseTo(35, 5)
  })

  it('returns null when the curve never crosses', () => {
    expect(coherenceHalfLife([{ seq: 0, coherence: 0.9, verdict: 'pass' }])).toBeNull()
  })

  it('takes the FIRST crossing, not the last', () => {
    const points = [
      { seq: 0, coherence: 0.9, verdict: 'pass' as const },
      { seq: 10, coherence: 0.3, verdict: 'breach' as const },
      { seq: 20, coherence: 0.8, verdict: 'pass' as const },
      { seq: 30, coherence: 0.2, verdict: 'breach' as const },
    ]
    expect(coherenceHalfLife(points)).toBeLessThan(10)
  })
})

describe('TwinView', () => {
  it('renders both curves and reports the unsupervised half-life', () => {
    render(<TwinView supervised={SUPERVISED} unsupervised={UNSUPERVISED} />)
    expect(screen.getByRole('img', { name: /coherence decay/i })).toBeInTheDocument()
    expect(screen.getAllByText(/t½/).length).toBeGreaterThan(0)
  })

  it('says so plainly when the supervised arm never crosses 0.5', () => {
    render(<TwinView supervised={SUPERVISED} unsupervised={UNSUPERVISED} />)
    expect(screen.getByText(/supervised · never crossed 0\.5/)).toBeInTheDocument()
  })

  it('renders a marker at the interpolated crossing, not at a sample point', () => {
    const { container } = render(<TwinView supervised={SUPERVISED} unsupervised={UNSUPERVISED} />)
    const marker = container.querySelector('circle')
    expect(marker).not.toBeNull()
    // Crossing lies strictly between the seq-20 and seq-30 samples.
    const cx = Number(marker?.getAttribute('cx'))
    expect(cx).toBeGreaterThan(0)
  })

  it('shares one x-domain so the two tracks line up', () => {
    render(<TwinView supervised={SUPERVISED} unsupervised={UNSUPERVISED.slice(0, 2)} />)
    expect(screen.getByText('supervised')).toBeInTheDocument()
    expect(screen.getByText('unsupervised')).toBeInTheDocument()
  })
})
