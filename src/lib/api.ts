/**
 * Typed API client for the Bifrost control plane.
 *
 * API types come from `@bifrost-compute/bifrost-client` — generated from the
 * frozen Bifrost `openapi.json` (the source of truth, vendored from
 * bifrost-api) and published to GitHub Packages.
 * We never hand-write shapes the backend owns; re-exports below keep call
 * sites importing from `./api` while the truth lives in the package.
 *
 * Endpoints that exist today: `/healthz`, `/api/v1/version`,
 * `/api/v1/clusters`, `/api/v1/services`, `/api/v1/jobs`, `/api/v1/pools`,
 * `/api/v1/usage`, `/api/v1/identity`, `/api/v1/access/roles`,
 * `/api/v1/auth/*`. Endpoints marked "UI-ahead" below (registry, auth
 * shapes not yet in the published client) are hand-fetched; where the
 * running backend predates them they 404 — render that as a "not
 * implemented yet" empty state, not a crash.
 */

import {
  ClustersApi,
  ClusterViewFromJSON,
  Configuration,
  CreateClusterToJSON,
  JobsApi,
  PoolsApi,
  ResponseError,
  ServicesApi,
  SystemApi,
  UsageApi,
} from '@bifrost-compute/bifrost-client'
import type {
  AllocationSpec,
  ClusterSpec as GeneratedClusterSpec,
  ClusterView as GeneratedClusterView,
  CreatePool,
  DeployService,
  FlavorSpec,
  JobView,
  PoolSpec,
  PoolUsageView,
  PoolView,
  PutAllocation,
  ResourceUtilization,
  ServiceSpec,
  ServiceView,
  UpgradeStrategy,
  UsageGroup,
  UsageReport,
  VersionInfo,
  WorkerGroup,
} from '@bifrost-compute/bifrost-client'

import type { AuditListResponse } from './audit'
import { getCurrentToken, notifySessionExpired } from './auth-token'
import { isClusterState, type ClusterState } from './cluster-state'
import { normalizeEngine, type Engine } from './engine'

// Canonical API shapes, re-exported from the generated client.
export type {
  AllocationSpec,
  CreatePool,
  DeployService,
  FlavorSpec,
  JobView,
  PoolSpec,
  PoolUsageView,
  PoolView,
  PutAllocation,
  ResourceUtilization,
  ServiceSpec,
  ServiceView,
  UpgradeStrategy,
  UsageGroup,
  UsageReport,
  VersionInfo,
  WorkerGroup,
}

export type { Engine } from './engine'

/**
 * `engine` is UI-ahead: the running control plane (multi-engine build) returns
 * it per cluster and accepts it on create, but it is not in the published
 * `@bifrost-compute/bifrost-client` yet — the generated `ClusterViewFromJSON` /
 * `ClusterSpecToJSON` silently drop it. So we extend the generated shapes here
 * and thread `engine` through the hand-mapped cluster reads/writes below.
 * Delete these extensions once the client is republished with `engine`.
 */
export type ClusterSpec = GeneratedClusterSpec & { engine?: Engine }
export type ClusterView = GeneratedClusterView & { engine: Engine }
export interface CreateCluster {
  /** Stable cluster id (also the gateway routing key / cluster CR name). */
  id: string
  spec: ClusterSpec
}

// Bifrost's four roles (the backend auth package). Kept in sync with the backend enum;
// `operator` was previously missing here — the kind of drift the generated
// client exists to prevent.
export type Role = 'viewer' | 'developer' | 'operator' | 'admin'

/**
 * `GET /api/v1/identity` exists backend-side now (access.rs: "who am I" for
 * any authenticated caller, plus the dev identity when auth is disabled) but
 * is not yet in the published `@bifrost-compute/bifrost-client` — hand-written here
 * until it is. Note `roles` is a list (a caller can hold several) — matching
 * the backend's `Vec<Role>`.
 */
