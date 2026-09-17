import { useQuery } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { Container, Copy, Lock, ScanSearch } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'

import { useCanEditPolicy } from '@/auth/permissions'
import { DataTable } from '@/components/data-table'
import { ApiErrorState, EmptyState } from '@/components/empty-state'
import { EngineBadge } from '@/components/engine-badge'
import { ImageInspectView } from '@/components/image-inspect'
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
import { api, BifrostApiError } from '@/lib/api'
import type { ImageEntry } from '@/lib/images'
import { engineOf, pinnedRef, shortDigest } from '@/lib/images'

/** Copy-to-clipboard for a reference; silent when the clipboard is unavailable. */
function CopyRef({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-6 px-1.5"
      title="Copy the reference a spec should use"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1200)
        })
      }}
    >
      <Copy className="size-3.5" aria-hidden />
      <span className="sr-only">Copy reference</span>
      {copied ? <span className="text-xs">copied</span> : null}
    </Button>
  )
}

function ProjectsCell({ projects }: { projects?: string[] }) {
  if (!projects || projects.length === 0) {
    return <span className="text-xs text-muted-foreground">every project</span>
  }
  return (
    <div className="flex flex-wrap gap-1">
      {projects.map((p) => (
        <Badge key={p} variant="secondary">{p}</Badge>
      ))}
    </div>
  )
}

/**
 * The inspect dialog: one query per open entry. A registry failure is a
 * 502 whose message carries the registry's own answer (MANIFEST_UNKNOWN,
 * a 401, an unreachable host) — shown verbatim, because "control plane
 * unreachable" would be the wrong diagnosis.
 */
function InspectDialog({
  entry,
  onClose,
}: {
  entry: ImageEntry | null
  onClose: () => void
}) {
  const query = useQuery({
    queryKey: ['image-inspect', entry?.name],
    queryFn: () => api.inspectImage(entry!.name),
    enabled: entry != null,
    retry: false,
    staleTime: 5 * 60_000,
  })
  return (
    <Dialog open={entry != null} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-h-[85vh] w-[min(56rem,calc(100vw-2rem))] max-w-none overflow-x-hidden overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScanSearch className="size-4" aria-hidden />
            {entry?.name}
          </DialogTitle>
          <DialogDescription className="font-mono text-xs break-all">
            {entry ? pinnedRef(entry) : ''}
          </DialogDescription>
        </DialogHeader>
        {entry == null ? null : query.isPending ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Reading the manifest and config from the registry…
          </p>
        ) : query.isError ? (
          query.error instanceof BifrostApiError && query.error.status === 502 ? (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">
              <p className="font-medium text-destructive">The registry could not be read.</p>
              <p className="mt-1 break-words text-destructive/90">{query.error.message}</p>
              <Button className="mt-3" size="sm" variant="outline" onClick={() => query.refetch()}>
                Retry
              </Button>
            </div>
          ) : (
            <ApiErrorState error={query.error} onRetry={() => query.refetch()} />
          )
        ) : (
          <ImageInspectView doc={query.data} />
        )}
      </DialogContent>
    </Dialog>
  )
}

/**
 * Images (#10): the administrator's approved-image catalog, filtered
 * server-side to the caller's projects, with an inspect view that reads
 * the image straight from its registry — what a container from it starts
 * with, and the build steps that produced it — without pulling anything.
 */
export function ImagesPage() {
  const canEdit = useCanEditPolicy()
  const [inspecting, setInspecting] = useState<ImageEntry | null>(null)
  const query = useQuery({ queryKey: ['images'], queryFn: api.images, retry: false })

  const columns: ColumnDef<ImageEntry>[] = [
    {
      accessorKey: 'name',
      header: 'Name',
      cell: ({ row }) => (
        <div>
          <button
            type="button"
            className="font-medium hover:underline"
            onClick={() => setInspecting(row.original)}
          >
            {row.original.name}
          </button>
          {row.original.description ? (
            <p className="text-xs text-muted-foreground">{row.original.description}</p>
          ) : null}
        </div>
      ),
    },
    {
      id: 'ref',
      header: 'Reference',
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <span className="font-mono text-xs break-all">{row.original.ref}</span>
          {row.original.digest ? (
            <Badge variant="info" title={row.original.digest}>
              pinned {shortDigest(row.original.digest, 8)}
            </Badge>
          ) : null}
          <CopyRef value={pinnedRef(row.original)} />
        </div>
      ),
    },
    {
      id: 'engine',
      header: 'Engine',
      cell: ({ row }) => <EngineBadge engine={engineOf(row.original)} />,
    },
    {
      id: 'versions',
      header: 'Ray / Python',
      cell: ({ row }) => (
        <span className="text-sm">
          {row.original.ray_version || <span className="text-muted-foreground">—</span>}
          <span className="text-muted-foreground"> / </span>
          {row.original.python_version || <span className="text-muted-foreground">—</span>}
        </span>
      ),
    },
    {
      id: 'projects',
      header: 'Projects',
      cell: ({ row }) => <ProjectsCell projects={row.original.projects} />,
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <Button size="sm" variant="outline" onClick={() => setInspecting(row.original)}>
          <ScanSearch className="size-4" aria-hidden /> Inspect
        </Button>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Images"
        description="Images an administrator has approved for clusters and jobs, with their Ray and Python versions stated. Inspect one to see what it runs as and how it was built — read from the registry, nothing is pulled."
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
          icon={canEdit ? Container : Lock}
          title="No approved images yet"
          description={
            canEdit
              ? 'Add images to the catalog under Settings. Until then every project runs whatever image its admission allowlist permits.'
              : 'Your projects have no catalog images. Clusters and jobs use the image reference you give them, within the administrator’s allowlist.'
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
      <InspectDialog entry={inspecting} onClose={() => setInspecting(null)} />
    </>
  )
}
