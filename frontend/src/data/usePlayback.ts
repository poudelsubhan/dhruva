/**
 * Replay playback for the live demo.
 *
 * Paces a canned log to land in a target wall-clock duration, and holds briefly on the events that
 * carry the story — injection, breach, rollback, the ledger audit — so a presenter can talk over
 * them without pausing manually or racing the clock.
 *
 * The whole demo is one minute, which is not much time to point at a rollback arc.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DhruvaEvent } from '../contracts'

/** Extra dwell (in "event units") on the beats a presenter narrates. */
const DWELL: Partial<Record<DhruvaEvent['type'], number>> = {
  injection: 4,
  observation: 0, // only poisoned ones matter; handled below
  breach: 6,
  rollback: 8,
  ledger_audit: 8,
  resume: 3,
  task_complete: 6,
}

function weightOf(event: DhruvaEvent): number {
  if (event.type === 'observation') {
    return (event.payload as { poisoned?: boolean }).poisoned ? 5 : 1
  }
  return 1 + (DWELL[event.type] ?? 0)
}

export interface Playback {
  index: number
  playing: boolean
  atEnd: boolean
  play: () => void
  pause: () => void
  toggle: () => void
  restart: () => void
  seek: (index: number) => void
  progress: number
}

export function usePlayback(events: readonly DhruvaEvent[], durationMs = 60_000): Playback {
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const timer = useRef<number | null>(null)
  const startedAt = useRef<number | null>(null)

  // Deadline per event rather than a fixed delay per step.
  //
  // Fixed delays drift: each step also costs a React render, and across ~90 events that overhead
  // compounded a 60s budget into ~90s of wall clock. Scheduling against a cumulative deadline
  // absorbs it -- a slow render simply shortens the next wait -- so the run lands on `durationMs`
  // regardless of machine.
  const deadlines = useMemo(() => {
    if (!events.length) return []
    const weights = events.map(weightOf)
    const total = weights.reduce((a, b) => a + b, 0)
    let acc = 0
    return weights.map((w) => {
      acc += w
      return (acc / total) * durationMs
    })
  }, [events, durationMs])

  const clear = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
  }

  useEffect(() => {
    if (!playing || !events.length) return
    if (index >= events.length - 1) {
      setPlaying(false)
      return
    }
    if (startedAt.current === null) startedAt.current = performance.now() - (deadlines[index] ?? 0)
    const wait = Math.max(0, (deadlines[index] ?? 0) - (performance.now() - startedAt.current))
    timer.current = window.setTimeout(
      () => setIndex((i) => Math.min(i + 1, events.length - 1)),
      wait,
    )
    return clear
  }, [playing, index, deadlines, events.length])

  useEffect(() => clear, [])

  const play = useCallback(() => {
    startedAt.current = null
    setIndex((i) => (i >= events.length - 1 ? 0 : i))
    setPlaying(true)
  }, [events.length])

  const pause = useCallback(() => setPlaying(false), [])
  const toggle = useCallback(() => (playing ? pause() : play()), [playing, pause, play])
  const restart = useCallback(() => {
    clear()
    startedAt.current = null
    setIndex(0)
    setPlaying(true)
  }, [])
  const seek = useCallback(
    (next: number) => {
      clear()
      startedAt.current = null
      setPlaying(false)
      setIndex(Math.max(0, Math.min(next, Math.max(0, events.length - 1))))
    },
    [events.length],
  )

  return {
    index,
    playing,
    atEnd: events.length > 0 && index >= events.length - 1,
    play,
    pause,
    toggle,
    restart,
    seek,
    progress: events.length ? index / (events.length - 1) : 0,
  }
}
