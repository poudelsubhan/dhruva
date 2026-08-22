import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import GraphView from './GraphView'
import type { DhruvaEvent } from '../../contracts'

const EVENTS: DhruvaEvent[] = [
  { run_id: 'r', seq: 0, ts: 't', type: 'task_start', payload: { task: 'loglens', mode: 'supervised', spec_hash: 'a' } },
  { run_id: 'r', seq: 1, ts: 't', type: 'action', payload: { step: 1, description: 'read', tool: 'read_file', args_digest: 'd' } },
  { run_id: 'r', seq: 2, ts: 't', type: 'observation', payload: { tool: 'read_file', result_digest: 'r', poisoned: false } },
  { run_id: 'r', seq: 3, ts: 't', type: 'learning', payload: { entry_id: 'a'.repeat(16), kind: 'fact', text: 'x', confidence: 0.9, source_seqs: [2] } },
  { run_id: 'r', seq: 4, ts: 't', type: 'checkpoint', payload: { id: 'ckpt-01', seq_range: [0, 4], parent_hash: 'p', hash: 'h' } },
  { run_id: 'r', seq: 5, ts: 't', type: 'checkpoint', payload: { id: 'ckpt-02', seq_range: [5, 6], parent_hash: 'h', hash: 'h2' } },
  { run_id: 'r', seq: 6, ts: 't', type: 'breach', payload: { verification_ref: 5, rule_fired: 'below_breach_threshold' } },
  { run_id: 'r', seq: 7, ts: 't', type: 'rollback', payload: { from_seq: 6, target_checkpoint_id: 'ckpt-01', discarded_range: [5, 6] } },
]

describe('GraphView', () => {
  it('renders a node per event', () => {
    const { container } = render(<GraphView events={EVENTS} />)
    expect(container.querySelectorAll('foreignObject')).toHaveLength(EVENTS.length)
  })

  it('draws the hash chain between consecutive checkpoints', () => {
    const { container } = render(<GraphView events={EVENTS} />)
    const dashed = [...container.querySelectorAll('path')].filter(
      (p) => p.getAttribute('stroke-dasharray') === '3 3',
    )
    expect(dashed.length).toBeGreaterThanOrEqual(1)
  })

  it('draws the rollback edge back to the checkpoint it restored', () => {
    const { container } = render(<GraphView events={EVENTS} />)
    // A quadratic curve is the rollback's signature; flow edges are cubic.
    const arcs = [...container.querySelectorAll('path')].filter((p) => p.getAttribute('d')?.includes('Q'))
    expect(arcs).toHaveLength(1)
  })

  it('links a learning back to the observation it came from', () => {
    const { container } = render(<GraphView events={EVENTS} />)
    const flows = [...container.querySelectorAll('path')].filter((p) => p.getAttribute('d')?.includes('C'))
    expect(flows.length).toBeGreaterThanOrEqual(2) // action->observation, observation->learning
  })

  it('uses a fixed layout — two renders place nodes identically', () => {
    // A graph that wobbles between renders cannot be pointed at while talking.
    const first = render(<GraphView events={EVENTS} />)
    const a = [...first.container.querySelectorAll('g[transform]')].map((g) => g.getAttribute('transform'))
    first.unmount()
    const second = render(<GraphView events={EVENTS} />)
    const b = [...second.container.querySelectorAll('g[transform]')].map((g) => g.getAttribute('transform'))
    expect(a).toEqual(b)
  })

  it('opens an inspector on click', async () => {
    const { container } = render(<GraphView events={EVENTS} />)
    const node = container.querySelector('g[transform] rect') as Element
    await userEvent.click(node)
    expect(screen.getByText(/node · seq/)).toBeInTheDocument()
  })

  it('says so plainly when there is nothing to draw', () => {
    render(<GraphView events={[]} />)
    expect(screen.getByText(/no events yet/i)).toBeInTheDocument()
  })
})
