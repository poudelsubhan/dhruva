/**
 * The single ingestion path for run events.
 *
 * Live and replay share this store; only the source differs. That is what makes the replay view a
 * genuine replay rather than a second renderer that can drift from the live one.
 *
 * Events are buffered by seq and released only as a CONTIGUOUS prefix: the UI never renders a run
 * with a hole in it, because a hole means the next arriving event could still change what is
 * already on screen.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DhruvaEvent } from '../contracts'

export interface RunStreamState {
  events: DhruvaEvent[]
  connected: boolean
  error: string | null
  buffered: number
}

export function orderedPrefix(pending: Map<number, DhruvaEvent>, from: number): DhruvaEvent[] {
  const out: DhruvaEvent[] = []
  let next = from
  for (;;) {
    const event = pending.get(next)
    if (!event) break
    out.push(event)
    pending.delete(next)
    next += 1
  }
  return out
}

export function useRunStream(runId: string | null): RunStreamState {
  const [events, setEvents] = useState<DhruvaEvent[]>([])
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [buffered, setBuffered] = useState(0)

  const pending = useRef(new Map<number, DhruvaEvent>())
  const nextSeq = useRef(0)

  useEffect(() => {
    if (!runId) return
    pending.current = new Map()
    nextSeq.current = 0
    setEvents([])
    setError(null)

    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const socket = new WebSocket(`${proto}://${window.location.host}/ws/runs/${runId}`)

    socket.onopen = () => setConnected(true)
    socket.onclose = () => setConnected(false)
    socket.onerror = () => setError('websocket error')
    socket.onmessage = (message) => {
      const frame = JSON.parse(message.data as string) as DhruvaEvent | { type: string }
      if (!('seq' in frame)) return // hello / bye control frames
      pending.current.set(frame.seq, frame as DhruvaEvent)
      const released = orderedPrefix(pending.current, nextSeq.current)
      if (released.length) {
        nextSeq.current += released.length
        setEvents((prev) => [...prev, ...released])
      }
      setBuffered(pending.current.size)
    }

    return () => socket.close()
  }, [runId])

  return useMemo(
    () => ({ events, connected, error, buffered }),
    [events, connected, error, buffered],
  )
}

/** Replay source: the same store, fed from JSONL instead of a socket. */
export function useReplayStream(all: DhruvaEvent[], upToSeq: number): DhruvaEvent[] {
  return useMemo(() => all.filter((e) => e.seq <= upToSeq), [all, upToSeq])
}

export function useEventLoader(load: () => Promise<DhruvaEvent[]>, deps: unknown[]) {
  const [events, setEvents] = useState<DhruvaEvent[]>([])
  const [error, setError] = useState<string | null>(null)
  const run = useCallback(load, deps) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let live = true
    run()
      .then((rows) => live && setEvents(rows))
      .catch((exc: unknown) => live && setError(String(exc)))
    return () => {
      live = false
    }
  }, [run])

  return { events, error }
}
