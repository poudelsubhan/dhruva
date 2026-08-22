import type { ReactNode } from 'react'

import clsx from 'clsx'

/**
 * CheckpointDiamond — the last-known-good marker.
 *
 * Two states, distinguished by fill weight rather than hue (the reserved hues
 * are spoken for): a verified checkpoint is a solid diamond with a knocked-out
 * check; an unverified one is a hollow, dashed outline in muted ink.
 *
 * The chain-link on the left is the affordance to the parent hash — checkpoints
 * are a hash chain, and this marker says so at a glance.
 */
export type CheckpointDiamondProps = {
  /** Checkpoint id. Shown truncated; the full value rides the title attribute. */
  checkpointId: string
  /** Minted only on a verified-coherent state. Drives the solid/hollow split. */
  verified: boolean
  /** Sequence number this checkpoint closes on. */
  seq: number
  onClick?: (checkpointId: string) => void
}

/** Two interlocking links — "chained to the parent hash". */
function ChainLink() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" className="shrink-0 text-ink-muted">
      <g fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
        <path d="M9.6 6.4 H6.2 A 5.2 5.2 0 0 0 6.2 17 H9.6" />
        <path d="M14.4 6.4 H17.8 A 5.2 5.2 0 0 1 17.8 17 H14.4" />
        <path d="M8.4 11.7 H15.6" />
      </g>
    </svg>
  )
}

function Diamond({ verified }: { verified: boolean }) {
  return (
    <svg
      width="26"
      height="26"
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={clsx('shrink-0', verified ? 'text-ink-primary' : 'text-ink-muted')}
    >
      {verified ? (
        <path
          fill="currentColor"
          fillRule="evenodd"
          d="M12 1.6 L22.4 12 L12 22.4 L1.6 12 Z M7.6 12.1 L10.9 15.4 L16.6 8.6 L14.6 7 L10.6 11.8 L9.2 10.4 Z"
        />
      ) : (
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeDasharray="4 3"
          d="M12 2.6 L21.4 12 L12 21.4 L2.6 12 Z"
        />
      )}
    </svg>
  )
}

function shortId(checkpointId: string): string {
  return checkpointId.length <= 10 ? checkpointId : `${checkpointId.slice(0, 9)}…`
}

export function CheckpointDiamond({ checkpointId, verified, seq, onClick }: CheckpointDiamondProps) {
  const label = `Checkpoint ${checkpointId} at seq ${seq}, ${verified ? 'verified' : 'unverified'}`

  const content: ReactNode = (
    <>
      <ChainLink />
      <Diamond verified={verified} />
      <span className="flex min-w-0 flex-col items-start leading-tight">
        <span
          className={clsx(
            'font-mono text-caption font-semibold',
            verified ? 'text-ink-primary' : 'text-ink-muted',
          )}
        >
          {shortId(checkpointId)}
        </span>
        <span className="font-mono text-micro tracking-widest text-ink-muted uppercase tabular-nums">
          seq {seq}
        </span>
      </span>
    </>
  )

  const shared = clsx(
    'inline-flex items-center gap-tight rounded-control border-2 px-snug py-tight text-left',
    verified ? 'border-edge-strong bg-base-700' : 'border-edge-default bg-base-800',
  )

  if (!onClick) {
    return (
      <div
        className={shared}
        title={checkpointId}
        aria-label={label}
        data-checkpoint-id={checkpointId}
        data-verified={verified ? 'true' : 'false'}
      >
        {content}
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => onClick(checkpointId)}
      className={clsx(
        shared,
        'transition-colors duration-[var(--motion-instant)] hover:border-ink-muted',
      )}
      title={checkpointId}
      aria-label={label}
      data-checkpoint-id={checkpointId}
      data-verified={verified ? 'true' : 'false'}
    >
      {content}
    </button>
  )
}