/** One project the caller holds a scoped grant in (`GET /api/v1/identity`). */
export interface ProjectGrant {
  name: string
  roles: Role[]
}

export interface Identity {
  subject: string
  email?: string
  groups: string[]
  /**
   * The caller's *global* roles. A user whose only grant is on a project is
   * not in here — see `projects`, and see `holdsRole` before gating anything
   * on this field alone.
   */
  roles: Role[]
  /**
   * The projects the caller holds scoped grants in, with the roles held
   * there. Absent on a control plane older than contract 0.3.0, so treat it
   * as optional and fall back to `roles`.
   */
  projects?: ProjectGrant[]
}

/**
 * UI-ahead: `GET /api/v1/access/roles` (access.rs, Admin-only) is not in the
 * published client yet — hand-written here; migrate when published.
 * `mappings` is null with `source: "local"` in pure local-auth deployments
 * (roles live on the user rows, ADR-0011). `editable` is always false in v1.
 */
export interface RoleMappingsView {
  admin: string[]
  operator: string[]
  developer: string[]
  viewer: string[]
}

export interface AccessRolesResponse {
  mappings: RoleMappingsView | null
  source: 'file' | 'local'
  editable: boolean
}

/**
 * UI-ahead: local user management (`/api/v1/auth/users`, Admin-only,
 * `--local-auth` deployments only; api-v1.md §5.15) is not in the published
 * client yet — hand-written here; migrate when published. Hashes never
 * serialize; `created_at` is unix seconds.
 */
export interface LocalUserView {
  username: string
  email: string | null
  role: Role
  disabled: boolean
  created_at: number
}

export interface CreateLocalUser {
  username: string
  email?: string
  password: string
  role: Role
}

export interface UpdateLocalUser {
  role?: Role
  disabled?: boolean
  password?: string
}

/**
 * UI-ahead: governance policy (`/api/v1/settings/policy`, Admin-only;
 * api-v1.md §5.16) is not in the published client yet — hand-written here;
 * migrate when published. `source`: "file" (untouched `--policy` boot
 * seed) | "store" (edited via PUT) | "none" (nothing configured). The PUT
 * is section-replace: a present key replaces that section (`prices: null`
 * clears the sheet, `quotas: {}` clears all), absent keys are untouched.
 */
export interface PolicyView {
  /** resource → $/unit-hour; null when no price sheet is configured. */
  prices: Record<string, number> | null
  /** project → (resource → limit). Empty when no quotas are configured. */
  quotas: Record<string, Record<string, number>>
  source: 'file' | 'store' | 'none'
  editable: boolean
}

export interface UpdatePolicy {
  prices?: Record<string, number> | null
  quotas?: Record<string, Record<string, number>>
}

/**
 * UI-ahead: no registry read endpoint exists in openapi.json yet. Import
 * from the client once the backend exposes it.
 */
export interface RegistryCluster {
  id: string
  hostname: string
  api_base_url: string
  token_set: boolean
  validation?: {
    ok: boolean
    message?: string
    checked_at?: string
  } | null
}

/**
 * UI-ahead: per-cluster observability (`GET /api/v1/clusters/{id}/nodes` and
 * `.../jobs`, the backend) landed backend-side but is not yet in the
 * published `@bifrost-compute/bifrost-client` — hand-fetched like identity/audit
 * below; migrate to the generated `ClustersApi` once the client is
 * republished. Both proxy the cluster's live Ray state, so a reachable
 * control plane fronting an unreachable cluster answers 503 (`isUnavailable`);
 * an out-of-scope / unknown cluster answers 404 (`isNotImplemented`). Fields
 * are the raw snake_case wire shape — `request()` does no camelCase mapping.
 */
export interface NodeView {
  pod_name: string
  /** Worker-group name; absent on the head node. */
  group?: string | null
  is_head: boolean
  /** Ray/Kubernetes pod phase (Running | Pending | …). */
  phase: string
  ready: boolean
  node_ip?: string | null
  host?: string | null
  /** Allocatable CPU in cores. */
  cpu?: number | null
  /** Allocatable memory in bytes. */
  memory_bytes?: number | null
  /** Allocatable GPU count. */
  gpu?: number | null
}

