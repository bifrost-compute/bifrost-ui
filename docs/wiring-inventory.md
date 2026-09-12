# Bifrost UI — wiring inventory

Source of truth for **what is actually hooked up**: every UI surface (route /
tab / page) → the control-plane endpoint(s) it calls → status. Keep this
current when a surface is wired, stubbed, or made engine-aware.

Last updated: 2026-08-24 (branch `feat/hide-terminated` — hide terminated
clusters by default; Overview job tiles + activity wired to `GET /api/v1/jobs`).

## Status legend

| Status | Meaning |
| --- | --- |
| **LIVE** | Calls a real endpoint and renders real data today. |
| **STUB** | Intentional "pending backend" empty state — endpoint not served yet. |
| **N/A-BY-ENGINE** | Renders a clean "not applicable" state for one engine (e.g. Dask Jobs). |
| **RAY-ONLY** | Surface exists only for Ray clusters; Dask clusters never appear. |
| **UI-AHEAD** | Endpoint exists in the running backend but not in the published client; hand-fetched, 404s on older backends → rendered as not-implemented. |

## Engine model (post-change)

- Cluster reads (`GET /clusters`, `GET /clusters/{id}`) and the create POST are
  **hand-mapped in `src/lib/api.ts`** so the UI-ahead `engine` field survives
  (the generated `@bifrost-compute/bifrost-client` serializers drop unknown fields).
  `engine` normalizes to `ray` when absent (backend default).
- Ray: head + workers, `ray_version`, ports 10001/8265; **has** Jobs API and
  Serve services. Dask: scheduler + workers, image-pinned, ports 8786/8787;
  **no** Jobs API, **no** services.

## Top-level pages

