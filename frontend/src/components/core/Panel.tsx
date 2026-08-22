import type { ReactNode } from 'react'

import clsx from 'clsx'

/**
 * Panel — the framing primitive every other component sits in.
 *
 * Deliberately quiet: a near-black bay with a recessive border and a micro-caps
 * title. Chrome carries no meaning here, so the 1px border is legitimate; the
 * things that DO carry meaning (glyph strokes, gauge arcs, arcs, playheads) are
 * never thinner than 2px.
 */
export type PanelProps = {
  /** Micro-caps label in the header rail. */
  title: string
  /** Right-aligned slot in the header rail — a verdict chip, a count, a pill. */
  status?: ReactNode
  children: ReactNode
  className?: string
}

export function Panel({ title, status, children, className }: PanelProps) {
  return (
    <section
      className={clsx(
        'flex min-w-0 flex-col rounded-panel border border-edge-default bg-base-800',
        className,
      )}
    >
      <header className="flex items-center justify-between gap-gutter border-b border-edge-subtle px-panel py-snug">
        <h2 className="font-mono text-micro font-semibold tracking-[0.18em] text-ink-muted uppercase">
          {title}
        </h2>
        {status ? <div className="flex shrink-0 items-center gap-tight">{status}</div> : null}
      </header>
      <div className="min-w-0 flex-1 p-panel">{children}</div>
    </section>
  )
}