export interface NodeWorkerGroup {
  name: string
  desired: number
  ready: number
  nodes: NodeView[]
}

export interface ClusterNodesView {
  cluster_id: string
  head: NodeView | null
  worker_groups: NodeWorkerGroup[]
}

/**
 * A live Ray job on a single cluster (the browser-consumable, path-based
 * proxy — the UI never builds raw Ray dashboard URLs). Every field is
 * optional on the wire; `start_time`/`end_time` are epoch milliseconds.
 */
export interface ClusterJobView {
  job_id?: string | null
  submission_id?: string | null
  status?: string | null
  entrypoint?: string | null
  start_time?: number | null
  end_time?: number | null
  message?: string | null
}

/**
 * UI-ahead: per-cluster events/metrics/logs (the backend) — the
 * metrics/events/logs siblings of nodes/jobs above, hand-fetched until the
 * generated client is republished. Same failure semantics: 503 → cluster/
 * source unreachable (`isUnavailable`); 404 → unknown cluster or a backend
 * that predates the endpoint. Raw snake_case wire shape.
 */

/** One normalized Kubernetes Event about a cluster object (api-v1.md §5.6a). */
export interface ClusterEventView {
  /** `Normal` | `Warning`. */
  type: string
  reason?: string | null
  message?: string | null
  count: number
  /** RFC3339. */
  first_seen?: string | null
  last_seen?: string | null
  /** `Kind/name`, e.g. `Pod/foo-head-abc`. */
  object?: string | null
}

export interface ClusterEventsView {
  cluster_id: string
  events: ClusterEventView[]
}

/**
 * A resource's capacity (`total`) and its used amount when known (cores /
 * device count / bytes). `used` is absent when the cluster reports no live
 * utilization (e.g. a non-autoscaling cluster) — the tile then shows capacity
 * only, no meter.
 */
export interface ResourceStat {
  used?: number | null
  total: number
}

/** Normalized cluster resource summary for the metrics tiles (api-v1.md §5.x). */
export interface ClusterMetricsView {
  cluster_id: string
  cpu?: ResourceStat | null
  gpu?: ResourceStat | null
  memory?: ResourceStat | null
  object_store_memory?: ResourceStat | null
  active_nodes?: number | null
  pending_nodes?: number | null
  failed_nodes?: number | null
}

/** Tail-capped pod logs (api-v1.md §5.6b, non-streaming first cut). */
export interface ClusterLogsView {
  cluster_id: string
  /** Tailable pod names (head first) for the pod selector. */
  pods: string[]
  /** The pod these `lines` came from. */
  pod: string
  tail: number
  lines: string[]
  /** `true` when the tail was filled (older lines may exist beyond it). */
  truncated: boolean
}

/**
 * UI-ahead: local-auth endpoints (api-v1.md §5.15, ADR-0011) are not yet in
 * the published `@bifrost-compute/bifrost-client` — hand-written here like
 * `Identity`/`RegistryCluster`; delete and import from the client once
 * published. `identity.roles` comes from the local user's role column.
 */
export interface LocalLoginResponse {
  token: string
  token_type: string
  /** Unix seconds; informational for the UI. */
  expires_at: number
  identity: { subject: string; roles: Role[] }
}

/**
 * A `ClusterView`'s state for display. Every cluster badge in the UI routes
 * through here so the mapping from the wire shape to the nine renderable
 * `ClusterState`s lives in exactly one place.
 *
 * `observed_state` is null until the reconciler first observes the cluster.
 * What is NOT an answer for that gap is `desired`: it is the operator's
 * intent ("running" | "suspended" | "terminated"), not a lifecycle state, and
 * rendering it as one told users their brand-new cluster was Running —
 * "healthy and accepting work" — while nothing had yet looked at it. Caught
 * by a browser test whose next assertion asked the API and was told
 * `observed_generation: 0`.
 *
 * Unobserved means `pending`, which is exactly what its badge says: waiting
 * for the provisioner to pick up the spec. The one intent worth rendering is
 * `terminated` — a record whose spec says terminated is a tombstone whether
 * or not anything ever reconciled it, and the list partition depends on
 * seeing it as one.
 */
