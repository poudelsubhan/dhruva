import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ALARM_ACCENT, COHERENCE_ACCENT, color, type } from '../../tokens'
import { CoherenceGauge, DEFAULT_THRESHOLDS, verdictFor } from './CoherenceGauge'

describe('verdictFor', () => {
  it('splits on the default 0.70 / 0.55 gates', () => {
    expect(verdictFor(0.91, DEFAULT_THRESHOLDS)).toBe('pass')
    expect(verdictFor(0.7, DEFAULT_THRESHOLDS)).toBe('pass')
    expect(verdictFor(0.69, DEFAULT_THRESHOLDS)).toBe('warn')
    expect(verdictFor(0.55, DEFAULT_THRESHOLDS)).toBe('warn')
    expect(verdictFor(0.54, DEFAULT_THRESHOLDS)).toBe('breach')
  })

  it('respects caller-supplied thresholds', () => {
    expect(verdictFor(0.6, { warn: 0.9, breach: 0.5 })).toBe('warn')
    expect(verdictFor(0.6, { warn: 0.5, breach: 0.3 })).toBe('pass')
  })
})

describe('CoherenceGauge', () => {
  it('renders the coherence value on mount, without animating up from zero', () => {
    render(<CoherenceGauge coherence={0.87} />)
    expect(screen.getByText('0.87')).toBeInTheDocument()
  })

  it('clamps out-of-range input rather than drawing off the dial', () => {
    const { rerender } = render(<CoherenceGauge coherence={1.8} />)
    expect(screen.getByText('1.00')).toBeInTheDocument()
    rerender(<CoherenceGauge coherence={-4} />)
    expect(screen.getByText('0.00')).toBeInTheDocument()
  })

  it('paints the arc in the reserved coherence hue while passing', () => {
    const { container } = render(<CoherenceGauge coherence={0.9} />)
    expect(container.querySelector('[data-verdict]')).toHaveAttribute('data-verdict', 'pass')
    const strokes = [...container.querySelectorAll('path')].map((p) => p.getAttribute('stroke'))
    expect(strokes).toContain(COHERENCE_ACCENT)
    expect(strokes).not.toContain(ALARM_ACCENT)
  })

  it('escalates the meter fill to warn, then to the reserved alarm red', () => {
    const { container, rerender } = render(<CoherenceGauge coherence={0.62} />)
    expect(container.querySelector('[data-verdict]')).toHaveAttribute('data-verdict', 'warn')
    expect(
      [...container.querySelectorAll('path')].map((p) => p.getAttribute('stroke')),
    ).toContain(color.state.warn)

    rerender(<CoherenceGauge coherence={0.3} />)
    expect(container.querySelector('[data-verdict]')).toHaveAttribute('data-verdict', 'breach')
    expect(
      [...container.querySelectorAll('path')].map((p) => p.getAttribute('stroke')),
    ).toContain(ALARM_ACCENT)
  })

  it('pairs the status color with an icon and a word, never color alone', () => {
    render(<CoherenceGauge coherence={0.3} />)
    expect(screen.getByText('BREACH')).toBeInTheDocument()
  })

  it('marks both thresholds on the dial', () => {
    const { container } = render(<CoherenceGauge coherence={0.8} />)
    const tickStrokes = [...container.querySelectorAll('line')].map((l) => l.getAttribute('stroke'))
    expect(tickStrokes).toContain(ALARM_ACCENT)
    expect(tickStrokes).toContain(color.state.warn)
  })

  it('renders a sparkline only when given at least two points', () => {
    const series = [0.94, 0.88, 0.66, 0.58, 0.41, 0.86, 0.93]
    const { container, rerender } = render(
      <CoherenceGauge coherence={0.93} sparkline={series} />,
    )
    expect(
      screen.getByRole('img', { name: /Coherence trend over the last 7 verification windows/ }),
    ).toBeInTheDocument()

    rerender(<CoherenceGauge coherence={0.93} sparkline={[0.93]} />)
    expect(container.querySelector('svg[aria-label^="Coherence trend"]')).toBeNull()
  })

  it('sizes the hero readout to the readout type token at the default size', () => {
    render(<CoherenceGauge coherence={0.5} />)
    // type.readout is 3.5rem = 56px, and 200 * 0.28 = 56.
    expect(type.readout).toBe('3.5rem')
    expect(screen.getByText('0.50')).toHaveStyle({ fontSize: '56px' })
  })

  it('honours the size prop', () => {
    const { container } = render(<CoherenceGauge coherence={0.5} size={120} />)
    const dial = container.querySelector('svg[role="img"]')
    expect(dial).toHaveAttribute('width', '120')
  })
})
