import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { EVENT_LABELS, EVENT_TYPES, EventGlyph } from './EventGlyph'

describe('EventGlyph', () => {
  it('renders a labelled glyph for the requested type', () => {
    render(<EventGlyph type="checkpoint" />)
    const glyph = screen.getByRole('img', { name: 'Checkpoint' })
    expect(glyph).toHaveAttribute('data-event-type', 'checkpoint')
  })

  it('covers all 17 frozen event types', () => {
    expect(EVENT_TYPES).toHaveLength(17)
    for (const type of EVENT_TYPES) {
      const { unmount } = render(<EventGlyph type={type} />)
      expect(screen.getByRole('img', { name: EVENT_LABELS[type] })).toBeInTheDocument()
      unmount()
    }
  })

  it('draws a geometrically distinct shape for every type', () => {
    // Shape is the identity channel, so no two glyphs may share a path set.
    const drawn = new Map<string, string>()
    for (const type of EVENT_TYPES) {
      const { container, unmount } = render(<EventGlyph type={type} />)
      const svg = container.querySelector('svg')
      const geometry = [...(svg?.querySelectorAll('path, circle, rect') ?? [])]
        .map((node) => node.outerHTML)
        .join('|')

      expect(geometry.length).toBeGreaterThan(0)
      const clash = drawn.get(geometry)
      expect(clash, `${type} draws the same geometry as ${clash}`).toBeUndefined()
      drawn.set(geometry, type)
      unmount()
    }
    expect(drawn.size).toBe(17)
  })

  it('honours the size prop', () => {
    const { container } = render(<EventGlyph type="action" size={16} />)
    const svg = container.querySelector('svg')
    expect(svg).toHaveAttribute('width', '16')
    expect(svg).toHaveAttribute('height', '16')
    // The viewBox never changes, so strokes scale proportionally at any size.
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24')
  })

  it('marks poisoned events with a strike and says so in the label', () => {
    const { container } = render(<EventGlyph type="observation" poisoned />)
    const svg = container.querySelector('svg')
    expect(svg).toHaveAttribute('data-poisoned', 'true')
    expect(svg).toHaveClass('text-state-warn')
    expect(screen.getByRole('img', { name: 'Observation (poisoned)' })).toBeInTheDocument()
  })

  it('reserves alarm red for breach and rollback only', () => {
    for (const type of EVENT_TYPES) {
      const { container, unmount } = render(<EventGlyph type={type} />)
      const svg = container.querySelector('svg')
      const isAlarm = svg?.classList.contains('text-alarm-400') ?? false
      expect(isAlarm, `${type} tone`).toBe(type === 'breach' || type === 'rollback')
      unmount()
    }
  })

  it('appends a caller className without dropping its own tone', () => {
    const { container } = render(<EventGlyph type="verification" className="text-state-pass" />)
    const svg = container.querySelector('svg')
    expect(svg).toHaveClass('text-state-pass')
  })
})
