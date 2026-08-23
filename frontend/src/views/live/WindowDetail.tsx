import clsx from 'clsx'

import type { CoherencePoint } from '../../data/derive'

/**
 * WindowDetail — the arithmetic behind one verification, plus the judge's own sentence.
 *
 * C is a blend of three named scores, and the blend hides which one moved. On the breach window of
 * the recorded run, alignment falls 1.00 -> 0.00 while repetition and progress barely twitch: the
 * agent was still busy and still passing the same tests, it had simply stopped doing the task. A
 * single composite number cannot say that. Three bars and a weight column can.
 *
 * The rationale is quoted verbatim. It is the one string on this screen a live model wrote, and it
 * is what turns the score into a judgement rather than a threshold trip.
 */

export type Weights = { alignment: number; repetition: number; progress: number }

const VERDICT_STYLE = {
  pass: 'border-state-pass text-state-pass',
  warn: 'border-state-warn text-state-warn',
  breach: 'border-alarm-400 text-alarm-400',
} as const

/**
 * Constraint text arrives as the task pack authored it: markdown, hard wraps, and the odd stray
 * control character. Flatten it to one line rather than printing the raw bytes at the room.
 */
function flattenConstraint(text: string): string {
  let stripped = ''
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 32
    stripped += code < 0x20 || code === 0x7f ? ' ' : ch
  }
  return stripped
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/^\s*\d+\.\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function Term({
  label,
  value,
  weight,
  collapsed,
}: {
  label: string
  value: number
  weight: number
  collapsed: boolean
}) {
  return (
    <div className="flex items-center gap-snug">
      <span className="w-20 shrink-0 font-mono text-micro tracking-[0.14em] text-ink-muted uppercase">
        {label}
      </span>
      <span
        className={clsx(
          'w-10 shrink-0 text-right font-mono text-caption tabular-nums',
          collapsed ? 'text-alarm-400' : 'text-ink-primary',
        )}
      >
        {value.toFixed(2)}
      </span>
      {/* A term that collapsed to zero has no fill to carry the colour, so the empty track carries
          it instead. Otherwise the row that explains the breach is the one row with nothing on it. */}
      <span
        className={clsx(
          'h-2 min-w-16 flex-1 rounded-tick',
          collapsed ? 'bg-alarm-400/20' : 'bg-base-700',
        )}
      >
        <span
          className={clsx(
            'block h-full rounded-tick transition-[width] duration-500',
            collapsed ? 'bg-alarm-400' : 'bg-coherence-500',
          )}
          style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
        />
      </span>
      <span className="w-28 shrink-0 text-right font-mono text-micro text-ink-muted tabular-nums">
        ×{weight.toFixed(2)} = {(value * weight).toFixed(3)}
      </span>
    </div>
  )
}

export function WindowDetail({
  point,
  weights,
  judge,
}: {
  point: CoherencePoint | null
  weights: Weights
  judge?: string
}) {
  if (!point) {
    return (
      <p className="font-mono text-caption text-ink-muted">
        No window has closed yet. A window closes every five steps.
      </p>
    )
  }

  const terms = [
    { key: 'alignment', label: 'alignment', value: point.alignment, weight: weights.alignment },
    { key: 'repetition', label: 'repetition', value: point.repetition, weight: weights.repetition },
    { key: 'progress', label: 'progress', value: point.progress, weight: weights.progress },
  ]
  // Which term cost the most: weight x shortfall. Named only on a breach, where the room needs to
  // know what actually went wrong rather than only that something did.
  const worst = terms.reduce((a, b) =>
    b.weight * (1 - b.value) > a.weight * (1 - a.value) ? b : a,
  )

  return (
    <div className="flex flex-col gap-snug">
      <div className="flex flex-wrap items-baseline justify-between gap-snug">
        <span className="font-mono text-micro tracking-[0.14em] text-ink-muted uppercase">
          window seq {point.window[0]}–{point.window[1]}
        </span>
        <span
          className={clsx(
            'rounded-pill border-2 px-snug py-tick font-mono text-micro font-semibold tracking-[0.16em] uppercase',
            VERDICT_STYLE[point.verdict],
          )}
        >
          {point.verdict}
        </span>
      </div>

      <div className="flex flex-col gap-tight">
        {terms.map((t) => (
          <Term
            key={t.key}
            label={t.label}
            value={t.value}
            weight={t.weight}
            collapsed={point.verdict === 'breach' && t.key === worst.key}
          />
        ))}
      </div>

      <div className="flex items-baseline justify-end gap-snug border-t border-edge-subtle pt-tight">
        {point.verdict === 'breach' ? (
          <span className="mr-auto font-mono text-micro text-alarm-400">
            {worst.label} carried the fall
          </span>
        ) : null}
        <span className="font-mono text-micro tracking-[0.14em] text-ink-muted uppercase">
          coherence
        </span>
        <span className="font-mono text-lead font-semibold text-ink-primary tabular-nums">
          {point.coherence.toFixed(3)}
        </span>
      </div>

      {point.rationale ? (
        <figure className="border-l-2 border-edge-strong pl-snug">
          <figcaption className="font-mono text-micro tracking-[0.14em] text-ink-muted uppercase">
            judge{judge ? ` · ${judge}` : ''}
          </figcaption>
          <blockquote className="mt-tick text-caption leading-relaxed text-ink-secondary">
            {point.rationale}
          </blockquote>
        </figure>
      ) : null}

      {point.violatedConstraints.length ? (
        <div className="flex flex-col gap-tick">
          {point.violatedConstraints.map((c) => (
            <p
              key={c}
              className="line-clamp-2 rounded-mark bg-alarm-400/10 px-snug py-tick text-caption text-alarm-200"
            >
              <span className="font-mono text-micro tracking-[0.14em] text-alarm-400 uppercase">
                violated ·{' '}
              </span>
              {flattenConstraint(c)}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  )
}
