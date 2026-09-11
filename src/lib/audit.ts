import type { Identity } from './api'

/**
 * One audit event from `GET /api/v1/audit` (api-v1.md §5.9). UI-ahead: not
 * yet in the published `@bifrost-compute/bifrost-client`, so this shape is
 * hand-written here; delete it and import from the client once published.
 * Option fields are null-present on the wire (`subject`, `action`,
 * `cluster`, `method`, `path`, `reason`, `required`, `granted_roles`).
 */
export interface AuditEvent {
  ts: number
  subject: string | null
  decision: 'allow' | 'deny'
  reason: string | null
  action: string | null
  cluster: string | null
  method: string | null
  path: string | null
  status: number
  latency_ms: number
  required: { action: string; target: string } | null
  granted_roles: string[] | null
}

/**
 * Unlike every other list endpoint, the audit route wraps rows in an
 * envelope because the cursor has to live somewhere (api-v1.md §5.9).
 * `next_cursor` is null at the end of the stream.
 */
export interface AuditListResponse {
  items: AuditEvent[]
  next_cursor: number | null
}

export const AUDIT_DEFAULT_LIMIT = 50
/** CSV export page size — one request, capped at the backend max. */
export const AUDIT_EXPORT_LIMIT = 1000

/** Time windows for the audit filter bar; `0` seconds = "all" (no from/to). */
export const AUDIT_WINDOWS = [
  { label: 'Last 1h', seconds: 3_600 },
  { label: 'Last 24h', seconds: 86_400 },
  { label: 'Last 7d', seconds: 604_800 },
  { label: 'All', seconds: 0 },
] as const

export type AuditMethodFilter = 'any' | 'GET' | 'POST' | 'PUT' | 'DELETE'
export type AuditDecisionFilter = 'any' | 'allow' | 'deny'
export type AuditMinStatusFilter = 'any' | '400' | '500'

/** Filter-bar state; `'any'` and empty strings are unset. */
export interface AuditFilters {
  subject: string
  cluster: string
  method: AuditMethodFilter
  decision: AuditDecisionFilter
  minStatus: AuditMinStatusFilter
  /** Seconds of history; `0` = all time (no from/to params). */
  windowSeconds: number
}

export function emptyAuditFilters(): AuditFilters {
  return {
    subject: '',
    cluster: '',
    method: 'any',
    decision: 'any',
    minStatus: 'any',
    windowSeconds: 86_400,
  }
}

export interface AuditQueryOptions {
  /** Pagination cursor from a previous response's `next_cursor`. */
  cursor?: number | null
  limit?: number
  /** `'csv'` switches the response to text/csv. */
  format?: 'csv'
  /** Injectable clock for tests. */
  now?: number
}

/**
 * Serialize filter state to the audit query string (api-v1.md §5.9). Unset
 * filters are omitted entirely; `windowSeconds > 0` becomes inclusive unix
 * `from`/`to` computed from `now`. Returns '' when nothing is set (still
 * valid — the backend applies its own default limit).
 */
export function buildAuditQuery(
  filters: AuditFilters,
  options: AuditQueryOptions = {},
): string {
  const { cursor, limit, format, now = Date.now() } = options
  const params = new URLSearchParams()

  if (limit != null) params.set('limit', String(limit))
  if (cursor != null) params.set('cursor', String(cursor))

  if (filters.windowSeconds > 0) {
    const to = Math.floor(now / 1000)
    params.set('from', String(to - filters.windowSeconds))
    params.set('to', String(to))
  }

  const subject = filters.subject.trim()
  if (subject !== '') params.set('subject', subject)
  const cluster = filters.cluster.trim()
  if (cluster !== '') params.set('cluster', cluster)
  if (filters.method !== 'any') params.set('method', filters.method)
  if (filters.decision !== 'any') params.set('decision', filters.decision)
  if (filters.minStatus !== 'any') params.set('min_status', filters.minStatus)
  if (format != null) params.set('format', format)

  const query = params.toString()
  return query === '' ? '' : `?${query}`
}

/** Decision → badge variant: allow is quiet, deny is loud. */
export function decisionBadgeVariant(
  decision: AuditEvent['decision'],
): 'success' | 'destructive' {
  return decision === 'deny' ? 'destructive' : 'success'
}

/** Status-code class → text color (2xx neutral, 4xx amber, 5xx red). */
export function statusClass(status: number): string {
  if (status >= 500) return 'text-red-600 dark:text-red-400'
  if (status >= 400) return 'text-amber-600 dark:text-amber-400'
  return 'text-emerald-600 dark:text-emerald-400'
}

/** `5m ago` / `2h ago` / `3d ago` for a unix-seconds timestamp. */
export function formatRelativeTime(unixSecs: number, now = Date.now()): string {
  const delta = Math.max(0, Math.floor(now / 1000) - unixSecs)
  if (delta < 60) return `${delta}s ago`
  const minutes = Math.floor(delta / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

/**
 * One-line denial detail for tooltips: why, what permission was required,
 * and which roles the caller held (api-v1.md §5.9 — required/granted_roles
 * appear on authz denials only).
 */
export function denialDetail(event: AuditEvent): string {
  const parts: string[] = []
  if (event.reason != null) parts.push(event.reason)
  if (event.required != null) {
    parts.push(`required ${event.required.action} on ${event.required.target}`)
  }
  if (event.granted_roles != null) {
    parts.push(`granted: ${event.granted_roles.join(', ') || 'none'}`)
  }
  return parts.join(' — ')
}

/**
 * The audit log is Admin-only (api-v1.md §5.9): the endpoint serves nothing
 * to lesser roles, so the whole page gates on this. Fails closed on null
 * identity.
 */
export function canViewAudit(identity: Identity | null): boolean {
  if (!identity) return false
  return identity.roles.includes('admin')
}