export function clusterViewState(view: ClusterView): ClusterState {
  if (isClusterState(view.observedState)) return view.observedState
  if (view.desired === 'terminated') return 'terminated'
  return 'pending'
}

/**
 * Map a raw `/clusters` JSON object to a `ClusterView`, reusing the generated
 * `ClusterViewFromJSON` for the client-owned fields and merging in the
 * UI-ahead `engine` (which the generated mapper drops). Every cluster read
 * routes through here so `engine` is always present and normalized.
 */
function toClusterView(json: unknown): ClusterView {
  return {
    ...ClusterViewFromJSON(json),
    engine: normalizeEngine((json as { engine?: unknown })?.engine),
  }
}

export interface BifrostApiErrorInit {
  kind: 'http' | 'network'
  status: number
  message: string
  requiredRole?: Role
  grantedRole?: Role
}

/**
 * API failure carrying enough context for the fail-closed UI (spec §1.4.6):
 * 403s render the required vs granted role, network failures render the
 * backend-unreachable empty state, 404s render "not implemented yet".
 */
export class BifrostApiError extends Error {
  readonly kind: 'http' | 'network'
  readonly status: number
  readonly requiredRole?: Role
  readonly grantedRole?: Role

  constructor(init: BifrostApiErrorInit) {
    super(init.message)
    this.name = 'BifrostApiError'
    this.kind = init.kind
    this.status = init.status
    this.requiredRole = init.requiredRole
    this.grantedRole = init.grantedRole
  }

  /** Endpoint does not exist in the running control plane. */
  get isNotImplemented(): boolean {
    return this.kind === 'http' && this.status === 404
  }

  /** `bifrost serve` is down or unreachable. */
  get isUnreachable(): boolean {
    return this.kind === 'network'
  }

  /**
   * Network failure, or a 5xx from the control plane / dev proxy (spec §6:
   * "502 from gateway = cluster unreachable"). In dev, the Vite proxy
   * answers 500 when `bifrost serve` isn't running.
   */
  get isUnavailable(): boolean {
    return (
      this.kind === 'network' || [500, 502, 503, 504].includes(this.status)
    )
  }

  get isForbidden(): boolean {
    return this.kind === 'http' && this.status === 403
  }

  /** 401 — no session, or the held token was rejected (expired/revoked). */
  get isUnauthorized(): boolean {
    return this.kind === 'http' && this.status === 401
  }
}

const ROLES: readonly Role[] = ['viewer', 'developer', 'operator', 'admin']

/**
 * A caller holds a set of roles (backend `Vec<Role>`); for display, pick
 * the most privileged. Admin > operator > developer > viewer.
 */
export function primaryRole(roles: readonly Role[]): Role | undefined {
  const rank: Record<Role, number> = {
    viewer: 0,
    developer: 1,
    operator: 2,
    admin: 3,
  }
  return [...roles].sort((a, b) => rank[b] - rank[a])[0]
}

function asRole(value: unknown): Role | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.toLowerCase()
  return (ROLES as readonly string[]).includes(normalized)
    ? (normalized as Role)
    : undefined
}

/**
 * Pull required/granted role out of an error response body, tolerating both
 * snake_case (backend JSON) and camelCase shapes. Used to render 403s per
 * spec §5.10.
 */
export function rolesFromErrorBody(body: unknown): {
  requiredRole?: Role
  grantedRole?: Role
} {
  if (typeof body !== 'object' || body === null) return {}
  const record = body as Record<string, unknown>
  const requiredRole =
    asRole(record.required_role) ?? asRole(record.requiredRole)
  const grantedRole = asRole(record.granted_role) ?? asRole(record.grantedRole)
  return { requiredRole, grantedRole }
}

