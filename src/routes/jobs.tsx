import { useQuery } from '@tanstack/react-query'
import { ExternalLink, Plus, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'

import { useCanSubmitJobs } from '@/auth/permissions'
import { ApiErrorState, EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { api, BifrostApiError } from '@/lib/api'
import type { RayJobView } from '@/lib/api'
import { forgetSubmittedJob, isTerminalJob, rememberSubmittedJob, submittedJobIds } from '@/lib/jobs'
import { cn } from '@/lib/utils'

/** Ray job status → badge classes (Nebari-tinted semantic colors). */
function statusClasses(status: string): string {
  switch (status.toUpperCase()) {
    case 'SUCCEEDED':
      return 'border-transparent bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
    case 'RUNNING':
      return 'border-transparent bg-blue-500/15 text-blue-600 dark:text-blue-400'
    case 'FAILED':
      return 'border-transparent bg-red-500/15 text-red-600 dark:text-red-400'
    case 'PENDING':
      return 'border-transparent bg-amber-500/15 text-amber-600 dark:text-amber-400'
    default: // STOPPED and anything else
      return 'border-transparent bg-muted text-muted-foreground'
  }
}

function fmtDuration(secs: number | null | undefined): string {
  if (secs == null) return '—'
  if (secs < 60) return `${secs}s`
  const m = Math.floor(secs / 60)
  const s = secs % 60
  if (m < 60) return `${m}m ${s}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

function fmtWhen(unixSecs: number): string {
  return new Date(unixSecs * 1000).toLocaleString()
}

/** One ephemeral job submitted from this console, polled until it settles. */
function SubmittedJobRow({ id, onForget }: { id: string; onForget: () => void }) {
  const query = useQuery({
    queryKey: ['job', id],
    queryFn: () => api.job(id),
    retry: false,
    refetchInterval: (q) => {
      const data = q.state.data as RayJobView | undefined
      return data && isTerminalJob(data.status) ? false : 5_000
    },
  })
  const job = query.data
  const gone = query.error instanceof BifrostApiError && query.error.isNotImplemented
  return (
    <TableRow>
      <TableCell className="font-mono text-xs">{id}</TableCell>
      <TableCell>
        {job ? (
          <Badge className={cn('font-medium', statusClasses(job.status || 'PENDING'))}>
            {job.status || (job.deployment_status || 'submitted')}
          </Badge>
        ) : gone ? (
          <Badge variant="muted">purged</Badge>
        ) : query.isError ? (
          <Badge variant="destructive">unreachable</Badge>
        ) : (
          <span className="text-xs text-muted-foreground">…</span>
        )}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">{job?.project ?? ''}</TableCell>
      <TableCell className="text-xs">
        {job?.cluster ? <span className="font-mono">{job.cluster}</span> : <span className="text-muted-foreground">—</span>}
      </TableCell>
      <TableCell className="max-w-72 truncate text-xs text-muted-foreground" title={job?.message ?? undefined}>
        {job?.message ?? (job && !job.deployment_status ? 'waiting for the provisioner' : '')}
      </TableCell>
      <TableCell>
        <div className="flex justify-end gap-1">
          {job?.gateway_url ? (
            <Button asChild size="sm" variant="ghost" title="Ray dashboard through the gateway">
              <a href={job.gateway_url} target="_blank" rel="noreferrer">
                <ExternalLink className="size-4" aria-hidden />
                <span className="sr-only">Open dashboard</span>
              </a>
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={onForget} title="Stop following this job here">
            <X className="size-4" aria-hidden />
            <span className="sr-only">Dismiss {id}</span>
          </Button>
        </div>
      </TableCell>
    </TableRow>
  )
}

/**
 * Jobs submitted from this console (#5): `GET /jobs` is the finished
 * history, so a just-submitted ephemeral job is followed here by id until
 * it settles. Ids live in this browser only — a convenience, not state.
 */
function SubmittedJobsCard() {
  const [params, setParams] = useSearchParams()
  const [ids, setIds] = useState<string[]>(() => submittedJobIds())
  const submitted = params.get('submitted')
  useEffect(() => {
    if (!submitted) return
    rememberSubmittedJob(submitted)
    setIds(submittedJobIds())
    const next = new URLSearchParams(params)
    next.delete('submitted')
    setParams(next, { replace: true })
  }, [submitted, params, setParams])
  if (ids.length === 0) return null
  return (
    <Card className="lg:col-span-2">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>
          In flight
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            jobs submitted from this console, followed until they finish
          </span>
        </CardTitle>
        {submitted ? <Badge variant="success">submitted {submitted}</Badge> : null}
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Job</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Project</TableHead>
              <TableHead>Cluster</TableHead>
              <TableHead>Message</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {ids.map((id) => (
              <SubmittedJobRow
                key={id}
                id={id}
                onForget={() => {
                  forgetSubmittedJob(id)
                  setIds(submittedJobIds())
                }}
              />
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

/**
 * Global job history (spec §5.5). The persistent, cross-cluster table is
 * backed by `GET /api/v1/jobs` (Phase 3 Postgres); records outlive the
 * clusters that ran them. Submission stays CLI-first (D4).
 */
export function JobsPage() {
  const canSubmit = useCanSubmitJobs()
  const query = useQuery({
    queryKey: ['jobs'],
    queryFn: api.jobs,
    retry: false,
    refetchInterval: 15_000,
  })

  return (
    <>
      <PageHeader
        title="Jobs"
        description="Cross-cluster, persistent job history — the direct answer to “Ray dashboards forget everything.”"
        actions={
          canSubmit ? (
            <Button asChild size="sm">
              <Link to="/jobs/new">
                <Plus /> Submit job
              </Link>
            </Button>
          ) : undefined
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <SubmittedJobsCard />
        <Card>
          <CardHeader>
            <CardTitle>Job history</CardTitle>
          </CardHeader>
          <CardContent>
            {query.isPending ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : query.isError ? (
              <ApiErrorState error={query.error} onRetry={() => query.refetch()} />
            ) : query.data.length === 0 ? (
              <EmptyState
                title="No jobs yet"
                description="Finished jobs land here and stay after their cluster is gone. Submit one with the button above, or through the Ray Jobs CLI against the gateway (right)."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Job</TableHead>
                    <TableHead>Cluster</TableHead>
                    <TableHead>Submitter</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Submitted</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {query.data.map((job) => (
                    <TableRow key={job.id}>
                      <TableCell className="font-mono text-xs">{job.id}</TableCell>
                      <TableCell>{job.cluster}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {job.submitter}
                      </TableCell>
                      <TableCell>
                        <Badge className={cn('font-medium', statusClasses(job.status))}>
                          {job.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{fmtDuration(job.durationSecs)}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {fmtWhen(job.submittedAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Submitting from the CLI</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              The form above creates an ephemeral cluster per job with a governed
              environment or an image. To run against a cluster you already have,
              submit through the Ray Jobs CLI against Bifrost's gateway:
            </p>
            <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
{`ray job submit \\
  --address http://<cluster-host>:8484 \\
  --working-dir . -- python train.py

# Your JWT travels via:
export RAY_JOB_HEADERS='{"Authorization": "Bearer '"$(bifrost token)"'"}'`}
            </pre>
          </CardContent>
        </Card>
      </div>
    </>
  )
}
