import type { ReactNode } from 'react'

import clsx from 'clsx'

/**
 * Sidebar — the source rail.
 *
 * Composition follows shadcn/ui's sidebar shape (Sidebar / SidebarGroup / SidebarItem /
 * SidebarFooter, a controlled `open`, a cmd-B toggle), so the parts are swappable later. The
 * styling does not: shadcn ships its own palette of `--sidebar-*` variables, and this chassis
 * already has a frozen one that `tokens.test.ts` asserts in both directions. Installing a second
 * colour system to draw one column would break that test and put a hue budget of two reserved
 * signals under a UI kit that assumes it can spend colour freely.
 *
 * These are chrome, not core primitives: nothing here carries data, so nothing here is coloured.
 */

const RAIL_WIDTH = 256

export function Sidebar({
  open,
  children,
  className,
}: {
  open: boolean
  children: ReactNode
  className?: string
}) {
  // Closed means gone, not zero-width. A flex row sizes this item from the fixed column inside it,
  // so `width: 0` (utility or inline) still measures 256px and leaves a stub of clipped nav on
  // screen. Unmounting is the only reading of "collapsed" the layout cannot argue with, and on
  // stage the point of collapsing is to hand the flight recorder the whole width.
  if (!open) return null

  return (
    <aside
      className={clsx(
        'sticky top-0 flex h-screen shrink-0 flex-col overflow-y-auto border-r border-edge-subtle bg-base-950',
        className,
      )}
      style={{ width: RAIL_WIDTH }}
      data-state="open"
    >
      {children}
    </aside>
  )
}

export function SidebarGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-tight border-b border-edge-subtle px-snug py-snug">
      <span className="px-tick font-mono text-micro tracking-[0.18em] text-ink-muted uppercase">
        {label}
      </span>
      {children}
    </div>
  )
}

export function SidebarItem({
  active = false,
  onClick,
  title,
  disabled = false,
  children,
}: {
  active?: boolean
  onClick?: () => void
  title?: string
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      aria-current={active ? 'true' : undefined}
      className={clsx(
        'flex w-full flex-col gap-tick rounded-mark border px-snug py-tick text-left transition-colors disabled:opacity-40',
        active
          ? 'border-ink-muted bg-base-700 text-ink-primary'
          : 'border-transparent text-ink-secondary hover:border-edge-default hover:bg-base-800',
      )}
    >
      {children}
    </button>
  )
}

export function SidebarFooter({ children }: { children: ReactNode }) {
  return <div className="mt-auto flex flex-col gap-snug px-snug py-snug">{children}</div>
}

/** The one control that must stay reachable when the rail is closed, so it lives in the app bar. */
export function SidebarToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={open ? 'Hide the run rail' : 'Show the run rail'}
      title={`${open ? 'Hide' : 'Show'} the run rail  (cmd B)`}
      className="rounded-mark border border-edge-default p-2 text-ink-muted transition-colors hover:border-edge-strong hover:text-ink-primary"
    >
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <rect
          x="1.5"
          y="2.5"
          width="13"
          height="11"
          rx="1.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <line x1="6" y1="2.5" x2="6" y2="13.5" stroke="currentColor" strokeWidth="1.5" />
        {open ? null : <rect x="2.5" y="3.5" width="2.5" height="9" fill="currentColor" />}
      </svg>
    </button>
  )
}
