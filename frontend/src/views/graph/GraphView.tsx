/**
 * Temporal provenance graph.
 *
 * A time-layered DAG: x is the seq bucket, y is a lane by kind. Layout is fixed and computed —
 * no force simulation — because a graph that wobbles every render is unreadable on a projector and
 * impossible to point at while talking.
 *
 * Edges carry the causal story the timeline cannot: action -> its observation, observation ->
 * the learning it produced, checkpoint -> its parent (the hash chain, drawn as links), and the
 * rollback drawn in alarm red back to the checkpoint it restored.
 */

import { useMemo, useState } from 'react'
import { EventGlyph, Panel } from '../../components/core'
import type { DhruvaEvent } from '../../contracts'
import { color } from '../../tokens'

export interface GraphViewProps {
  events: readonly DhruvaEvent[]
}

type Lane = 'agent' | 'tool' | 'memory' | 'checkpoint'

const LANES: { key: Lane; label: string }[] = [
  { key: 'agent', label: 'agent' },
  { key: 'tool', label: 'tool' },
  { key: 'memory', label: 'knowledge' },
  { key: 'checkpoint', label: 'checkpoint' },
]

const LANE_OF: Record<string, Lane> = {
  task_start: 'agent',
  action: 'agent',
  verification: 'agent',
  breach: 'agent',
  resume: 'agent',
  task_complete: 'agent',
  observation: 'tool',
  injection: 'tool',
  memory_op: 'memory',
  learning: 'memory',
  ledger_audit: 'memory',
  quarantine: 'memory',
  checkpoint: 'checkpoint',
  rollback: 'checkpoint',
  swarm_checkpoint: 'checkpoint',
  swarm_verification: 'checkpoint',
  bulletin: 'memory',
}

const COL = 34
const ROW = 62
const PAD = { left: 92, top: 26 }

interface Node {
  event: DhruvaEvent
  x: number
  y: number
  lane: Lane
}

interface Edge {
  from: Node
  to: Node
  kind: 'flow' | 'chain' | 'rollback'
}

function build(events: readonly DhruvaEvent[]): { nodes: Node[]; edges: Edge[]; width: number } {
  const nodes: Node[] = events.map((event, index) => {
    const lane = LANE_OF[event.type] ?? 'agent'
    return {
      event,
      lane,
      x: PAD.left + index * COL,
      y: PAD.top + LANES.findIndex((l) => l.key === lane) * ROW,
    }
  })
  const bySeq = new Map(nodes.map((n) => [n.event.seq, n]))
  const byCheckpointId = new Map<string, Node>()
  for (const node of nodes) {
    if (node.event.type === 'checkpoint') {
      byCheckpointId.set((node.event.payload as { id: string }).id, node)
    }
  }

  const edges: Edge[] = []
  let lastAction: Node | null = null
  let lastCheckpoint: Node | null = null

  for (const node of nodes) {
    const { type, payload } = node.event
    if (type === 'action') lastAction = node
    if (type === 'observation' && lastAction) {
      edges.push({ from: lastAction, to: node, kind: 'flow' })
    }
    if (type === 'learning') {
      for (const seq of (payload as { source_seqs: number[] }).source_seqs.slice(-2)) {
        const source = bySeq.get(seq)
        if (source) edges.push({ from: source, to: node, kind: 'flow' })
      }
    }
    if (type === 'checkpoint') {
      if (lastCheckpoint) edges.push({ from: lastCheckpoint, to: node, kind: 'chain' })
      lastCheckpoint = node
    }
    if (type === 'rollback') {
      const target = byCheckpointId.get((payload as { target_checkpoint_id: string }).target_checkpoint_id)
      if (target) edges.push({ from: node, to: target, kind: 'rollback' })
    }
  }

  return { nodes, edges, width: PAD.left + events.length * COL + 40 }
}

function edgePath(edge: Edge): string {
  const { from, to } = edge
  if (edge.kind === 'rollback') {
    const mid = (from.x + to.x) / 2
    return `M${from.x},${from.y} Q${mid},${from.y - 46} ${to.x},${to.y}`
  }
  return `M${from.x},${from.y} C${(from.x + to.x) / 2},${from.y} ${(from.x + to.x) / 2},${to.y} ${to.x},${to.y}`
}

export default function GraphView({ events }: GraphViewProps) {
  const [selected, setSelected] = useState<DhruvaEvent | null>(null)
  const { nodes, edges, width } = useMemo(() => build(events), [events])
  const height = PAD.top + LANES.length * ROW

  if (!events.length) {
    return (
      <Panel title="provenance">
        <p className="p-panel text-small text-ink-muted">No events yet.</p>
      </Panel>
    )
  }

  return (
    <div className="flex flex-col gap-gutter">
      <Panel
        title="provenance graph"
        status={<span className="font-mono text-micro text-ink-muted">{nodes.length} nodes · {edges.length} edges</span>}
      >
        <div className="overflow-x-auto p-panel">
          <svg width={width} height={height} role="img" aria-label="temporal provenance graph">
            {LANES.map((lane, i) => (
              <g key={lane.key}>
                <line
                  x1={PAD.left - 12}
                  x2={width - 20}
                  y1={PAD.top + i * ROW}
                  y2={PAD.top + i * ROW}
                  stroke={color.edge.subtle}
                />
                <text
                  x={0}
                  y={PAD.top + i * ROW + 4}
                  className="font-mono"
                  fontSize="10"
                  fill={color.ink.muted}
                >
                  {lane.label}
                </text>
              </g>
            ))}

            {edges.map((edge, i) => (
              <path
                key={i}
                d={edgePath(edge)}
                fill="none"
                stroke={
                  edge.kind === 'rollback'
                    ? color.alarm[400]
                    : edge.kind === 'chain'
                      ? color.ink.muted
                      : color.edge.strong
                }
                strokeWidth={edge.kind === 'rollback' ? 2 : 1}
                strokeDasharray={edge.kind === 'chain' ? '3 3' : undefined}
                opacity={edge.kind === 'flow' ? 0.5 : 0.9}
              />
            ))}

            {nodes.map((node) => (
              <g
                key={node.event.seq}
                transform={`translate(${node.x - 8}, ${node.y - 8})`}
                onClick={() => setSelected(node.event)}
                className="cursor-pointer"
              >
                <rect width={16} height={16} fill="transparent" />
                <foreignObject width={16} height={16}>
                  <EventGlyph
                    type={node.event.type}
                    size={16}
                    poisoned={
                      node.event.type === 'observation' &&
                      Boolean((node.event.payload as { poisoned?: boolean }).poisoned)
                    }
                  />
                </foreignObject>
              </g>
            ))}
          </svg>
        </div>
        <p className="px-panel pb-panel font-mono text-micro text-ink-muted">
          dashed = hash chain · red = rollback · click a node to inspect
        </p>
      </Panel>

      {selected ? (
        <Panel title={`node · seq ${selected.seq}`}>
          <pre className="max-h-64 overflow-auto p-panel font-mono text-micro text-ink-secondary">
            {JSON.stringify(selected, null, 2)}
          </pre>
        </Panel>
      ) : null}
    </div>
  )
}
