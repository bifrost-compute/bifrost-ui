import {
  Boxes,
  ChartColumn,
  Container,
  LayoutDashboard,
  Layers,
  ListChecks,
  Package,
  Rocket,
  ScrollText,
  Settings,
  SquareTerminal,
  Users,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { NavLink } from 'react-router'

import { useCanEditPolicy, useCanViewAudit } from '@/auth/permissions'
import { cn } from '@/lib/utils'

/** Named permission gate for an admin-only nav entry (evaluated in Sidebar). */
type NavGate = 'audit' | 'policy'

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
  /**
   * Admin-only pages gate the nav entry with the SAME predicate the route
   * itself uses, so the sidebar never advertises a page the caller would be
   * bounced from. Fails closed when signed out (identity null → false), so
   * these entries also stay hidden until sign-in completes.
   */
  requires?: NavGate
}

/** Information architecture from spec §4. */
const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/clusters', label: 'Clusters', icon: Boxes },
  { to: '/services', label: 'Services', icon: Rocket },
  { to: '/pools', label: 'Pools', icon: Layers },
  { to: '/usage', label: 'Usage', icon: ChartColumn },
  { to: '/jobs', label: 'Jobs', icon: ListChecks },
  { to: '/images', label: 'Images', icon: Container },
  { to: '/environments', label: 'Environments', icon: Package },
  { to: '/registry', label: 'Registry', icon: SquareTerminal },
  { to: '/audit', label: 'Audit', icon: ScrollText, requires: 'audit' },
  { to: '/access', label: 'Access', icon: Users },
  { to: '/settings', label: 'Settings', icon: Settings, requires: 'policy' },
]

export function Sidebar() {
  // Hooks must run unconditionally; evaluate every gate once, then filter.
  const gates: Record<NavGate, boolean> = {
    audit: useCanViewAudit(),
    policy: useCanEditPolicy(),
  }
  const items = NAV_ITEMS.filter(
    (item) => item.requires == null || gates[item.requires],
  )

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r bg-card">
      <div className="flex h-14 items-center gap-2 border-b px-4">
        <span className="text-sm font-semibold tracking-tight">Bifrost</span>
        <span className="text-xs text-muted-foreground">console</span>
      </div>
      <nav className="flex-1 space-y-1 p-2">
        {items.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground',
                isActive && 'bg-accent font-medium text-accent-foreground',
              )
            }
          >
            <Icon className="size-4" aria-hidden />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t p-2">
        {/* Link out, don't rebuild (spec §4). Proxied in dev, same-origin in prod. */}
        <a
          href="/docs"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <ScrollText className="size-4" aria-hidden />
          API docs ↗
        </a>
      </div>
    </aside>
  )
}
