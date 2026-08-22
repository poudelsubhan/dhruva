import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Panel } from './Panel'

describe('Panel', () => {
  it('renders its title and body', () => {
    render(
      <Panel title="Coherence">
        <p>body content</p>
      </Panel>,
    )
    expect(screen.getByRole('heading', { name: 'Coherence' })).toBeInTheDocument()
    expect(screen.getByText('body content')).toBeInTheDocument()
  })

  it('renders the status slot only when one is given', () => {
    const { rerender } = render(<Panel title="Timeline">body</Panel>)
    expect(screen.queryByText('1 breach')).toBeNull()

    rerender(
      <Panel title="Timeline" status={<span>1 breach</span>}>
        body
      </Panel>,
    )
    expect(screen.getByText('1 breach')).toBeInTheDocument()
  })

  it('merges a caller className onto the frame', () => {
    const { container } = render(
      <Panel title="Twin" className="col-span-2">
        body
      </Panel>,
    )
    const section = container.querySelector('section')
    expect(section).toHaveClass('col-span-2')
    expect(section).toHaveClass('bg-base-800')
  })
})
