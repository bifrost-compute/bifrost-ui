import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Lock, Plus } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'

import { useCanSubmitJobs } from '@/auth/permissions'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import { emptyWorkerGroup } from '@/lib/cluster-form'
import type { WorkerGroupRow } from '@/lib/cluster-form'
import type { EnvironmentSpec } from '@/lib/environments'
import { compiledPreview, environmentsForProject, scanLabel, scanTone } from '@/lib/environments'
import type { ImageEntry } from '@/lib/images'
import { catalogEntryForImage, catalogOptionsFor, pinnedRef } from '@/lib/images'
import type { JobFormState } from '@/lib/job-form'
import { buildSubmitJob, emptyJobForm, validateJobForm } from '@/lib/job-form'
import { rememberSubmittedJob } from '@/lib/jobs'

const SELECT_CLASS =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'

/**
 * Submit-job form (#5, #55): a Ray job on a cluster Bifrost creates for it
 * and tears down after. The job's environment is either a published
 * governed environment (base image + packages + env vars, compiled
 * server-side) or an image plus the job's own runtime_env YAML — the
 * backend refuses both at once. Developer or Admin.
 */
export function JobNewPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const canSubmit = useCanSubmitJobs()
  const [params] = useSearchParams()
  const [state, setState] = useState<JobFormState>(() => ({
    ...emptyJobForm(),
    environment: params.get('environment') ?? '',
  }))
  const [errors, setErrors] = useState<string[]>([])

  const environments = useQuery({ queryKey: ['environments'], queryFn: api.environments, retry: false })
  const catalog = useQuery({ queryKey: ['images'], queryFn: api.images, retry: false })
  const allEnvironments: EnvironmentSpec[] = environments.data ?? []
  const selectable = environmentsForProject(allEnvironments, state.project)
  const selectedEnv = selectable.find((e) => e.name === state.environment)
  const catalogEntries: ImageEntry[] = catalog.data ?? []
  const catalogOptions = catalogOptionsFor(catalogEntries, 'ray')
  const selectedImage = catalogEntryForImage(catalogEntries, state.image)

  const mutation = useMutation({
    mutationFn: () => api.submitJob(buildSubmitJob(state)),
    onSuccess: (job) => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
      rememberSubmittedJob(job.id)
      navigate(`/jobs?submitted=${encodeURIComponent(job.id)}`)
    },
    onError: (err) => setErrors([err instanceof Error ? err.message : String(err)]),
  })

  const patch = (p: Partial<JobFormState>) => setState((s) => ({ ...s, ...p }))
  const patchWorkerGroup = (index: number, groupPatch: Partial<WorkerGroupRow>) =>
    setState((s) => ({
      ...s,
      workerGroups: s.workerGroups.map((g, i) => (i === index ? { ...g, ...groupPatch } : g)),
    }))

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    const validation = validateJobForm(state, selectable)
    setErrors(validation)
    if (validation.length === 0) mutation.mutate()
  }

  if (!canSubmit) {
    return (
      <>
        <PageHeader title="Submit job" description="An ephemeral Ray job on a cluster created for it." />
        <EmptyState
          icon={Lock}
          title="Developer or Admin role required"
          description="Submitting a job requires Write on the job target. Viewers and Operators have read-only access to the job history."
          action={
            <Button asChild size="sm" variant="outline">
              <Link to="/jobs">Back to jobs</Link>
            </Button>
          }
        />
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Submit job"
        description="Bifrost creates a Ray cluster for the job, runs the entrypoint on it, records the outcome, and removes the cluster."
      />
      <form onSubmit={onSubmit} className="max-w-2xl space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Job</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <label className="block space-y-1">
              <span className="text-sm text-muted-foreground">Project</span>
              <Input value={state.project} onChange={(e) => patch({ project: e.target.value })} placeholder="team-a" />
            </label>
            <label className="block space-y-1">
              <span className="text-sm text-muted-foreground">Entrypoint (the command Ray runs)</span>
              <Input
                value={state.entrypoint}
                onChange={(e) => patch({ entrypoint: e.target.value })}
                placeholder="python train.py --epochs 10"
                className="font-mono text-xs"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-sm text-muted-foreground">Job id (optional — generated when empty)</span>
              <Input value={state.id} onChange={(e) => patch({ id: e.target.value })} placeholder="train-2026-09-17" />
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Environment</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <label className="block space-y-1">
              <span className="text-sm text-muted-foreground">Governed environment</span>
              <select
                aria-label="Governed environment"
                value={selectedEnv ? state.environment : ''}
                onChange={(e) => patch({ environment: e.target.value, runtimeEnvYaml: e.target.value ? '' : state.runtimeEnvYaml })}
                className={SELECT_CLASS}
              >
                <option value="">None — image and runtime_env below</option>
                {selectable.map((env) => (
                  <option key={env.name} value={env.name}>
                    {env.name}
                    {env.base_image ? ` · ${env.base_image}` : ''}
                    {(env.packages ?? []).length > 0 ? ` · ${env.packages!.length} packages` : ''}
                  </option>
                ))}
              </select>
              <span className="block text-xs text-muted-foreground">
                {environments.isError
                  ? 'Environments are unavailable on this control plane; give the job an image.'
                  : selectable.length === 0
                    ? state.project.trim() === ''
                      ? 'Published environments appear here; type the project first to narrow them.'
                      : `No published environment is open to ${state.project.trim()}.`
                    : 'Published environments open to the project. The job gets its image, packages and env vars, compiled server-side.'}
              </span>
            </label>

            {selectedEnv ? (
              <div className="rounded-md border bg-muted/30 p-3 text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{selectedEnv.name}</span>
                  <Badge variant={scanTone(selectedEnv.scan)}>{scanLabel(selectedEnv.scan)}</Badge>
                  {selectedEnv.description ? <span className="text-muted-foreground">{selectedEnv.description}</span> : null}
                </div>
                <ul className="mt-2 font-mono leading-5">
                  {compiledPreview(selectedEnv).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {selectedEnv?.base_image ? (
              <p className="text-xs text-muted-foreground">
                Image: <code className="font-mono">{selectedEnv.base_image}</code> (fixed by the environment).
              </p>
            ) : (
              <>
                {catalogOptions.length > 0 ? (
                  <label className="block space-y-1">
                    <span className="text-sm text-muted-foreground">Approved image</span>
                    <select
                      aria-label="Approved image"
                      value={selectedImage?.name ?? 'custom'}
                      onChange={(e) => {
                        const entry = catalogOptions.find((c) => c.name === e.target.value)
                        if (entry) patch({ image: pinnedRef(entry), ...(entry.ray_version ? { rayVersion: entry.ray_version } : {}) })
                      }}
                      className={SELECT_CLASS}
                    >
                      <option value="custom">Custom image (type a reference below)</option>
                      {catalogOptions.map((entry) => (
                        <option key={entry.name} value={entry.name}>
                          {entry.name}
                          {entry.ray_version ? ` · Ray ${entry.ray_version}` : ''}
                          {' · '}
                          {entry.ref}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block space-y-1">
                    <span className="text-sm text-muted-foreground">
                      Image{selectedEnv ? ' (the environment has no base image)' : ''}
                    </span>
                    <Input
                      value={state.image}
                      onChange={(e) => patch({ image: e.target.value })}
                      placeholder="rayproject/ray:2.57.0"
                      className="font-mono text-xs"
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-sm text-muted-foreground">Ray version (optional — from the image tag)</span>
                    <Input value={state.rayVersion} onChange={(e) => patch({ rayVersion: e.target.value })} placeholder="2.57.0" />
                  </label>
                </div>
              </>
            )}

            {!selectedEnv ? (
              <label className="block space-y-1">
                <span className="text-sm text-muted-foreground">runtime_env (YAML, optional — governed by the project's rules)</span>
                <textarea
                  value={state.runtimeEnvYaml}
                  onChange={(e) => patch({ runtimeEnvYaml: e.target.value })}
                  rows={5}
                  spellCheck={false}
                  placeholder={'pip:\n  - polars==1.9.0\nenv_vars:\n  OMP_NUM_THREADS: "1"'}
                  className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
                <span className="block text-xs text-muted-foreground">
                  Pinned packages only; index overrides, remote working dirs and image swaps are refused unless an administrator allowed them.
                </span>
              </label>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Resources</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1">
                <span className="text-sm text-muted-foreground">Head CPU</span>
                <Input value={state.headCpu} onChange={(e) => patch({ headCpu: e.target.value })} placeholder="1" />
              </label>
              <label className="block space-y-1">
                <span className="text-sm text-muted-foreground">Head memory</span>
                <Input value={state.headMemory} onChange={(e) => patch({ headMemory: e.target.value })} placeholder="2Gi" />
              </label>
            </div>
            {state.workerGroups.map((group, i) => (
              <div key={i} className="space-y-2 rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Worker group {i + 1}</span>
                  <Button type="button" variant="ghost" size="sm" onClick={() => patch({ workerGroups: state.workerGroups.filter((_, j) => j !== i) })}>
                    Remove
                  </Button>
                </div>
                <Input value={group.name} onChange={(e) => patchWorkerGroup(i, { name: e.target.value })} placeholder="workers" />
                <div className="grid gap-2 sm:grid-cols-3">
                  <Input value={group.cpu} onChange={(e) => patchWorkerGroup(i, { cpu: e.target.value })} placeholder="CPU" aria-label="Worker CPU" />
                  <Input value={group.memory} onChange={(e) => patchWorkerGroup(i, { memory: e.target.value })} placeholder="Memory" aria-label="Worker memory" />
                  <Input value={group.gpu} onChange={(e) => patchWorkerGroup(i, { gpu: e.target.value })} placeholder="GPU (optional)" aria-label="Worker GPU" />
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  <Input value={group.minReplicas} onChange={(e) => patchWorkerGroup(i, { minReplicas: e.target.value })} inputMode="numeric" aria-label="Min replicas" placeholder="Min" />
                  <Input value={group.maxReplicas} onChange={(e) => patchWorkerGroup(i, { maxReplicas: e.target.value })} inputMode="numeric" aria-label="Max replicas" placeholder="Max" />
                  <Input value={group.replicas} onChange={(e) => patchWorkerGroup(i, { replicas: e.target.value })} inputMode="numeric" aria-label="Replicas" placeholder="Replicas" />
                </div>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={() => patch({ workerGroups: [...state.workerGroups, { ...emptyWorkerGroup(), name: `workers-${state.workerGroups.length + 1}` }] })}>
              <Plus /> Add worker group
            </Button>
            <label className="block space-y-1">
              <span className="text-sm text-muted-foreground">Keep the finished cluster for (seconds, optional — default 60)</span>
              <Input value={state.ttlSecondsAfterFinished} onChange={(e) => patch({ ttlSecondsAfterFinished: e.target.value })} inputMode="numeric" placeholder="60" />
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
            {mutation.isPending ? 'Submitting…' : 'Submit job'}
          </Button>
          <Button asChild type="button" variant="outline" size="sm">
            <Link to="/jobs">Cancel</Link>
          </Button>
        </div>
      </form>
    </>
  )
}
