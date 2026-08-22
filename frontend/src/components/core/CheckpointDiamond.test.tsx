import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { CheckpointDiamond } from './CheckpointDiamond'

describe('CheckpointDiamond', () => {
  it('renders the id, seq and verified state', () => {
    render(<CheckpointDiamond checkpointId="ckpt-02" verified seq={16} />)
    const marker = screen.getByLabelText('Checkpoint ckpt-02 at seq 16, verified')
    expect(marker).toHaveAttribute('data-checkpoint-id', 'ckpt-02')
    expect(marker).toHaveAttribute('data-verified', 'true')
    expect(screen.getByText('seq 16')).toBeInTheDocument()
  })

  it('distinguishes unverified checkpoints by fill weight, not by hue', () => {
    const { container, rerender } = render(
      <CheckpointDiamond checkpointId="ckpt-01" verified seq={9} />,
    )
    const solid = container.querySelector('path[fill="currentColor"]')
    expect(solid).not.toBeNull()

    rerender(<CheckpointDiamond checkpointId="ckpt-01" verified={false} seq={9} />)
    expect(container.querySelector('path[fill="currentColor"]')).toBeNull()
    expect(container.querySelector('path[stroke-dasharray]')).not.toBeNull()
    expect(screen.getByLabelText(/unverified/)).toHaveAttribute('data-verified', 'false')
  })

  it('carries a chain-link affordance to the parent hash', () => {
    const { container } = render(<CheckpointDiamond checkpointId="ckpt-03" verified seq={40} />)
    // chain-link svg + diamond svg
    expect(container.querySelectorAll('svg')).toHaveLength(2)
  })

  it('is a plain marker without onClick and a button with it', () => {
    const { rerender } = render(<CheckpointDiamond checkpointId="ckpt-01" verified seq={9} />)
    expect(screen.queryByRole('button')).toBeNull()

    const onClick = vi.fn()
    rerender(<CheckpointDiamond checkpointId="ckpt-01" verified seq={9} onClick={onClick} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledWith('ckpt-01')
  })

  it('truncates a long id on screen but keeps the full value reachable', () => {
    render(<CheckpointDiamond checkpointId="ckpt-0000000000009d4" verified seq={12} />)
    expect(screen.getByText('ckpt-0000…')).toBeInTheDocument()
    expect(screen.getByTitle('ckpt-0000000000009d4')).toBeInTheDocument()
  })
})