function messageFromErrorBody(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const record = body as Record<string, unknown>
  for (const key of ['message', 'error', 'detail']) {
    if (typeof record[key] === 'string') return record[key]
  }
  return undefined
}

/**
 * Error bodies come in two shapes: JSON envelopes (authz denials carry
 * required/granted role) and plain-text strings (axum `(StatusCode, String)`
 * responses — e.g. 400 `invalid spec: …` / 409 `quota_exceeded …` on cluster
 * and pool creates). Read the body once as text, try JSON first, then fall
 * back to the raw string so those messages surface verbatim in forms.
 */
async function errorFromResponse(res: Response): Promise<BifrostApiError> {
  // A 401 while holding a token means it expired or was revoked — clear
  // the session so the UI routes to sign-in instead of retrying a dead
  // bearer. Anonymous 401s leave the session alone (there is none).
  if (res.status === 401 && getCurrentToken() != null) notifySessionExpired()
  const text = await res.text().catch(() => '')
  let body: unknown
  try {
    body = text ? JSON.parse(text) : undefined
  } catch {
    body = undefined
  }
  const trimmed = text.trim()
  return new BifrostApiError({
    kind: 'http',
    status: res.status,
    message:
      messageFromErrorBody(body) ??
      (trimmed !== '' ? trimmed : undefined) ??
      `Request failed: ${res.status} ${res.statusText}`,
    ...rolesFromErrorBody(body),
  })
}

/** Bearer header for the hand-rolled requests; empty when signed out. */
function authHeaders(): Record<string, string> {
  const token = getCurrentToken()
  return token != null ? { Authorization: `Bearer ${token}` } : {}
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      ...init,
      headers: { Accept: 'application/json', ...authHeaders(), ...init?.headers },
    })
  } catch {
    throw new BifrostApiError({
      kind: 'network',
      status: 0,
      message:
        'Cannot reach the Bifrost control plane. Start it with `bifrost serve --dev-allow-unauthenticated`.',
    })
  }

  if (!res.ok) throw await errorFromResponse(res)

  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

/** Same failure semantics as `request()`, but returns the raw body text. */
async function requestText(path: string, init?: RequestInit): Promise<string> {
  let res: Response
  try {
    res = await fetch(path, {
      ...init,
      headers: { ...authHeaders(), ...init?.headers },
    })
  } catch {
    throw new BifrostApiError({
      kind: 'network',
      status: 0,
      message:
        'Cannot reach the Bifrost control plane. Start it with `bifrost serve --dev-allow-unauthenticated`.',
    })
  }

  if (!res.ok) throw await errorFromResponse(res)
  return res.text()
}

/**
 * Turn a thrown value from the generated client into a `BifrostApiError`.
 * The client throws `ResponseError` (carrying the raw `Response`) on a
 * non-2xx status and `FetchError` when the network call itself fails; both
 * become the fail-closed shape the UI already knows how to render.
 */
async function toBifrostError(err: unknown): Promise<BifrostApiError> {
  if (err instanceof BifrostApiError) return err
  if (err instanceof ResponseError) return errorFromResponse(err.response)
  // A client-wrapped `FetchError` (network reject) or anything unexpected:
  // the control plane is unreachable.
  return new BifrostApiError({
    kind: 'network',
    status: 0,
    message:
      'Cannot reach the Bifrost control plane. Start it with `bifrost serve --dev-allow-unauthenticated`.',
  })
}

/** Run a generated-client call, normalizing any failure to `BifrostApiError`. */
async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    throw await toBifrostError(err)
  }
}

