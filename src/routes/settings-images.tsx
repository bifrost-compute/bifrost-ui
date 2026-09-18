import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router'

import { EngineBadge } from '@/components/engine-badge'
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
import type { Engine } from '@/lib/engine'
import type { ImageEntry, ImageFormState, ImageSource, SourceFormState } from '@/lib/images'
import {
  catalogOnlyProjects,
  emptyImageForm,
  emptySourceForm,
  engineOf,
  formToImage,
  formToSource,
  imageToForm,
  shortDigest,
  sourceRefOptions,
  suggestImageName,
  validateImageForm,
  validateSourceForm,
  withCatalogOnly,
  withImage,
  withSource,
  withoutImage,
  withoutSource,
} from '@/lib/images'
import { cn } from '@/lib/utils'

function mutationMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="block space-y-1">
      <span className="text-sm text-muted-foreground">{label}</span>
      {children}
      {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  )
}

/** Add / edit one catalog entry. The PUT carries the whole catalog. */
function ImageDialog({
  policy,
  editing,
  onClose,
}: {
  policy: PolicyView
  /** `null` = closed; an entry = edit; `'new'` = add. */
  editing: ImageEntry | 'new' | null
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const previous = editing !== null && editing !== 'new' ? editing : undefined
  const [form, setForm] = useState<ImageFormState>(() =>
    previous ? imageToForm(previous) : emptyImageForm(),
  )
  const [errors, setErrors] = useState<string[]>([])
  const images = policy.images ?? []

  const save = useMutation({
    mutationFn: (next: ImageEntry[]) => api.updatePolicy({ images: next }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings-policy'] })
      queryClient.invalidateQueries({ queryKey: ['images'] })
      onClose()
    },
    onError: (err) => setErrors([mutationMessage(err)]),
  })

  const patch = (p: Partial<ImageFormState>) => setForm((f) => ({ ...f, ...p }))
  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    const validation = validateImageForm(form, images, previous?.name)
    setErrors(validation)
    if (validation.length > 0) return
    save.mutate(withImage(images, formToImage(form), previous?.name))
  }

  return (
    <Dialog open={editing !== null} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-w-lg">
        <form onSubmit={onSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{previous ? `Edit ${previous.name}` : 'Add an approved image'}</DialogTitle>
            <DialogDescription>
              State what the image carries instead of letting the tag imply it. A
              pinned digest means exactly this manifest runs, whatever the tag later
              points at.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" hint="What users pick in the cluster form.">
              <Input value={form.name} onChange={(e) => patch({ name: e.target.value })} placeholder="ray-2.56-cpu" />
            </Field>
            <div className="space-y-1">
              <span className="block text-sm text-muted-foreground">Engine</span>
              <div role="radiogroup" aria-label="Image engine" className="inline-flex rounded-md border p-0.5">
                {(['ray', 'dask'] as const).map((engine: Engine) => (
                  <button
                    key={engine}
                    type="button"
                    role="radio"
                    aria-checked={form.engine === engine}
                    onClick={() => patch({ engine })}
                    className={cn(
                      'rounded px-3 py-1 text-sm transition-colors',
                      form.engine === engine
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {engine === 'dask' ? 'Dask' : 'Ray'}
                  </button>
                ))}
              </div>
            </div>
            <div className="sm:col-span-2">
              <SourcePicker
                onPick={(ref) =>
                  patch({ ref, name: form.name.trim() === '' ? suggestImageName(ref) : form.name })
                }
              />
            </div>
            <div className="sm:col-span-2">
              <Field label="Reference" hint="registry/repo:tag, or registry/repo@sha256:… to pin in the reference itself.">
                <Input
                  value={form.ref}
                  onChange={(e) => patch({ ref: e.target.value })}
                  placeholder="artifacts.example/ray/team:2.56.0"
                  className="font-mono text-xs"
                />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Pinned digest (optional)" hint="sha256: and 64 hex characters; empty follows the tag.">
                <Input
                  value={form.digest}
                  onChange={(e) => patch({ digest: e.target.value })}
                  placeholder="sha256:…"
                  className="font-mono text-xs"
                />
              </Field>
            </div>
            {form.engine === 'ray' ? (
              <Field label="Ray version" hint="Required for Ray: head, workers and client must agree.">
                <Input value={form.rayVersion} onChange={(e) => patch({ rayVersion: e.target.value })} placeholder="2.56.0" />
              </Field>
            ) : null}
            <Field label="Python version (optional)" hint="Shown to notebook users for kernel matching.">
              <Input value={form.pythonVersion} onChange={(e) => patch({ pythonVersion: e.target.value })} placeholder="3.11" />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Projects (optional)" hint="Comma-separated; empty means every project may use it.">
                <Input value={form.projects} onChange={(e) => patch({ projects: e.target.value })} placeholder="team-a, team-b" />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Description (optional)">
                <Input value={form.description} onChange={(e) => patch({ description: e.target.value })} placeholder="CPU base with scanpy and polars" />
              </Field>
            </div>
          </div>
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
              {save.isPending ? 'Saving…' : previous ? 'Save changes' : 'Add image'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Image catalog card (#10): the approved images and which projects must
 * use them. Both sections are section-replace PUTs merged client-side
 * against the current view; the admission edit preserves every other knob
 * of a project's rule.
 */
export function ImagesCard({ policy }: { policy: PolicyView }) {
  const queryClient = useQueryClient()
  const images = policy.images ?? []
  const [editing, setEditing] = useState<ImageEntry | 'new' | null>(null)
  const [dialogKey, setDialogKey] = useState(0)
  const [removing, setRemoving] = useState<ImageEntry | null>(null)
  const [project, setProject] = useState('')
  const [error, setError] = useState<string | null>(null)

  const open = (target: ImageEntry | 'new') => {
    setDialogKey((k) => k + 1)
    setEditing(target)
  }

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['settings-policy'] })
    queryClient.invalidateQueries({ queryKey: ['images'] })
  }
  const remove = useMutation({
    mutationFn: (name: string) => api.updatePolicy({ images: withoutImage(images, name) }),
    onSuccess: () => {
      setRemoving(null)
      setError(null)
      invalidate()
    },
    onError: (err) => setError(mutationMessage(err)),
  })
  const admission = useMutation({
    mutationFn: ({ name, on }: { name: string; on: boolean }) =>
      api.updatePolicy({ admission: withCatalogOnly(policy.admission, name, on) }),
    onSuccess: () => {
      setProject('')
      setError(null)
      invalidate()
    },
    onError: (err) => setError(mutationMessage(err)),
  })
  const catalogOnly = catalogOnlyProjects(policy.admission)

  return (
    <Card className="lg:col-span-2">
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            Image catalog
            <Badge variant="secondary">{images.length}</Badge>
          </CardTitle>
          <CardDescription className="mt-1">
            Images approved for clusters and jobs, with their engine and Ray version
            stated. Users pick from these; <Link className="underline" to="/images">Images</Link>{' '}
            inspects any of them straight from its registry.
          </CardDescription>
        </div>
        <Button size="sm" onClick={() => open('new')}>
          <Plus className="size-4" aria-hidden /> Add image
        </Button>
      </CardHeader>
      <CardContent className="space-y-6">
        {images.length === 0 ? (
          <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            No approved images yet. Add the first one, then make a project catalog-only
            below so only vetted images run there.
          </p>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Engine</TableHead>
                  <TableHead>Ray / Python</TableHead>
                  <TableHead>Projects</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {images.map((entry) => (
                  <TableRow key={entry.name}>
                    <TableCell>
                      <div className="font-medium">{entry.name}</div>
                      {entry.description ? (
                        <div className="text-xs text-muted-foreground">{entry.description}</div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-xs break-all">{entry.ref}</span>
                      {entry.digest ? (
                        <Badge variant="info" className="ml-1" title={entry.digest}>
                          pinned {shortDigest(entry.digest, 8)}
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell><EngineBadge engine={engineOf(entry)} /></TableCell>
                    <TableCell className="text-sm">
                      {entry.ray_version || '—'} / {entry.python_version || '—'}
                    </TableCell>
                    <TableCell className="text-xs">
                      {entry.projects && entry.projects.length > 0
                        ? entry.projects.join(', ')
                        : <span className="text-muted-foreground">every project</span>}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => open(entry)} title="Edit">
                          <Pencil className="size-4" aria-hidden />
                          <span className="sr-only">Edit {entry.name}</span>
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setRemoving(entry)} title="Remove">
                          <Trash2 className="size-4" aria-hidden />
                          <span className="sr-only">Remove {entry.name}</span>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <div className="space-y-2">
          <h3 className="text-sm font-medium">Catalog-only projects</h3>
          <p className="text-xs text-muted-foreground">
            A project listed here admits only catalog images open to it; anything else is
            refused at create with an audit row. Use <code>*</code> for every project. Other
            admission settings of the project are kept as they are.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {catalogOnly.length === 0 ? (
              <span className="text-sm text-muted-foreground">None — every project may run any allowlisted image.</span>
            ) : (
              catalogOnly.map((name) => (
                <Badge key={name} variant="outline" className="gap-1 pr-1">
                  {name}
                  <button
                    type="button"
                    className="rounded px-1 text-muted-foreground hover:text-foreground"
                    title={`Stop requiring catalog images for ${name}`}
                    onClick={() => admission.mutate({ name, on: false })}
                    disabled={admission.isPending}
                  >
                    ×<span className="sr-only">remove {name}</span>
                  </button>
                </Badge>
              ))
            )}
          </div>
          <form
            className="flex max-w-md items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              const name = project.trim()
              if (name === '') return
              admission.mutate({ name, on: true })
            }}
          >
            <Input
              value={project}
              onChange={(e) => setProject(e.target.value)}
              placeholder="project name, or *"
              aria-label="Project to make catalog-only"
            />
            <Button type="submit" size="sm" variant="outline" disabled={admission.isPending || project.trim() === ''}>
              Require catalog
            </Button>
          </form>
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </CardContent>

      {editing !== null ? (
        <ImageDialog key={dialogKey} policy={policy} editing={editing} onClose={() => setEditing(null)} />
      ) : null}

      <Dialog open={removing != null} onOpenChange={(open) => (!open ? setRemoving(null) : undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {removing?.name}?</DialogTitle>
            <DialogDescription>
              Running clusters keep the image they were admitted with. New clusters in
              catalog-only projects can no longer pick it.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setRemoving(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={remove.isPending}
              onClick={() => removing && remove.mutate(removing.name)}
            >
              {remove.isPending ? 'Removing…' : 'Remove image'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

const selectClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50'

/**
 * Pick a reference from an image source (#10): choose a source, then one
 * of the tags its registry lists right now. Fills the reference (and a
 * suggested name) instead of having the administrator type it. Renders
 * nothing when the control plane has no sources or is too old to list them.
 */
export function SourcePicker({ onPick }: { onPick: (ref: string) => void }) {
  const sources = useQuery({ queryKey: ['image-sources'], queryFn: api.imageSources, retry: false })
  const [source, setSource] = useState('')
  const tags = useQuery({
    queryKey: ['image-source-tags', source],
    queryFn: () => api.imageSourceTags(source),
    enabled: source !== '',
    retry: false,
  })
  const list = sources.data ?? []
  if (sources.isError || list.length === 0) return null
  const options = sourceRefOptions(tags.data)
  const byRepository = new Map<string, typeof options>()
  for (const o of options) {
    const group = byRepository.get(o.repository) ?? []
    group.push(o)
    byRepository.set(o.repository, group)
  }
  return (
    <div className="rounded-md border border-dashed p-3 space-y-2">
      <div className="text-sm font-medium">Pick from a source</div>
      <div className="grid gap-2 sm:grid-cols-2">
        <select
          aria-label="Image source"
          className={selectClass}
          value={source}
          onChange={(e) => setSource(e.target.value)}
        >
          <option value="">Choose a registry source…</option>
          {list.map((s) => (
            <option key={s.name} value={s.name}>
              {s.name} — {s.registry}
              {s.repository ? `/${s.repository}` : ''}
            </option>
          ))}
        </select>
        <select
          aria-label="Image tag"
          className={selectClass}
          disabled={source === '' || tags.isPending || options.length === 0}
          value=""
          onChange={(e) => {
            if (e.target.value !== '') onPick(e.target.value)
          }}
        >
          <option value="">
            {source === ''
              ? 'Then pick a tag'
              : tags.isPending
                ? 'Listing tags…'
                : tags.isError
                  ? 'Registry could not be read'
                  : options.length === 0
                    ? 'No tags listed'
                    : `${options.length} tag${options.length === 1 ? '' : 's'} available`}
          </option>
          {[...byRepository.entries()].map(([repository, group]) => (
            <optgroup key={repository} label={repository}>
              {group.map((o) => (
                <option key={o.ref} value={o.ref}>
                  {o.tag}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      {tags.isError ? (
        <p className="text-xs text-destructive">{mutationMessage(tags.error)}</p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Tags are read from the registry as it lists them now; picking one fills the
          reference below and suggests a name. Adding it to the catalog is what approves it.
        </p>
      )}
    </div>
  )
}

/** Add one image source. The PUT carries the whole list. */
function SourceDialog({
  policy,
  open,
  onClose,
}: {
  policy: PolicyView
  open: boolean
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const sources = policy.image_sources ?? []
  const [form, setForm] = useState<SourceFormState>(emptySourceForm)
  const [errors, setErrors] = useState<string[]>([])
  const save = useMutation({
    mutationFn: (next: ImageSource[]) => api.updatePolicy({ image_sources: next }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings-policy'] })
      queryClient.invalidateQueries({ queryKey: ['image-sources'] })
      onClose()
    },
    onError: (err) => setErrors([mutationMessage(err)]),
  })
  const patch = (p: Partial<SourceFormState>) => setForm((f) => ({ ...f, ...p }))
  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    const validation = validateSourceForm(form, sources)
    setErrors(validation)
    if (validation.length > 0) return
    save.mutate(withSource(sources, formToSource(form)))
  }
  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent className="max-w-lg">
        <form onSubmit={onSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Add an image source</DialogTitle>
            <DialogDescription>
              A registry repository to browse for catalog candidates. Name the registry as
              image references do — what the nodes pull from; how the control plane reaches
              it and as whom is the deployment's registries file.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" hint="RFC 1123 label.">
              <Input value={form.name} onChange={(e) => patch({ name: e.target.value })} placeholder="ak-ray" />
            </Field>
            <Field label="Registry" hint="host[:port], e.g. localhost:32000 or an Artifact Keeper Service address.">
              <Input value={form.registry} onChange={(e) => patch({ registry: e.target.value })} placeholder="artifact-keeper-backend.artifact-keeper.svc.cluster.local:8080" className="font-mono text-xs" />
            </Field>
            <Field label="Repository (optional)" hint="One repository to list; empty lists the registry's whole catalog.">
              <Input value={form.repository} onChange={(e) => patch({ repository: e.target.value })} placeholder="ray/team" className="font-mono text-xs" />
            </Field>
            <Field label="Projects (optional)" hint="Comma-separated; empty means every project's administrators may browse it.">
              <Input value={form.projects} onChange={(e) => patch({ projects: e.target.value })} placeholder="team-a, team-b" />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Description (optional)">
                <Input value={form.description} onChange={(e) => patch({ description: e.target.value })} placeholder="Images the Artifact Keeper builder pushes for team-a" />
              </Field>
            </div>
          </div>
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
              {save.isPending ? 'Saving…' : 'Add source'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Image sources card (#10): the registry repositories the "Add image"
 * dialog can pick tags from. Section-replace PUT merged client-side.
 */
export function ImageSourcesCard({ policy }: { policy: PolicyView }) {
  const queryClient = useQueryClient()
  const sources = policy.image_sources ?? []
  const [adding, setAdding] = useState(false)
  const [dialogKey, setDialogKey] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const remove = useMutation({
    mutationFn: (name: string) => api.updatePolicy({ image_sources: withoutSource(sources, name) }),
    onSuccess: () => {
      setError(null)
      queryClient.invalidateQueries({ queryKey: ['settings-policy'] })
      queryClient.invalidateQueries({ queryKey: ['image-sources'] })
    },
    onError: (err) => setError(mutationMessage(err)),
  })
  return (
    <Card className="lg:col-span-2">
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            Image sources
            <Badge variant="secondary">{sources.length}</Badge>
          </CardTitle>
          <CardDescription className="mt-1">
            Registry repositories the catalog can pick from. Their tags are listed live
            when adding an image, so a build pipeline&apos;s pushes show up without anyone
            typing a reference. A source approves nothing; the catalog does.
          </CardDescription>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setDialogKey((k) => k + 1)
            setAdding(true)
          }}
        >
          <Plus className="size-4" aria-hidden /> Add source
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {sources.length === 0 ? (
          <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            No sources yet. Point one at the registry your builds land in and the
            &quot;Add image&quot; dialog gains a pick-list of its tags.
          </p>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Registry</TableHead>
                  <TableHead>Repository</TableHead>
                  <TableHead>Projects</TableHead>
                  <TableHead className="w-16" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sources.map((s) => (
                  <TableRow key={s.name}>
                    <TableCell>
                      <div className="font-medium">{s.name}</div>
                      {s.description ? (
                        <div className="text-xs text-muted-foreground">{s.description}</div>
                      ) : null}
                    </TableCell>
                    <TableCell className="font-mono text-xs break-all">{s.registry}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {s.repository ? s.repository : <span className="text-muted-foreground">whole catalog</span>}
                    </TableCell>
                    <TableCell className="text-xs">
                      {(s.projects ?? []).length === 0 ? (
                        <span className="text-muted-foreground">every project</span>
                      ) : (
                        (s.projects ?? []).join(', ')
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Remove source ${s.name}`}
                        disabled={remove.isPending}
                        onClick={() => remove.mutate(s.name)}
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </CardContent>
      <SourceDialog key={dialogKey} policy={policy} open={adding} onClose={() => setAdding(false)} />
    </Card>
  )
}
