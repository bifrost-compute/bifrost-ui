import type { Engine } from './engine'

/**
 * Image catalog + inspect (#10) — pure logic for the Images page, the
 * cluster form's image picker and the Settings catalog editor.
 *
 * UI-ahead: `GET /api/v1/images`, `GET /api/v1/images/{name}/inspect` and
 * the policy's `images` / `admission.catalog_only` sections landed in the
 * backend (bifrost@009abf3) but the published `@bifrost-compute/bifrost-client`
 * predates them, so the wire shapes are hand-written here in raw snake_case
 * (the hand-rolled `request()` does no camelCase mapping). Migrate to the
 * generated types once the client is republished.
 */

/** One approved image (`ImageEntry` in the contract). */
export interface ImageEntry {
  /** Catalog name clients show and pick. */
  name: string
  description?: string | null
  /** `registry/repo:tag` or `registry/repo@sha256:…`. */
  ref: string
  /** Manifest digest `ref` is pinned to; empty = the tag is followed. */
  digest?: string
  /** Absent = ray. */
  engine?: Engine
  ray_version?: string
  python_version?: string
  /** Empty = every project. */
  projects?: string[]
}

export interface ImagePlatform {
  os: string
  architecture: string
  variant?: string | null
}

export interface ImageConfig {
  env: Record<string, string>
  entrypoint: string[]
  cmd: string[]
  user: string
  working_dir: string
  exposed_ports: string[]
  labels: Record<string, string>
}

export interface ImageHistoryEntry {
  created_by: string
  created?: string | null
  comment?: string | null
  empty_layer: boolean
  layer_digest?: string | null
  size_bytes?: number | null
}

export interface ImageLayer {
  digest: string
  media_type: string
  size_bytes: number
}

/** `ImageInspect` in the contract: the image as its registry describes it. */
export interface ImageInspect {
  reference: string
  digest: string
  platforms: ImagePlatform[]
  size_bytes: number
  config: ImageConfig
  history: ImageHistoryEntry[]
  layers: ImageLayer[]
  source: string
}

/**
 * A project's admission rule. Only the fields this UI edits are typed; the
 * runtime-env governance knobs ride through untouched via the index
 * signature because `PUT {admission}` replaces the whole section.
 */
/**
 * Image source (#10): a registry repository administrators may browse
 * live for catalog candidates. A pointer, never an approval — only a
 * catalog entry makes a tag runnable.
 */
export interface ImageSource {
  /** RFC 1123 label. */
  name: string
  description?: string | null
  /** Registry host[:port] as image references name it (what the nodes pull from). */
  registry: string
  /** One repository to list; empty = the registry's whole catalog. */
  repository?: string
  /** Empty = every project. */
  projects?: string[]
}

export interface ImageSourceRepository {
  repository: string
  tags: string[]
  /** `registry/repository:tag` per tag, ready to become an `ImageEntry.ref`. */
  refs: string[]
}

export interface ImageSourceTags {
  name: string
  registry: string
  repositories: ImageSourceRepository[]
}

export interface AdmissionRule {
  allowed_images?: string[]
  max_workers?: number
  catalog_only?: boolean
  [key: string]: unknown
}

// --- References ---------------------------------------------------------------

/** `registry/repo` without tag or digest (a `:` before the last `/` is a port). */
export function imageRepository(ref: string): string {
  let out = ref
  const at = out.indexOf('@')
  if (at >= 0) out = out.slice(0, at)
  const slash = out.lastIndexOf('/')
  const colon = out.lastIndexOf(':')
  if (colon > slash) out = out.slice(0, colon)
  return out
}

/** The reference a spec should carry: `repo@digest` when pinned, else `ref`. */
export function pinnedRef(entry: ImageEntry): string {
  return entry.digest ? `${imageRepository(entry.ref)}@${entry.digest}` : entry.ref
}

/** `sha256:0123456789ab…` — enough of a digest to recognise, not to read. */
export function shortDigest(digest: string | null | undefined, head = 12): string {
  if (!digest) return ''
  const prefix = 'sha256:'
  if (digest.startsWith(prefix)) return `${prefix}${digest.slice(prefix.length, prefix.length + head)}`
  return digest.length > head ? `${digest.slice(0, head)}…` : digest
}

/** Binary units, one decimal: `812.3 MiB`, `4.1 GiB`. */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return '—'
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return unit === 0 ? `${value} B` : `${value.toFixed(1)} ${units[unit]}`
}

export function engineOf(entry: ImageEntry): Engine {
  return entry.engine === 'dask' ? 'dask' : 'ray'
}

// --- Dockerfile view ----------------------------------------------------------

export interface DockerfileLine {
  /** `FROM`, `RUN`, `ENV`, … (`RUN` when the recorder gave a bare shell command). */
  instruction: string
  /** The instruction line as a Dockerfile would show it. */
  text: string
  emptyLayer: boolean
  sizeBytes: number | null
  layerDigest: string | null
}