// One shared client. `basePath: ''` makes the generated client issue
// relative URLs (`/api/v1/clusters`) against the UI's own origin — the Vite
// dev proxy and the production deploy both serve the API there. (Its default
// basePath is `http://localhost`, which would be wrong in the browser.)
// `accessToken` in function form so every request re-reads the current
// session token — sign-in/sign-out/expiry apply without rebuilding the
// client. Returning '' sends no Authorization header (the generator skips
// falsy tokens).
const config = new Configuration({
  basePath: '',
  accessToken: () => getCurrentToken() ?? '',
})
const clustersApi = new ClustersApi(config)
const jobsApi = new JobsApi(config)
const poolsApi = new PoolsApi(config)
const servicesApi = new ServicesApi(config)
const systemApi = new SystemApi(config)
const usageApi = new UsageApi(config)

export const api = {
  healthz: () => call(() => systemApi.healthz()),
  version: () => call(() => systemApi.version()),
  // Cluster reads/writes are hand-mapped (not via the generated `ClustersApi`
  // calls) so the UI-ahead `engine` field survives — the generated
  // serializers drop it. Same `request()` failure semantics as before, and
  // `toClusterView` reuses the generated field mapping for everything else.
  clusters: () =>
    request<unknown[]>('/api/v1/clusters').then((rows) =>
      rows.map(toClusterView),
    ),
  cluster: (id: string) =>
    request<unknown>(`/api/v1/clusters/${encodeURIComponent(id)}`).then(
      toClusterView,
    ),
  createCluster: (createCluster: CreateCluster) => {
    // Serialize the client-owned fields with the generated mapper, then merge
    // `engine` into the spec (the mapper drops it). Default to Ray.
    const body = CreateClusterToJSON(createCluster) as unknown as {
      spec: Record<string, unknown>
      [k: string]: unknown
    }
    body.spec.engine = createCluster.spec.engine ?? 'ray'
    return request<unknown>('/api/v1/clusters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(toClusterView)
  },
  deleteCluster: (id: string) => call(() => clustersApi.deleteCluster({ id })),
  /**
   * UI-ahead: per-cluster nodes/jobs (the backend) are not in the published
   * client yet — hand-fetched like identity/audit below (see the `NodeView` /
   * `ClusterJobView` notes above). 503 → cluster unreachable; 404 → the
   * running backend predates the endpoint.
   */
  clusterNodes: (id: string) =>
    request<ClusterNodesView>(
      `/api/v1/clusters/${encodeURIComponent(id)}/nodes`,
    ),
  clusterJobs: (id: string) =>
    request<ClusterJobView[]>(
      `/api/v1/clusters/${encodeURIComponent(id)}/jobs`,
    ),
  clusterEvents: (id: string) =>
    request<ClusterEventsView>(
      `/api/v1/clusters/${encodeURIComponent(id)}/events`,
    ),
  clusterMetrics: (id: string) =>
    request<ClusterMetricsView>(
      `/api/v1/clusters/${encodeURIComponent(id)}/metrics`,
    ),
  clusterLogs: (id: string, opts?: { node?: string; tail?: number }) => {
    const params = new URLSearchParams()
    if (opts?.node) params.set('node', opts.node)
    if (opts?.tail != null) params.set('tail', String(opts.tail))
    const qs = params.toString()
    return request<ClusterLogsView>(
      `/api/v1/clusters/${encodeURIComponent(id)}/logs${qs ? `?${qs}` : ''}`,
    )
  },
  jobs: () => call(() => jobsApi.listJobs()),
  pools: () => call(() => poolsApi.listPools()),
  pool: (name: string) => call(() => poolsApi.getPool({ name })),
  createPool: (spec: PoolSpec) =>
    call(() => poolsApi.createPool({ createPool: { spec } })),
  deletePool: (name: string) => call(() => poolsApi.deletePool({ name })),
  allocations: (name: string) =>
    call(() => poolsApi.listAllocations({ name })),
  putAllocation: (name: string, project: string, putAllocation: PutAllocation) =>
    call(() => poolsApi.putAllocation({ name, project, putAllocation })),
  deleteAllocation: (name: string, project: string) =>
    call(() => poolsApi.deleteAllocation({ name, project })),
  poolUsage: (name: string) => call(() => poolsApi.poolUsage({ name })),
  /**
   * Ray Serve services (Phase 4). The routes are only mounted when `serve`
   * runs with a service provisioner — otherwise these 404, which the UI
   * renders as "services API not available on this deployment".
   */
  services: () => call(() => servicesApi.listServices()),
  service: (name: string) => call(() => servicesApi.getService({ name })),
  deployService: (deployService: DeployService) =>
    call(() => servicesApi.deployService({ deployService })),
  deleteService: (name: string) =>
    call(() => servicesApi.deleteService({ name })),
  /** Window bounds are unix seconds; both optional (backend defaults: last 24h). */
  usage: (from?: number, to?: number) =>
    call(() => usageApi.usageReport({ from, to })),
  // UI-ahead: no generated endpoint yet — hand-fetched and 404 until the
  // backend adds them (see the `Identity` / `RegistryCluster` notes above).
  identity: () => request<Identity>('/api/v1/identity'),
  registryClusters: () => request<RegistryCluster[]>('/api/v1/registry/clusters'),
  /**
   * UI-ahead: `GET /api/v1/audit` landed backend-side (api-v1.md §5.9,
   * 2026-08-16) but is not yet in the published `@bifrost-compute/bifrost-client`
   * — hand-fetched like identity/registry above, with the query string
   * built by `buildAuditQuery` in `./audit`. Migrate to the generated
   * AuditApi once the client is republished. 404 on older backends → the
   * page renders the not-implemented state.
   */
  audit: (queryString: string) =>
    request<AuditListResponse>(`/api/v1/audit${queryString}`),
  /** `?format=csv` export — same filters, raw text body for download. */
  auditCsv: (queryString: string) =>
    requestText(`/api/v1/audit${queryString}`, {
      headers: { Accept: 'text/csv' },
    }),
  /**
   * UI-ahead: local auth (api-v1.md §5.15, ADR-0011) is not yet in the
   * published `@bifrost-compute/bifrost-client` — hand-fetched like identity/audit
   * above; migrate to the generated client once published. `providers` is
   * public and always mounted on auth-enabled backends (404 on older ones
   * → the login page falls back to env-based discovery). `login` is public;
   * every failure is the identical 401 `invalid_credentials`. `logout`
   * revokes the caller's PAT.
   */
  authProviders: () => request<unknown>('/api/v1/auth/providers'),
  authLogin: (username: string, password: string) =>
    request<LocalLoginResponse>('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }),
  authLogout: () =>
    request<void>('/api/v1/auth/logout', { method: 'POST' }),
  /**
   * UI-ahead: access read surface (api-v1.md §5.8) and local user
   * management (§5.15) are implemented backend-side (access.rs,
   * local_auth.rs) but not in the published client — hand-fetched like
   * identity above; migrate when published. `accessRoles` and the user
   * routes are Admin-only; the page hides them for non-admins.
   */
  accessRoles: () => request<AccessRolesResponse>('/api/v1/access/roles'),
  localUsers: () => request<LocalUserView[]>('/api/v1/auth/users'),
  createLocalUser: (body: CreateLocalUser) =>
    request<LocalUserView>('/api/v1/auth/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  updateLocalUser: (username: string, body: UpdateLocalUser) =>
    request<LocalUserView>(
      `/api/v1/auth/users/${encodeURIComponent(username)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    ),
  /**
   * UI-ahead: governance policy (api-v1.md §5.16) is not in the published
   * client — hand-fetched like the auth endpoints above; migrate when
   * published. Admin-only; 400 bodies (negative/non-finite values) carry a
   * plain-text message naming the key and surface verbatim in the form.
   */
  policy: () => request<PolicyView>('/api/v1/settings/policy'),
  updatePolicy: (body: UpdatePolicy) =>
    request<PolicyView>('/api/v1/settings/policy', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
}
