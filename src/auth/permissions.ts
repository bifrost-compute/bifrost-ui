import { useAuth } from './auth-context'
import { canViewAudit } from '@/lib/audit'
import { canManageClusters } from '@/lib/clusters'
import { canSubmitJobs } from '@/lib/jobs'
import { canWritePools } from '@/lib/pools'
import { canEditPolicy } from '@/lib/settings'
import { canManageServices } from '@/lib/services'

/**
 * Role gating for pool mutation affordances (api-v1.md §2.2: pool writes
 * are Admin-only). Reads are Viewer+ and never gated. With dev auth on, the
 * stub identity is admin so everything renders; with auth unset this is
 * false (fail closed).
 */
export function useCanWritePools(): boolean {
  const { identity } = useAuth()
  return canWritePools(identity)
}

/**
 * Role gating for cluster lifecycle affordances (api-v1.md §2.2: create and
 * terminate need Write/Delete on Target::Cluster — Operator or Admin, not
 * Developer). Reads are Viewer+ and never gated; fails closed on null
 * identity.
 */
export function useCanManageClusters(): boolean {
  const { identity } = useAuth()
  return canManageClusters(identity)
}

/**
 * Role gating for service deploy/delete affordances (the backend auth package
 * `Role::grants` on `Target::Service`: deploying a Serve app is "code", so
 * Developer or Admin — the mirror image of clusters). Reads are Viewer+ and
 * never gated; fails closed on null identity.
 */
export function useCanManageServices(): boolean {
  const { identity } = useAuth()
  return canManageServices(identity)
}

/** Job submission (#5): Developer or Admin, like services. Fails closed. */
export function useCanSubmitJobs(): boolean {
  const { identity } = useAuth()
  return canSubmitJobs(identity)
}

/**
 * The audit log is Admin-only (api-v1.md §5.9) — the whole `/audit` page
 * gates on this, not just affordances. Fails closed on null identity.
 */
export function useCanViewAudit(): boolean {
  const { identity } = useAuth()
  return canViewAudit(identity)
}

/**
 * The governance policy routes (settings, api-v1.md §5.16) are Admin-only —
 * the whole page gates on this, like the audit log. Fails closed on null
 * identity.
 */
export function useCanEditPolicy(): boolean {
  const { identity } = useAuth()
  return canEditPolicy(identity)
}
