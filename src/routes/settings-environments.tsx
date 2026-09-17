import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router'

import { PairEditor } from '@/components/pair-editor'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
import type { EnvironmentFormState, EnvironmentSpec, EnvironmentStatus } from '@/lib/environments'
import {
  allowedTransitions,
  emptyEnvironmentForm,
  environmentStatus,
  environmentToForm,
  formToEnvironment,
  transitionLabel,
  validateEnvironmentForm,
  withEnvironment,
  withEnvironmentStatus,
  withoutEnvironment,
} from '@/lib/environments'
import { EnvironmentStatusBadge, ScanBadge } from '@/routes/environments'

function mutationMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

const TEXTAREA_CLASS =
  'flex w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm text-muted-foreground">{label}</span>
      {children}
      {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  )
}

/** Add / edit one environment. Status is changed from the card, not here. */
function EnvironmentDialog({
  policy,
  editing,
  onClose,
}: {
  policy: PolicyView
  editing: EnvironmentSpec | 'new'
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const previous = editing !== 'new' ? editing : undefined
  const [form, setForm] = useState<EnvironmentFormState>(() =>
    previous ? environmentToForm(previous) : emptyEnvironmentForm(),
  )
  const [errors, setErrors] = useState<string[]>([])
  const environments = policy.environments ?? []

  const save = useMutation({
    mutationFn: (next: EnvironmentSpec[]) => api.updatePolicy({ environments: next }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings-policy'] })
      queryClient.invalidateQueries({ queryKey: ['environments'] })
      onClose()
    },
    onError: (err) => setErrors([mutationMessage(err)]),
  })

  const patch = (p: Partial<EnvironmentFormState>) => setForm((f) => ({ ...f, ...p }))
  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    const validation = validateEnvironmentForm(form, environments, previous?.name)
    setErrors(validation)
    if (validation.length > 0) return
    save.mutate(withEnvironment(environments, formToEnvironment(form, previous), previous?.name))
  }
  const contentChanged =
    previous != null &&
    previous.scan != null &&
    (form.baseImage.trim() !== (previous.base_image ?? '') ||
      form.packages.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('#')).join('\n') !==
        (previous.packages ?? []).join('\n'))

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-h-[90vh] w-[min(44rem,calc(100vw-2rem))] max-w-none overflow-y-auto">
        <form onSubmit={onSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{previous ? `Edit ${previous.name}` : 'New environment'}</DialogTitle>
            <DialogDescription>
              A base image plus pinned packages and env vars. Jobs that name it get the compiled
              runtime_env at submit; nothing is built. New entries start as drafts — publish from the
              catalog once you are happy with them.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" hint="RFC 1123 label: lowercase, digits, hyphens.">
              <Input value={form.name} onChange={(e) => patch({ name: e.target.value })} placeholder="ml-base" disabled={previous != null && environmentStatus(previous) !== 'draft'} />
            </Field>
            <Field label="Description (optional)">
              <Input value={form.description} onChange={(e) => patch({ description: e.target.value })} placeholder="Ray 2.56 with the genomics stack" />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Base image (optional)" hint="Fills the job's image; the project's admission allowlist applies. Empty = the job brings its own image.">
                <Input value={form.baseImage} onChange={(e) => patch({ baseImage: e.target.value })} placeholder="rayproject/ray:2.56.0" className="font-mono text-xs" />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Packages (one per line, pinned)" hint="pip requirements as name[extras]==version; an unpinned entry is refused because it installs whatever the index serves.">
                <textarea
                  value={form.packages}
                  onChange={(e) => patch({ packages: e.target.value })}
                  rows={5}
                  spellCheck={false}
                  placeholder={'scanpy==1.10.2\npolars==1.9.0'}
                  className={TEXTAREA_CLASS}
                />
              </Field>
            </div>
            <div className="sm:col-span-2 space-y-1">
              <span className="text-sm text-muted-foreground">Environment variables</span>
              <PairEditor rows={form.envVars} onChange={(envVars) => patch({ envVars })} keyPlaceholder="OMP_NUM_THREADS" valuePlaceholder="1" addLabel="Add variable" />
            </div>
            <div className="sm:col-span-2">
              <Field label="runtime_env escape hatch (YAML, optional)" hint="For what the fields above cannot express (working_dir, py_modules, config). It may not set pip when packages are listed, nor repeat an env var.">
                <textarea
                  value={form.runtimeEnvYaml}
                  onChange={(e) => patch({ runtimeEnvYaml: e.target.value })}
                  rows={3}
                  spellCheck={false}
                  placeholder={'config:\n  setup_timeout_seconds: 300'}
                  className={TEXTAREA_CLASS}
                />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Projects (optional)" hint="Comma-separated; empty means every project may name it.">
                <Input value={form.projects} onChange={(e) => patch({ projects: e.target.value })} placeholder="team-a, team-b" />
              </Field>
            </div>
          </div>
          {contentChanged ? (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
              Changing the base image or packages drops the recorded scan verdict; re-scan before relying on the scan gate.
            </p>
          ) : null}
          {errors.length > 0 ? (
            <ul className="list-inside list-disc rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : previous ? 'Save changes' : 'Create draft'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Governed environments card (#52–#58): the catalog with its lifecycle —
 * drafts publish, published entries deprecate, deprecated ones return to
 * draft — and the recorded scan verdict per entry. Section-replace PUTs
 * merged against the current view; the server stamps publishes and audits
 * every lifecycle move.
 */
export function EnvironmentsCard({ policy }: { policy: PolicyView }) {
  const queryClient = useQueryClient()
  const environments = policy.environments ?? []
  const [editing, setEditing] = useState<EnvironmentSpec | 'new' | null>(null)
  const [dialogKey, setDialogKey] = useState(0)
  const [removing, setRemoving] = useState<EnvironmentSpec | null>(null)
  const [error, setError] = useState<string | null>(null)

  const open = (target: EnvironmentSpec | 'new') => {
    setDialogKey((k) => k + 1)
    setEditing(target)
  }
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['settings-policy'] })
    queryClient.invalidateQueries({ queryKey: ['environments'] })
  }
  const update = useMutation({
    mutationFn: (next: EnvironmentSpec[]) => api.updatePolicy({ environments: next }),
    onSuccess: () => {
      setRemoving(null)
      setError(null)
      invalidate()
    },
    onError: (err) => setError(mutationMessage(err)),
  })
  const move = (env: EnvironmentSpec, to: EnvironmentStatus) =>
    update.mutate(withEnvironmentStatus(environments, env.name, to))

  return (
    <Card className="lg:col-span-2">
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            Environments
            <Badge variant="secondary">{environments.length}</Badge>
          </CardTitle>
          <CardDescription className="mt-1">
            Governed environments jobs name instead of writing their own runtime_env: a base image,
            pinned packages, env vars. Drafts are editable and not selectable; publishing makes one
            selectable; deprecating retires it for new jobs. <Link className="underline" to="/environments">Environments</Link>{' '}
            shows what users see.
          </CardDescription>
        </div>
        <Button size="sm" onClick={() => open('new')}>
          <Plus className="size-4" aria-hidden /> New environment
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {environments.length === 0 ? (
          <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            No environments yet. Create a draft, then publish it so jobs can name it.
          </p>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Base image</TableHead>
                  <TableHead>Packages</TableHead>
                  <TableHead>Scan</TableHead>
                  <TableHead>Projects</TableHead>
                  <TableHead className="w-64" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {environments.map((env) => {
                  const status = environmentStatus(env)
                  return (
                    <TableRow key={env.name}>
                      <TableCell>
                        <div className="font-medium">{env.name}</div>
                        {env.description ? <div className="text-xs text-muted-foreground">{env.description}</div> : null}
                      </TableCell>
                      <TableCell><EnvironmentStatusBadge env={env} /></TableCell>
                      <TableCell className="font-mono text-xs break-all">{env.base_image || <span className="text-muted-foreground">job's own</span>}</TableCell>
                      <TableCell className="text-sm">{(env.packages ?? []).length}</TableCell>
                      <TableCell><ScanBadge env={env} /></TableCell>
                      <TableCell className="text-xs">
                        {(env.projects ?? []).length > 0 ? env.projects!.join(', ') : <span className="text-muted-foreground">every project</span>}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          {allowedTransitions(status).map((to) => (
                            <Button key={to} size="sm" variant={to === 'published' ? 'default' : 'outline'} disabled={update.isPending} onClick={() => move(env, to)}>
                              {transitionLabel(to)}
                            </Button>
                          ))}
                          <Button size="sm" variant="ghost" onClick={() => open(env)} title="Edit">
                            <Pencil className="size-4" aria-hidden />
                            <span className="sr-only">Edit {env.name}</span>
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setRemoving(env)} title="Remove">
                            <Trash2 className="size-4" aria-hidden />
                            <span className="sr-only">Remove {env.name}</span>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Scan verdicts are recorded from the offline scan workflow (<code>scripts/scan-environment.py</code>:
          trivy on the base image, pip-audit on the packages); editing an entry's image or packages clears its verdict.
        </p>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </CardContent>

      {editing !== null ? (
        <EnvironmentDialog key={dialogKey} policy={policy} editing={editing} onClose={() => setEditing(null)} />
      ) : null}

      <Dialog open={removing != null} onOpenChange={(open) => (!open ? setRemoving(null) : undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {removing?.name}?</DialogTitle>
            <DialogDescription>
              Jobs already submitted keep the environment they were admitted with. New jobs can no longer name it.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setRemoving(null)}>Cancel</Button>
            <Button variant="destructive" size="sm" disabled={update.isPending} onClick={() => removing && update.mutate(withoutEnvironment(environments, removing.name))}>
              {update.isPending ? 'Removing…' : 'Remove environment'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
