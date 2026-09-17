import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Lock, Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { useCanEditPolicy } from '@/auth/permissions'
import { ApiErrorState, EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { PairEditor } from '@/components/pair-editor'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { api } from '@/lib/api'
import type { PolicyView } from '@/lib/api'
import { ImagesCard } from '@/routes/settings-images'
import type { PairRow } from '@/lib/pools'
import {
  formatQuotaLimits,
  priceUnitLabel,
  pricesToRows,
  rowsToAmounts,
  sourceBadge,
  withProjectQuota,
} from '@/lib/settings'

/**
 * Save-error idiom for both cards: the backend's 400 names the offending
 * key in plain text and surfaces verbatim (BifrostApiError.message).
 */
function mutationMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Price sheet card: view table, inline edit via PairEditor, clear with confirm. */
function PriceSheetCard({ policy }: { policy: PolicyView }) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [rows, setRows] = useState<PairRow[]>([])
  const [confirmClear, setConfirmClear] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const saveMutation = useMutation({
    mutationFn: (prices: Record<string, number> | null) =>
      api.updatePolicy({ prices }),
    onSuccess: () => {
      setEditing(false)
      setConfirmClear(false)
      setError(null)
      queryClient.invalidateQueries({ queryKey: ['settings-policy'] })
    },
    onError: (err) => setError(mutationMessage(err)),
  })

  const startEdit = () => {
    setRows(pricesToRows(policy.prices))
    setError(null)
    setEditing(true)
  }

  const save = () => {
    const result = rowsToAmounts(rows, 'price')
    if (typeof result === 'string') {
      setError(result)
      return
    }
    saveMutation.mutate(result)
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2">
          Price sheet
          <Badge variant="secondary">{sourceBadge(policy.source)}</Badge>
        </CardTitle>
        {!editing && policy.prices != null ? (
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={startEdit}>
              <Pencil className="size-4" aria-hidden /> Edit
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setError(null)
                setConfirmClear(true)
              }}
            >
              <Trash2 className="size-4" aria-hidden /> Clear
            </Button>
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {policy.prices == null && !editing ? (
          <EmptyState
            title="No price sheet configured"
            description="Per-cluster cost estimates stay off until a price sheet is set."
            action={
              <Button size="sm" variant="outline" onClick={startEdit}>
                Add price sheet
              </Button>
            }
          />
        ) : editing ? (
          <div className="space-y-3">
            <PairEditor
              rows={rows}
              onChange={setRows}
              keyPlaceholder="resource (e.g. cpu, memory, nvidia.com/gpu)"
              valuePlaceholder="$/unit-hour (e.g. 0.048)"
              addLabel="Add resource price"
            />
            {error ? (
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            ) : null}
            <div className="flex gap-2">
              <Button size="sm" onClick={save} disabled={saveMutation.isPending}>
                {saveMutation.isPending ? 'Saving…' : 'Save price sheet'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setEditing(false)
                  setError(null)
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Resource</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Unit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Object.entries(policy.prices ?? {}).map(([key, value]) => (
                <TableRow key={key}>
                  <TableCell className="font-mono text-xs">{key}</TableCell>
                  <TableCell>${value}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {priceUnitLabel(key)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <p className="text-xs text-muted-foreground">
          Edits save to the store and win over the <code>--policy</code> file.
        </p>
      </CardContent>

      <Dialog open={confirmClear} onOpenChange={setConfirmClear}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear price sheet?</DialogTitle>
            <DialogDescription>
              Cost estimates turn off until a new sheet is configured. Quotas
              are unaffected.
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setConfirmClear(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={saveMutation.isPending}
              onClick={() => saveMutation.mutate(null)}
            >
              {saveMutation.isPending ? 'Clearing…' : 'Clear price sheet'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

/** Per-project quota edit dialog (also the add-project dialog). */
function ProjectQuotaDialog({
  project,
  policy,
  open,
  onOpenChange,
}: {
  /** Existing project name, or null when adding a new one. */
  project: string | null
  policy: PolicyView
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(project ?? '')
  const [rows, setRows] = useState<PairRow[]>([])
  const [error, setError] = useState<string | null>(null)

  // Re-seed the form each time the dialog opens for a (possibly different)
  // project.
  const reset = () => {
    setName(project ?? '')
    setRows(
      project != null
        ? Object.entries(policy.quotas[project] ?? {}).map(([key, value]) => ({
            key,
            value: String(value),
          }))
        : [],
    )
    setError(null)
  }

  const saveMutation = useMutation({
    mutationFn: (resources: Record<string, number>) =>
      api.updatePolicy({
        quotas: withProjectQuota(policy.quotas, name.trim(), resources),
      }),
    onSuccess: () => {
      onOpenChange(false)
      setError(null)
      queryClient.invalidateQueries({ queryKey: ['settings-policy'] })
    },
    onError: (err) => setError(mutationMessage(err)),
  })

  const save = () => {
    if (name.trim() === '') {
      setError('project name is required')
      return
    }
    const result = rowsToAmounts(rows, 'quota')
    if (typeof result === 'string') {
      setError(result)
      return
    }
    if (Object.keys(result).length === 0) {
      setError('add at least one resource limit (an empty quota deletes the project)')
      return
    }
    saveMutation.mutate(result)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {project != null ? `Edit quota: ${project}` : 'Add project quota'}
          </DialogTitle>
          <DialogDescription>
            Resource limits checked on cluster create (max demand). Amounts
            are plain numbers per resource key.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            save()
          }}
        >
          <Input
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setError(null)
            }}
            placeholder="project name"
            aria-label="Project name"
            disabled={project != null}
            className="font-mono text-xs"
          />
          <PairEditor
            rows={rows}
            onChange={setRows}
            keyPlaceholder="resource (e.g. cpu)"
            valuePlaceholder="amount (e.g. 500)"
            addLabel="Add resource limit"
          />
          {error ? (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={saveMutation.isPending}>
              {saveMutation.isPending ? 'Saving…' : 'Save quota'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Project quotas card: table + per-project edit/delete + add. */
function QuotasCard({ policy }: { policy: PolicyView }) {
  const queryClient = useQueryClient()
  const [editProject, setEditProject] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const projects = Object.keys(policy.quotas).sort()

  const deleteMutation = useMutation({
    mutationFn: (project: string) =>
      api.updatePolicy({ quotas: withProjectQuota(policy.quotas, project, null) }),
    onSuccess: () => {
      setConfirmDelete(null)
      setError(null)
      queryClient.invalidateQueries({ queryKey: ['settings-policy'] })
    },
    onError: (err) => setError(mutationMessage(err)),
  })

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2">
          Project quotas
          <Badge variant="secondary">{sourceBadge(policy.source)}</Badge>
        </CardTitle>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setEditProject(null)
            setDialogOpen(true)
          }}
        >
          Add project
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {projects.length === 0 ? (
          <EmptyState
            title="No project quotas"
            description="Projects are unlimited until a quota is set — admission is checked on cluster create (max demand)."
            action={
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setEditProject(null)
                  setDialogOpen(true)
                }}
              >
                Add project quota
              </Button>
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead>Limits</TableHead>
                <TableHead className="w-0" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.map((project) => (
                <TableRow key={project}>
                  <TableCell className="font-medium">{project}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {formatQuotaLimits(policy.quotas[project])}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditProject(project)
                          setDialogOpen(true)
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setError(null)
                          setConfirmDelete(project)
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <p className="text-xs text-muted-foreground">
          Quota admission is checked on cluster create (max demand); cost
          estimates from the price sheet show on cluster cards. Edits save to
          the store and win over the <code>--policy</code> file.
        </p>
      </CardContent>

      <ProjectQuotaDialog
        key={editProject ?? 'new'}
        project={editProject}
        policy={policy}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />

      <Dialog
        open={confirmDelete !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDelete(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete quota for {confirmDelete}?</DialogTitle>
            <DialogDescription>
              The project becomes unlimited — admission stops checking it on
              cluster create.
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (confirmDelete) deleteMutation.mutate(confirmDelete)
              }}
            >
              {deleteMutation.isPending ? 'Deleting…' : 'Delete quota'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

/**
 * Settings (spec §5.9, api-v1.md §5.16 — implemented): the store-backed,
 * API-editable governance policy — price sheet (cost estimates) and
 * per-project quotas. Admin-only; non-admins get the lock state instead of
 * the backend's 403.
 */
export function SettingsPage() {
  const canEdit = useCanEditPolicy()
  const query = useQuery({
    queryKey: ['settings-policy'],
    queryFn: api.policy,
    retry: false,
    enabled: canEdit,
  })

  if (!canEdit) {
    return (
      <>
        <PageHeader
          title="Settings"
          description="Governance policy: price sheet and project quotas."
        />
        <EmptyState
          icon={Lock}
          title="Admin role required"
          description="Governance policy is platform configuration (api-v1.md §2.2); only admins can view or edit it."
        />
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Settings"
        description="Governance policy: price sheet, project quotas and the approved-image catalog. (Admin)"
      />
      {query.isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : query.isError ? (
        <ApiErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <PriceSheetCard policy={query.data} />
          <QuotasCard policy={query.data} />
          <ImagesCard policy={query.data} />
        </div>
      )}
    </>
  )
}
