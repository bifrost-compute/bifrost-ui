import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Lock, Plus } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'

import { useCanManageClusters } from '@/auth/permissions'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import type { ClusterFormState } from '@/lib/cluster-form'
import {
  buildCreateCluster,
  emptyClusterForm,
  emptyWorkerGroup,
  validateClusterForm,
} from '@/lib/cluster-form'
import { defaultImageFor, headRoleLabel, type Engine } from '@/lib/engine'
import type { ImageEntry } from '@/lib/images'
import { catalogEntryForImage, catalogOptionsFor, pinnedRef } from '@/lib/images'
import { cn } from '@/lib/utils'

/**
 * Create-cluster form (spec §5.3), backed by the implemented
 * `POST /api/v1/clusters`. Mirrors `ClusterSpec` exactly — labels and env
 * vars are spec'd as planned forward-compat fields and are deliberately
 * absent until they exist in the API. POST is an upsert with derived
 * idempotency (ADR-0007), so resubmission is safe.
 *
 * Operator/Admin only (Write on Target::Cluster, api-v1.md §2.2): the route
 * renders a permission gate for Developer/Viewer instead of the form; the
 * backend 403 is the hard boundary.
 */
export function ClusterNewPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const canManage = useCanManageClusters()
  const [state, setState] = useState<ClusterFormState>(emptyClusterForm())
  const [errors, setErrors] = useState<string[]>([])
  // The approved-image catalog (#10), filtered server-side to the caller's
  // projects. Optional: a backend without it (404) or an empty catalog
  // leaves the free-text image field exactly as before.
  const catalog = useQuery({ queryKey: ['images'], queryFn: api.images, retry: false })
  const catalogEntries: ImageEntry[] = catalog.data ?? []
  const catalogOptions = catalogOptionsFor(catalogEntries, state.engine)
  const selectedEntry = catalogEntryForImage(catalogEntries, state.image)

  const mutation = useMutation({
    mutationFn: () => api.createCluster(buildCreateCluster(state)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clusters'] })
      navigate(`/clusters/${state.id.trim()}`)
    },
    // 400 invalid_spec / 409 quota_exceeded bodies surface verbatim
    // (BifrostApiError carries the backend's plain-text message).
    onError: (err) => {
      setErrors([err instanceof Error ? err.message : String(err)])
    },
  })

  const patch = (patch: Partial<ClusterFormState>) =>
    setState((prev) => ({ ...prev, ...patch }))

  // Switching engine swaps the image default only if the user hasn't
  // overridden it, so a Ray→Dask flip lands on a sensible Dask image.
  const patchEngine = (engine: Engine) =>
    setState((prev) => ({
      ...prev,
      engine,
      image:
        prev.image.trim() === defaultImageFor(prev.engine)
          ? defaultImageFor(engine)
          : prev.image,
    }))

  // Picking a catalog entry writes the reference the spec should carry
  // (pinned to the digest when the entry has one) and the Ray version the
  // catalog states for it; "custom" leaves the typed image alone.
  const pickCatalogImage = (name: string) => {
    const entry = catalogOptions.find((e) => e.name === name)
    if (!entry) return
    patch({
      image: pinnedRef(entry),
      ...(entry.ray_version ? { rayVersion: entry.ray_version } : {}),
    })
  }

  const patchWorkerGroup = (
    index: number,
    groupPatch: Partial<ClusterFormState['workerGroups'][number]>,
  ) =>
    setState((prev) => ({
      ...prev,
      workerGroups: prev.workerGroups.map((g, i) =>
        i === index ? { ...g, ...groupPatch } : g,
      ),
    }))

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    const validationErrors = validateClusterForm(state)
    setErrors(validationErrors)
    if (validationErrors.length === 0) mutation.mutate()
  }

  if (!canManage) {
    return (
      <>
        <PageHeader
          title="New cluster"
          description="Declarative spec in, observed state out."
        />
        <EmptyState
          icon={Lock}
          title="Operator or Admin role required"
          description="Creating a cluster requires Write on the cluster target (api-v1.md §2.2). Developers and Viewers have read-only access to clusters under ADR-0009."
          action={
            <Button asChild size="sm" variant="outline">
              <Link to="/clusters">Back to clusters</Link>
            </Button>
          }
        />
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="New cluster"
        description="Declarative spec in, observed state out. The reconcile engine converges the cluster to this spec."
      />

      <form onSubmit={onSubmit} className="max-w-2xl space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Basics</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <label className="block space-y-1">
              <span className="text-sm text-muted-foreground">
                Cluster name (stable id — also the gateway routing key)
              </span>
              <Input
                value={state.id}
                onChange={(e) => patch({ id: e.target.value })}
                placeholder="team-training"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-sm text-muted-foreground">Project</span>
              <Input
                value={state.project}
                onChange={(e) => patch({ project: e.target.value })}
                placeholder="proj-a"
              />
            </label>
            <div className="space-y-1">
              <span className="text-sm text-muted-foreground">Engine</span>
              <div
                role="radiogroup"
                aria-label="Cluster engine"
                className="inline-flex rounded-md border p-0.5"
              >
                {(['ray', 'dask'] as const).map((engine) => (
                  <button
                    key={engine}
                    type="button"
                    role="radio"
                    aria-checked={state.engine === engine}
                    onClick={() => patchEngine(engine)}
                    className={cn(
                      'rounded px-3 py-1 text-sm capitalize transition-colors',
                      state.engine === engine
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {engine === 'dask' ? 'Dask' : 'Ray'}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {state.engine === 'dask'
                  ? 'Dask: a scheduler + workers (DaskCluster). No Ray Jobs API and no Serve services — the cluster is pinned by its image.'
                  : 'Ray: a head + workers (RayCluster) with the Ray Jobs API and Ray Serve services available.'}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{headRoleLabel(state.engine)}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-sm text-muted-foreground">
                CPU (K8s quantity)
              </span>
              <Input
                value={state.headCpu}
                onChange={(e) => patch({ headCpu: e.target.value })}
                placeholder="2"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-sm text-muted-foreground">
                Memory (K8s quantity)
              </span>
              <Input
                value={state.headMemory}
                onChange={(e) => patch({ headMemory: e.target.value })}
                placeholder="8Gi"
              />
            </label>
          </CardContent>
        </Card>

        {state.workerGroups.map((group, i) => (
          <Card key={i}>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-sm">Worker group {i + 1}</CardTitle>
              {state.workerGroups.length > 1 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    patch({
                      workerGroups: state.workerGroups.filter(
                        (_, j) => j !== i,
                      ),
                    })
                  }
                >
                  Remove
                </Button>
              ) : null}
            </CardHeader>
            <CardContent className="space-y-3">
              <label className="block space-y-1">
                <span className="text-sm text-muted-foreground">
                  Group name
                </span>
                <Input
                  value={group.name}
                  onChange={(e) => patchWorkerGroup(i, { name: e.target.value })}
                  placeholder="gpu-workers"
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block space-y-1">
                  <span className="text-sm text-muted-foreground">CPU</span>
                  <Input
                    value={group.cpu}
                    onChange={(e) => patchWorkerGroup(i, { cpu: e.target.value })}
                    placeholder="4"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-sm text-muted-foreground">Memory</span>
                  <Input
                    value={group.memory}
                    onChange={(e) =>
                      patchWorkerGroup(i, { memory: e.target.value })
                    }
                    placeholder="16Gi"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-sm text-muted-foreground">
                    GPU (optional)
                  </span>
                  <Input
                    value={group.gpu}
                    onChange={(e) => patchWorkerGroup(i, { gpu: e.target.value })}
                    placeholder="1"
                  />
                </label>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block space-y-1">
                  <span className="text-sm text-muted-foreground">
                    Min replicas
                  </span>
                  <Input
                    value={group.minReplicas}
                    onChange={(e) =>
                      patchWorkerGroup(i, { minReplicas: e.target.value })
                    }
                    inputMode="numeric"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-sm text-muted-foreground">
                    Max replicas
                  </span>
                  <Input
                    value={group.maxReplicas}
                    onChange={(e) =>
                      patchWorkerGroup(i, { maxReplicas: e.target.value })
                    }
                    inputMode="numeric"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-sm text-muted-foreground">
                    Replicas
                  </span>
                  <Input
                    value={group.replicas}
                    onChange={(e) =>
                      patchWorkerGroup(i, { replicas: e.target.value })
                    }
                    inputMode="numeric"
                  />
                </label>
              </div>
              <p className="text-xs text-muted-foreground">
                Scale is group-level (ADR-0002): autoscaling moves between min
                and max; Bifrost never adds individual nodes.
              </p>
            </CardContent>
          </Card>
        ))}

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            patch({ workerGroups: [...state.workerGroups, emptyWorkerGroup()] })
          }
        >
          <Plus /> Add worker group
        </Button>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Runtime</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {catalogOptions.length > 0 ? (
              <label className="block space-y-1 sm:col-span-2">
                <span className="text-sm text-muted-foreground">
                  Approved image
                </span>
                <select
                  aria-label="Approved image"
                  value={selectedEntry?.name ?? 'custom'}
                  onChange={(e) => pickCatalogImage(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="custom">Custom image (type a reference below)</option>
                  {catalogOptions.map((entry) => (
                    <option key={entry.name} value={entry.name}>
                      {entry.name}
                      {entry.ray_version ? ` · Ray ${entry.ray_version}` : ''}
                      {entry.python_version ? ` · Python ${entry.python_version}` : ''}
                      {' · '}
                      {entry.ref}
                    </option>
                  ))}
                </select>
                <span className="block text-xs text-muted-foreground">
                  {selectedEntry
                    ? `Catalog entry ${selectedEntry.name}${selectedEntry.digest ? ', pinned to its digest' : ''}. ${selectedEntry.description ?? ''}`
                    : 'Not a catalog image. Projects whose admission is catalog-only will refuse it.'}
                </span>
              </label>
            ) : null}
            {state.engine === 'ray' ? (
              <label className="block space-y-1">
                <span className="text-sm text-muted-foreground">
                  Ray version
                </span>
                <Input
                  value={state.rayVersion}
                  onChange={(e) => patch({ rayVersion: e.target.value })}
                  placeholder="2.57.0"
                />
              </label>
            ) : null}
            <label className="block space-y-1">
              <span className="text-sm text-muted-foreground">Image</span>
              <Input
                value={state.image}
                onChange={(e) => patch({ image: e.target.value })}
                placeholder={defaultImageFor(state.engine)}
              />
            </label>
            {state.engine === 'dask' ? (
              <p className="text-xs text-muted-foreground sm:col-span-2">
                Dask has no separate version field — the Dask version is
                whatever the chosen image ships. Pin it in the image tag (e.g.
                <code className="mx-1">ghcr.io/dask/dask:2024.5.0</code>).
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Lifecycle</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <label className="block space-y-1">
              <span className="text-sm text-muted-foreground">
                Maximum lifetime in seconds (optional — the cluster is
                terminated after this long; empty disables reaping)
              </span>
              <Input
                value={state.ttlSeconds}
                onChange={(e) => patch({ ttlSeconds: e.target.value })}
                placeholder="86400"
                inputMode="numeric"
              />
            </label>
          </CardContent>
        </Card>

        {errors.length > 0 ? (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3">
            <ul className="list-inside list-disc space-y-1 text-sm text-destructive">
              {errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={mutation.isPending}>
            {mutation.isPending ? 'Creating…' : 'Create cluster'}
          </Button>
          <Button asChild type="button" variant="outline" size="sm">
            <Link to="/clusters">Cancel</Link>
          </Button>
        </div>
      </form>
    </>
  )
}
