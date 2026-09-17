import { useQuery } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { Lock, Package, Play } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'

import { useCanEditPolicy, useCanSubmitJobs } from '@/auth/permissions'
import { DataTable } from '@/components/data-table'
import { ApiErrorState, EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { api } from '@/lib/api'
import type { EnvironmentSpec } from '@/lib/environments'
import {
  compiledPreview,
  environmentStatus,
  scanLabel,
  scanTone,
  statusTone,
} from '@/lib/environments'

export function EnvironmentStatusBadge({ env }: { env: EnvironmentSpec }) {
  const status = environmentStatus(env)
  return <Badge variant={statusTone(status)}>{status}</Badge>
}

export function ScanBadge({ env }: { env: EnvironmentSpec }) {
  const title = env.scan
    ? `${env.scan.scanner ?? 'scanner'}${env.scan.scanned_at ? ` · ${new Date(env.scan.scanned_at).toLocaleString()}` : ''}`
    : 'No scan verdict recorded (scripts/scan-environment.py)'
  return (
    <Badge variant={scanTone(env.scan)} title={title} className="whitespace-nowrap">
      {scanLabel(env.scan)}
    </Badge>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-3 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 [overflow-wrap:anywhere]">{children}</dd>
    </div>
  )
}

/** Everything a catalog entry says, and what a job that names it gets. */
export function EnvironmentDetail({ env }: { env: EnvironmentSpec }) {
  const packages = env.packages ?? []
  const vars = Object.entries(env.env_vars ?? {}).sort(([a], [b]) => a.localeCompare(b))
  const preview = compiledPreview(env)
  return (
    <div className="space-y-4">
      <dl className="divide-y">
        <Row label="Status">
          <span className="flex items-center gap-2">
            <EnvironmentStatusBadge env={env} />
            {env.published_by ? (
              <span className="text-xs text-muted-foreground">
                published by {env.published_by}
                {env.published_at ? ` on ${new Date(env.published_at).toLocaleString()}` : ''}
              </span>
            ) : null}
          </span>
        </Row>
        <Row label="Scan verdict"><ScanBadge env={env} /></Row>
        <Row label="Base image">
          {env.base_image ? (
            <code className="font-mono text-xs">{env.base_image}</code>
          ) : (
            <span className="text-muted-foreground">none — the job supplies its image</span>
          )}
        </Row>
        <Row label="Projects">
          {(env.projects ?? []).length === 0 ? (
            <span className="text-muted-foreground">every project</span>
          ) : (
            <span className="flex flex-wrap gap-1">
              {env.projects!.map((p) => (
                <Badge key={p} variant="secondary">{p}</Badge>
              ))}
            </span>
          )}
        </Row>
      </dl>

      <section className="space-y-2">
        <h3 className="text-sm font-medium">Packages ({packages.length})</h3>
        {packages.length === 0 ? (
          <p className="text-sm text-muted-foreground">No packages; the base image is used as-is.</p>
        ) : (
          <ul className="rounded-lg border bg-muted/30 p-3 font-mono text-xs leading-6">
            {packages.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium">Environment variables ({vars.length})</h3>
        {vars.length === 0 ? (
          <p className="text-sm text-muted-foreground">None.</p>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Variable</TableHead>
                  <TableHead>Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vars.map(([k, v]) => (
                  <TableRow key={k}>
                    <TableCell className="font-mono text-xs">{k}</TableCell>
                    <TableCell className="font-mono text-xs [overflow-wrap:anywhere]">{v}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {env.runtime_env_yaml && env.runtime_env_yaml.trim() !== '' ? (
        <section className="space-y-2">
          <h3 className="text-sm font-medium">runtime_env escape hatch</h3>
          <pre className="overflow-x-auto rounded-lg border bg-muted/30 p-3 font-mono text-xs">{env.runtime_env_yaml}</pre>
        </section>
      ) : null}

      <section className="space-y-2">
        <h3 className="text-sm font-medium">What a job gets</h3>
        {preview.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing beyond the job's own image — an empty environment.</p>
        ) : (
          <ul className="rounded-lg border p-3 font-mono text-xs leading-6">
            {preview.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">
          Compiled server-side at submit into the job's Ray runtime_env and pinned on the job,
          so a later edit here never changes a running job.
        </p>
      </section>
    </div>
  )
}

/**
 * Environments (spec row 19): the administrator's governed environments —
 * base image, pinned packages, env vars — filtered server-side to the
 * caller's projects. A job names a published one instead of writing its
 * own runtime_env; drafts and deprecated entries are visible but not
 * selectable.
 */
export function EnvironmentsPage() {
  const canEdit = useCanEditPolicy()
  const canSubmit = useCanSubmitJobs()
  const [viewing, setViewing] = useState<EnvironmentSpec | null>(null)
  const query = useQuery({ queryKey: ['environments'], queryFn: api.environments, retry: false })

  const columns: ColumnDef<EnvironmentSpec>[] = [
    {
      accessorKey: 'name',
      header: 'Name',
      cell: ({ row }) => (
        <div>
          <button type="button" className="font-medium hover:underline" onClick={() => setViewing(row.original)}>
            {row.original.name}
          </button>
          {row.original.description ? (
            <p className="text-xs text-muted-foreground">{row.original.description}</p>
          ) : null}
        </div>
      ),
    },
    { id: 'status', header: 'Status', cell: ({ row }) => <EnvironmentStatusBadge env={row.original} /> },
    {
      id: 'base',
      header: 'Base image',
      cell: ({ row }) =>
        row.original.base_image ? (
          <span className="font-mono text-xs break-all">{row.original.base_image}</span>
        ) : (
          <span className="text-xs text-muted-foreground">job's own</span>
        ),
    },
    {
      id: 'packages',
      header: 'Packages',
      cell: ({ row }) => {
        const n = (row.original.packages ?? []).length
        const vars = Object.keys(row.original.env_vars ?? {}).length
        return (
          <span className="text-sm">
            {n} {n === 1 ? 'package' : 'packages'}
            {vars > 0 ? <span className="text-muted-foreground"> · {vars} env {vars === 1 ? 'var' : 'vars'}</span> : null}
          </span>
        )
      },
    },
    { id: 'scan', header: 'Scan', cell: ({ row }) => <ScanBadge env={row.original} /> },
    {
      id: 'projects',
      header: 'Projects',
      cell: ({ row }) =>
        (row.original.projects ?? []).length === 0 ? (
          <span className="text-xs text-muted-foreground">every project</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {row.original.projects!.map((p) => (
              <Badge key={p} variant="secondary">{p}</Badge>
            ))}
          </div>
        ),
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="outline" onClick={() => setViewing(row.original)}>
            Details
          </Button>
          {canSubmit && environmentStatus(row.original) === 'published' ? (
            <Button asChild size="sm" variant="ghost" title="Submit a job with this environment">
              <Link to={`/jobs/new?environment=${encodeURIComponent(row.original.name)}`}>
                <Play className="size-4" aria-hidden /> Run
              </Link>
            </Button>
          ) : null}
        </div>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Environments"
        description="Governed environments a job runs in: a base image, pinned packages and env vars, published by an administrator and installed at job start — no image build needed."
        actions={
          canEdit ? (
            <Button asChild size="sm" variant="outline">
              <Link to="/settings">Manage catalog</Link>
            </Button>
          ) : undefined
        }
      />
      {query.isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : query.isError ? (
        <ApiErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : query.data.length === 0 ? (
        <EmptyState
          icon={canEdit ? Package : Lock}
          title="No environments yet"
          description={
            canEdit
              ? 'Define one under Settings: a base image, pinned packages and env vars. Publish it and jobs can name it.'
              : 'Your projects have no environments yet. Jobs can still carry their own runtime_env within the administrator’s rules.'
          }
          action={
            canEdit ? (
              <Button asChild size="sm">
                <Link to="/settings">Open settings</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <DataTable columns={columns} data={query.data} />
      )}
      <Dialog open={viewing != null} onOpenChange={(open) => (!open ? setViewing(null) : undefined)}>
        <DialogContent className="max-h-[85vh] w-[min(48rem,calc(100vw-2rem))] max-w-none overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="size-4" aria-hidden />
              {viewing?.name}
            </DialogTitle>
            {viewing?.description ? <DialogDescription>{viewing.description}</DialogDescription> : null}
          </DialogHeader>
          {viewing ? <EnvironmentDetail env={viewing} /> : null}
        </DialogContent>
      </Dialog>
    </>
  )
}