const INSTRUCTIONS = new Set([
  'FROM', 'RUN', 'CMD', 'LABEL', 'EXPOSE', 'ENV', 'ADD', 'COPY', 'ENTRYPOINT',
  'VOLUME', 'USER', 'WORKDIR', 'ARG', 'ONBUILD', 'STOPSIGNAL', 'HEALTHCHECK', 'SHELL',
])

/**
 * Normalize one `history[].created_by` into a Dockerfile line. The classic
 * builder records `/bin/sh -c #(nop)  ENV A=1` for metadata steps and
 * `/bin/sh -c pip install …` for RUN; BuildKit records the instruction
 * itself with a trailing `# buildkit`. Both come out as `ENV A=1` / `RUN
 * pip install …`, so the view reads like the Dockerfile that produced it.
 */
export function dockerfileLine(createdBy: string): { instruction: string; text: string } {
  let text = createdBy.trim().replace(/\s*#\s*buildkit\s*$/, '')
  const nop = text.match(/^\/bin\/sh -c #\(nop\)\s*(.*)$/s)
  if (nop) {
    text = nop[1].trim()
  } else if (text.startsWith('/bin/sh -c ')) {
    text = `RUN ${text.slice('/bin/sh -c '.length).trim()}`
  }
  // BuildKit records a shell-form RUN as `RUN /bin/sh -c cmd`; the shell is
  // implied in a Dockerfile, so the reconstruction drops it.
  text = text.replace(/^RUN \/bin\/sh -c /, 'RUN ')
  const first = text.split(/\s+/, 1)[0]?.toUpperCase() ?? ''
  if (INSTRUCTIONS.has(first)) {
    return { instruction: first, text: `${first}${text.slice(first.length)}` }
  }
  return { instruction: 'RUN', text: text === '' ? 'RUN' : `RUN ${text}` }
}

export function dockerfileLines(history: ImageHistoryEntry[]): DockerfileLine[] {
  return history.map((h) => ({
    ...dockerfileLine(h.created_by),
    emptyLayer: h.empty_layer,
    sizeBytes: h.empty_layer ? null : (h.size_bytes ?? null),
    layerDigest: h.empty_layer ? null : (h.layer_digest ?? null),
  }))
}

// --- Picker (cluster form) -----------------------------------------------------

/** The catalog entries offered for an engine, in catalog order. */
export function catalogOptionsFor(entries: ImageEntry[], engine: Engine): ImageEntry[] {
  return entries.filter((e) => engineOf(e) === engine)
}

/** The entry a typed image string is (exact ref or pinned ref), if any. */
export function catalogEntryForImage(
  entries: ImageEntry[],
  image: string,
): ImageEntry | undefined {
  const trimmed = image.trim()
  if (trimmed === '') return undefined
  return entries.find((e) => e.ref === trimmed || pinnedRef(e) === trimmed)
}

// --- Catalog editor (settings) ---------------------------------------------------

export interface ImageFormState {
  name: string
  description: string
  ref: string
  digest: string
  engine: Engine
  rayVersion: string
  pythonVersion: string
  /** Comma-separated; empty = every project. */
  projects: string
}

export function emptyImageForm(): ImageFormState {
  return {
    name: '',
    description: '',
    ref: '',
    digest: '',
    engine: 'ray',
    rayVersion: '',
    pythonVersion: '',
    projects: '',
  }
}

export function imageToForm(entry: ImageEntry): ImageFormState {
  return {
    name: entry.name,
    description: entry.description ?? '',
    ref: entry.ref,
    digest: entry.digest ?? '',
    engine: engineOf(entry),
    rayVersion: entry.ray_version ?? '',
    pythonVersion: entry.python_version ?? '',
    projects: (entry.projects ?? []).join(', '),
  }
}

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/

/** Client-side mirror of the backend's catalog validation (400s inline). */
export function validateImageForm(
  state: ImageFormState,
  existing: ImageEntry[],
  previousName?: string,
): string[] {
  const errors: string[] = []
  const name = state.name.trim()
  if (name === '') errors.push('Name is required.')
  else if (name !== previousName && existing.some((e) => e.name === name)) {
    errors.push(`An image named "${name}" already exists.`)
  }
  const ref = state.ref.trim()
  if (ref === '') errors.push('Reference is required.')
  else if (/\s/.test(ref)) errors.push('Reference must not contain whitespace.')
  const digest = state.digest.trim()
  if (digest !== '' && !DIGEST_RE.test(digest)) {
    errors.push('Digest must be sha256: followed by 64 hex characters.')
  }
  if (state.engine === 'ray' && state.rayVersion.trim() === '') {
    errors.push('Ray version is required for a Ray image.')
  }
  return errors
}

export function formToImage(state: ImageFormState): ImageEntry {
  const description = state.description.trim()
  return {
    name: state.name.trim(),
    description: description === '' ? null : description,
    ref: state.ref.trim(),
    digest: state.digest.trim(),
    engine: state.engine,
    ray_version: state.rayVersion.trim(),
    python_version: state.pythonVersion.trim(),
    projects: state.projects
      .split(',')
      .map((p) => p.trim())
      .filter((p) => p !== ''),
  }
}

/** Upsert `entry` into the catalog (replacing `previousName` on a rename). */
export function withImage(
  images: ImageEntry[],
  entry: ImageEntry,
  previousName?: string,
): ImageEntry[] {
  const target = previousName ?? entry.name
  const index = images.findIndex((e) => e.name === target)
  if (index < 0) return [...images, entry]
  return images.map((e, i) => (i === index ? entry : e))
}

export function withoutImage(images: ImageEntry[], name: string): ImageEntry[] {
  return images.filter((e) => e.name !== name)
}

// --- catalog_only admission -------------------------------------------------------

/** Projects whose admission rule requires catalog images (`"*"` = every project). */
export function catalogOnlyProjects(
  admission: Record<string, AdmissionRule> | undefined,
): string[] {
  return Object.entries(admission ?? {})
    .filter(([, rule]) => rule.catalog_only === true)
    .map(([project]) => project)
    .sort()
}

/**
 * Set or clear one project's `catalog_only` inside the FULL admission map,
 * keeping every other knob of that rule — the PUT replaces the section.
 * A rule left with nothing set is dropped.
 */
export function withCatalogOnly(
  admission: Record<string, AdmissionRule> | undefined,
  project: string,
  on: boolean,
): Record<string, AdmissionRule> {
  const next: Record<string, AdmissionRule> = { ...(admission ?? {}) }
  const rule: AdmissionRule = { ...(next[project] ?? {}) }
  if (on) {
    rule.catalog_only = true
  } else {
    delete rule.catalog_only
  }
  const meaningful = Object.entries(rule).some(([key, value]) => {
    if (value == null || value === false) return false
    if (Array.isArray(value)) return value.length > 0
    if (key === 'max_workers') return value !== 0
    return true
  })
  if (meaningful) next[project] = rule
  else delete next[project]
  return next
}

// --- Image sources (settings + add-image picker) -----------------------------------

export interface SourceRefOption {
  ref: string
  repository: string
  tag: string
}

/** Every reference a source currently offers, repository by repository, tags as listed. */
export function sourceRefOptions(tags: ImageSourceTags | undefined): SourceRefOption[] {
  if (!tags) return []
  const out: SourceRefOption[] = []
  for (const repo of tags.repositories) {
    repo.refs.forEach((ref, i) => out.push({ ref, repository: repo.repository, tag: repo.tags[i] ?? '' }))
  }
  return out
}

/**
 * A catalog name for a reference picked from a source: the last path
 * component and the tag, lowered and reduced to an RFC 1123 label
 * (`localhost:32000/jupyter-ray:2.56.0` → `jupyter-ray-2-56-0`).
 */
export function suggestImageName(ref: string): string {
  const repo = imageRepository(ref)
  const last = repo.split('/').filter((p) => p !== '').pop() ?? ''
  const afterRepo = ref.slice(ref.lastIndexOf(last) + last.length)
  const tag = afterRepo.startsWith(':') ? afterRepo.slice(1).split('@')[0] : ''
  const raw = tag ? `${last}-${tag}` : last
  const label = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return label.slice(0, 63).replace(/-+$/g, '')
}

export interface SourceFormState {
  name: string
  description: string
  registry: string
  repository: string
  /** Comma-separated; empty = every project. */
  projects: string
}

export function emptySourceForm(): SourceFormState {
  return { name: '', description: '', registry: '', repository: '', projects: '' }
}

const LABEL_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/
const REPOSITORY_RE = /^[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*$/

/** Client-side mirror of the backend's image-source validation. */
export function validateSourceForm(state: SourceFormState, existing: ImageSource[]): string[] {
  const errors: string[] = []
  const name = state.name.trim()
  if (name === '') errors.push('Name is required.')
  else if (!LABEL_RE.test(name)) errors.push('Name must be an RFC 1123 label (lowercase letters, digits, hyphens).')
  else if (existing.some((e) => e.name === name)) errors.push(`A source named "${name}" already exists.`)
  const registry = state.registry.trim()
  if (registry === '') errors.push('Registry is required.')
  else if (/\s|\/|:\/\//.test(registry)) errors.push('Registry must be a host[:port], not a URL or a path.')
  const repository = state.repository.trim()
  if (repository !== '' && !REPOSITORY_RE.test(repository)) {
    errors.push('Repository must be a lowercase OCI path such as ray/team.')
  }
  return errors
}

export function formToSource(state: SourceFormState): ImageSource {
  const description = state.description.trim()
  return {
    name: state.name.trim(),
    description: description === '' ? null : description,
    registry: state.registry.trim(),
    repository: state.repository.trim(),
    projects: state.projects
      .split(',')
      .map((p) => p.trim())
      .filter((p) => p !== ''),
  }
}

export function withSource(sources: ImageSource[], entry: ImageSource): ImageSource[] {
  const index = sources.findIndex((e) => e.name === entry.name)
  if (index < 0) return [...sources, entry]
  return sources.map((e, i) => (i === index ? entry : e))
}

export function withoutSource(sources: ImageSource[], name: string): ImageSource[] {
  return sources.filter((e) => e.name !== name)
}