| Surface (route) | Endpoint(s) | Status | Dask-aware? |
| --- | --- | --- | --- |
| Overview `/` | `GET /api/v1/clusters`, `GET /api/v1/usage`, `GET /api/v1/jobs` | LIVE (cluster list + 24h resource-hours). Job stat tiles ("Active jobs", "Failed jobs (24h)") + "Recent activity" now derive from `GET /api/v1/jobs` (`src/lib/jobs.ts`): they render real counts/rows when jobs are present, degrade to `—` / a clean empty state when the list is empty. Comes alive automatically once gateway jobs are attributed backend-side (#89) — no hardcoded values. | **Yes** — cluster table shows an engine badge. |
| Clusters list `/clusters` | `GET /api/v1/clusters` | LIVE | **Yes** — **Engine** column (badge); Ray-version column shows `—` for Dask. **Terminated clusters (tombstones) are hidden by default** (`partitionTerminated` in `src/lib/clusters.ts`); a "Show terminated" checkbox reveals them, and the count line reads "N clusters · M terminated hidden". Terminated clusters stay openable via their detail route. |
| New cluster `/clusters/new` | `POST /api/v1/clusters` | LIVE | **Yes** — **engine selector (Ray \| Dask)**; head vs scheduler label; Ray shows `ray_version`, Dask shows image + version note; `engine` sent in POST body. |
| Cluster detail `/clusters/:id` | `GET /api/v1/clusters/{id}` (+ tabs below) | LIVE | **Yes** — engine badge in header; Ray-version badge Ray-only; Overview shows Engine field. |
| Services `/services` | `GET /api/v1/services` | LIVE (404 → "Services API not available" state). | **RAY-ONLY** — Serve = KubeRay RayServices; copy states Dask clusters have no services and never appear. |
| Service detail `/services/:name` | `GET /api/v1/services/{name}` | LIVE | RAY-ONLY (Ray Serve). |
| New service `/services/new` | `POST /api/v1/services` | LIVE | RAY-ONLY (Ray Serve). |
| Pools `/pools` | `GET /api/v1/pools` | LIVE | Engine-neutral (Kueue). Note added: admission gang-suspends Ray workloads; Dask enforcement is project-quota only. |
| Pool detail `/pools/:name` | `GET /api/v1/pools/{name}`, `.../allocations`, `.../usage` | LIVE | Engine-neutral. |
| New pool `/pools/new` | `POST /api/v1/pools` | LIVE | Engine-neutral. |
| Usage `/usage` | `GET /api/v1/usage` | LIVE | Engine-neutral (metered resource-hours). |
| Jobs (global) `/jobs` | `GET /api/v1/jobs` | LIVE | Cross-cluster history. Ray-sourced in practice (Dask contributes none); the endpoint is engine-neutral, so left as-is (not marked N/A). |
| Registry `/registry` | `GET /api/v1/registry/clusters` | UI-AHEAD (hand-fetched; 404 → not-implemented state). | Engine-neutral. |
| Audit `/audit` | `GET /api/v1/audit`, `?format=csv` | UI-AHEAD (hand-fetched). | Engine-neutral. |
| Access `/access` | `GET /api/v1/access/roles`, `GET/POST/PUT /api/v1/auth/users`, `GET /api/v1/identity`, `GET /api/v1/auth/providers` | UI-AHEAD (hand-fetched; Admin-only sections hidden for non-admins). | Engine-neutral. |
| Settings `/settings` | `GET/PUT /api/v1/settings/policy` | UI-AHEAD (hand-fetched; Admin-only). | Engine-neutral. |
| Login `/login` | `POST /api/v1/auth/login`, `GET /api/v1/auth/providers` | LIVE (local-auth) | n/a |
| Auth callback `/auth/callback` | OIDC PKCE exchange (`/api/v1/auth/*`) | LIVE | n/a |
| Health indicator (shell) | `GET /healthz`, `GET /api/v1/version` | LIVE | n/a |

## Cluster-detail tabs (`/clusters/:id`)

| Tab | Endpoint | Status | Dask behavior |
| --- | --- | --- | --- |
| Overview | `GET /api/v1/clusters/{id}` | LIVE | Shows **Engine** field; **Ray version** field Ray-only. |
| Nodes | `GET /api/v1/clusters/{id}/nodes` | LIVE | First card labeled **Scheduler** (not "Head node") for Dask; workers unchanged. |
| Jobs | `GET /api/v1/clusters/{id}/jobs` | LIVE for Ray / **N/A-BY-ENGINE** for Dask | Dask renders "Not applicable — Dask has no job-submission API"; endpoint is **not** called for Dask (`enabled: engine === 'ray'`). |
| Logs | `GET /api/v1/clusters/{id}/logs` | LIVE (non-streaming; WS streaming is a documented follow-up) | Works for both (pod tail). |
| Metrics | `GET /api/v1/clusters/{id}/metrics` | LIVE | Works for both. |
| Events | `GET /api/v1/clusters/{id}/events` | LIVE (K8s-sourced; answers even when the runtime dashboard is down) | Works for both. |
| Config | — | STUB | Pending backend: ClusterView has no full spec yet (api-v1.md §3.4) and PATCH is Milestone B. Engine-neutral once landed. |

## Still stubbed / scoped, and why

- **Cluster-detail → Config**: STUB. Needs the full effective spec on
  `ClusterView` (api-v1.md §3.4) and `PATCH /api/v1/clusters/{id}` (Milestone B).
- **Overview job stat tiles + activity feed**: WIRED to `GET /api/v1/jobs`
  (no longer STUB). Tiles/list are empty (`—` / empty state) until
  gateway-submitted jobs are attributed backend-side (#89), then populate
  with no UI change. A future aggregating `GET /api/v1/overview` could still
  replace the per-tile derivation, but is no longer a prerequisite for live
  job stats.
- **Dask Jobs tab**: N/A-BY-ENGINE by design — Dask has no job-submission API.
- **Services (all three routes)**: RAY-ONLY by design — Ray Serve = KubeRay
  RayServices; Dask has no service surface.
- **Registry / Audit / Access / Settings**: UI-AHEAD — implemented backend-side
  but not in the published client, so hand-fetched; they degrade to the
  not-implemented state on backends that predate the endpoints.
