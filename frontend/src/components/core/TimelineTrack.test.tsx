import { render, screen, fireEvent } from '@testing-library/react'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { ALARM_ACCENT } from '../../tokens'
import type { EventType } from './EventGlyph'
import { TimelineTrack, type TimelineEvent } from './TimelineTrack'

const CYCLE: EventType[] = ['action', 'observation', 'memory_op', 'verification']

function makeEvents(count: number, start = 1): TimelineEvent[] {
  return Array.from({ length: count }, (_, i) => ({
    seq: start + i,
    type: CYCLE[i % CYCLE.length],
    ts: '2026-08-22T09:00:00.000Z',
  }))
}

/** jsdom reports clientWidth 0; give the scroller a real viewport for the
 *  virtualization tests, since "unmeasured" deliberately renders everything. */
function withMeasuredWidth(px: number) {
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get() {
      return px
    },
  })
  return () => {
    if (original) Object.defineProperty(HTMLElement.prototype, 'clientWidth', original)
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth')
  }
}

describe('TimelineTrack', () => {
  it('renders a glyph per event at its seq position', () => {
    render(<TimelineTrack events={makeEvents(6)} />)
    const glyphs = screen.getAllByRole('img')
    expect(glyphs).toHaveLength(6)
    expect(document.querySelector('[data-seq="1"]')).not.toBeNull()
    expect(document.querySelector('[data-seq="6"]')).not.toBeNull()
  })

  it('renders every event when the container is unmeasured, never zero', () => {
    // Guards the SSR / display:none / jsdom path: width 0 must not mean "nothing".
    render(<TimelineTrack events={makeEvents(120)} />)
    expect(screen.getAllByRole('img')).toHaveLength(120)
  })

  it('virtualizes: a 600-event run mounts a small fraction of its glyphs', () => {
    const restore = withMeasuredWidth(900)
    try {
      render(<TimelineTrack events={makeEvents(600)} />)
      const mounted = screen.getAllByRole('img').length
      expect(mounted).toBeGreaterThan(10)
      expect(mounted).toBeLessThan(120)
    } finally {
      restore()
    }
  })

  it('mounts a different slice after scrolling', () => {
    const restore = withMeasuredWidth(900)
    try {
      render(<TimelineTrack events={makeEvents(600)} />)
      expect(document.querySelector('[data-seq="1"]')).not.toBeNull()
      expect(document.querySelector('[data-seq="500"]')).toBeNull()

      const scroller = screen.getByTestId('timeline-scroller')
      fireEvent.scroll(scroller, { target: { scrollLeft: 8800 } })

      expect(document.querySelector('[data-seq="1"]')).toBeNull()
      expect(document.querySelector('[data-seq="500"]')).not.toBeNull()
    } finally {
      restore()
    }
  })

  it('honours an explicit domain', () => {
    const restore = withMeasuredWidth(1000)
    try {
      const { rerender } = render(<TimelineTrack events={makeEvents(20)} />)
      const natural = screen.getByTestId('timeline-scroller').firstElementChild as HTMLElement
      const naturalWidth = natural.style.width

      rerender(<TimelineTrack events={makeEvents(20)} domain={[1, 400]} />)
      const stretched = screen.getByTestId('timeline-scroller').firstElementChild as HTMLElement
      expect(stretched.style.width).not.toBe(naturalWidth)
      // 400 seq at the 18px floor is far wider than the 1000px viewport.
      expect(Number.parseFloat(stretched.style.width)).toBeGreaterThan(7000)
    } finally {
      restore()
    }
  })

  it('draws a rollback arc in the reserved alarm red', () => {
    const { container } = render(
      <TimelineTrack events={makeEvents(30)} arcs={[{ fromSeq: 29, toSeq: 16, id: 'rb-1' }]} />,
    )
    const arc = [...container.querySelectorAll('path')].find(
      (p) => p.getAttribute('stroke') === ALARM_ACCENT && p.getAttribute('d')?.includes('Q'),
    )
    expect(arc).toBeDefined()
  })

  it('draws no arc when none is supplied', () => {
    const { container } = render(<TimelineTrack events={makeEvents(30)} />)
    const arcs = [...container.querySelectorAll('path')].filter((p) =>
      p.getAttribute('d')?.includes('Q'),
    )
    expect(arcs).toHaveLength(0)
  })

  it('pins a playhead only when asked', () => {
    const { container, rerender } = render(<TimelineTrack events={makeEvents(10)} />)
    const countVerticals = () =>
      [...container.querySelectorAll('line')].filter(
        (l) => l.getAttribute('x1') === l.getAttribute('x2'),
      ).length

    expect(countVerticals()).toBe(0)
    rerender(<TimelineTrack events={makeEvents(10)} playhead={7} />)
    expect(countVerticals()).toBe(1)
  })

  it('calls onSelect with the caller’s own event object', () => {
    const onSelect = vi.fn()
    const events = makeEvents(5)
    render(<TimelineTrack events={events} onSelect={onSelect} />)

    fireEvent.click(document.querySelector('[data-seq="3"]') as HTMLElement)
    expect(onSelect).toHaveBeenCalledWith(events[2])
  })

  it('exposes hover-to-inspect detail', () => {
    render(<TimelineTrack events={makeEvents(5)} />)
    fireEvent.mouseEnter(document.querySelector('[data-seq="4"]') as HTMLElement)

    const tooltip = screen.getByRole('status')
    expect(tooltip).toHaveTextContent('seq 4')
    expect(tooltip).toHaveTextContent('Verification')

    fireEvent.mouseLeave(document.querySelector('[data-seq="4"]') as HTMLElement)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('gives every glyph a hit target larger than the mark', () => {
    render(<TimelineTrack events={makeEvents(3)} />)
    const hit = document.querySelector('[data-seq="2"]') as HTMLElement
    expect(Number.parseFloat(hit.style.width)).toBeGreaterThanOrEqual(28)
  })

  it('pulses newly arrived events and leaves settled ones alone', () => {
    const { rerender } = render(<TimelineTrack events={makeEvents(4)} />)
    rerender(<TimelineTrack events={makeEvents(6)} />)

    expect(document.querySelector('[data-seq="2"]')).not.toHaveClass('stream-pulse')
    expect(document.querySelector('[data-seq="6"]')).toHaveClass('stream-pulse')
  })

  it('survives an empty run', () => {
    const { container } = render(<TimelineTrack events={[]} />)
    expect(container.querySelectorAll('[data-seq]')).toHaveLength(0)
  })

  beforeAll(() => {
    vi.stubGlobal('ResizeObserver', undefined)
  })
  afterAll(() => {
    vi.unstubAllGlobals()
  })
})
