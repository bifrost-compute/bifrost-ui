import type { PairRow } from './pools'

/**
 * Governed environments (#52–#58, spec row 19) — pure logic for the
 * Environments page, the job form's environment picker and the Settings
 * catalog editor.
 *
 * UI-ahead: `GET /api/v1/environments` and the policy's `environments`
 * section are in the backend but not the published client; wire shapes are
 * hand-written in raw snake_case here until it is republished.
 */

export type EnvironmentStatus = 'draft' | 'published' | 'deprecated'
export type ScanStatus = 'clean' | 'failed' | 'pending'

export interface EnvironmentScan {
  status: ScanStatus
  scanner?: string | null
  scanned_at?: string | null
}

/** `EnvironmentSpec` in the contract. */
export interface EnvironmentSpec {
  /** RFC 1123 label. */
  name: string
  description?: string | null
  /** Container image the environment builds on; empty = the job supplies its own. */
  base_image?: string
  /** Pip requirements pinned to exact versions (`name[extras]==version`). */
  packages?: string[]
  env_vars?: Record<string, string>
  /** Escape hatch: extra Ray runtime_env YAML merged at resolution. */
  runtime_env_yaml?: string
  /** Empty = every project. */
  projects?: string[]
  /** Absent = draft. */
  status?: EnvironmentStatus
  published_by?: string | null
  published_at?: string | null
  scan?: EnvironmentScan | null
}

export function environmentStatus(e: EnvironmentSpec): EnvironmentStatus {
  return e.status ?? 'draft'
}

export type BadgeTone = 'success' | 'warning' | 'destructive' | 'info' | 'muted' | 'secondary'

export function statusTone(status: EnvironmentStatus): BadgeTone {
  switch (status) {
    case 'published':
      return 'success'
    case 'deprecated':
      return 'muted'
    case 'draft':
      return 'warning'
  }
}

export function scanLabel(scan: EnvironmentScan | null | undefined): string {
  return scan?.status ?? 'not scanned'
}

export function scanTone(scan: EnvironmentScan | null | undefined): BadgeTone {
  switch (scan?.status) {
    case 'clean':
      return 'success'
    case 'failed':
      return 'destructive'
    case 'pending':
      return 'info'
    default:
      return 'muted'
  }
}

/**
 * The lifecycle moves the backend accepts from a status (#57): a draft
 * publishes, a published entry deprecates, a deprecated one returns to
 * draft. Everything else is a 400 server-side, so the UI never offers it.
 */
export function allowedTransitions(status: EnvironmentStatus): EnvironmentStatus[] {
  switch (status) {
    case 'draft':
      return ['published']
    case 'published':
      return ['deprecated']
    case 'deprecated':
      return ['draft']
  }
}

export function transitionLabel(to: EnvironmentStatus): string {
  switch (to) {
    case 'published':
      return 'Publish'
    case 'deprecated':
      return 'Deprecate'
    case 'draft':
      return 'Return to draft'
  }
}

/** Environments a job in `project` may name: published, and open to it. */
export function environmentsForProject(
  entries: EnvironmentSpec[],
  project: string,
): EnvironmentSpec[] {
  const p = project.trim()
  return entries.filter((e) => {
    if (environmentStatus(e) !== 'published') return false
    const projects = e.projects ?? []
    return p === '' || projects.length === 0 || projects.includes(p)
  })
}

/**
 * What a job that names this environment gets, as the backend compiles it
 * (#55): the pinned packages as `pip`, the env vars, plus whatever the
 * escape hatch adds. Rendered for display only; the server compiles the
 * real document.
 */
export function compiledPreview(e: EnvironmentSpec): string[] {
  const lines: string[] = []
  if (e.base_image) lines.push(`image: ${e.base_image}`)
  const packages = e.packages ?? []
  if (packages.length > 0) lines.push(`pip: [${packages.join(', ')}]`)
  const vars = Object.entries(e.env_vars ?? {}).sort(([a], [b]) => a.localeCompare(b))
  for (const [k, v] of vars) lines.push(`env_vars.${k}: ${v}`)
  if (e.runtime_env_yaml && e.runtime_env_yaml.trim() !== '') {
    lines.push('+ runtime_env_yaml escape hatch (merged at resolution)')
  }
  return lines
}

// --- Catalog editor ---------------------------------------------------------------

export interface EnvironmentFormState {
  name: string
  description: string
  baseImage: string
  /** One requirement per line. */
  packages: string
  envVars: PairRow[]
  runtimeEnvYaml: string
  /** Comma-separated; empty = every project. */
  projects: string
  status: EnvironmentStatus
}

export function emptyEnvironmentForm(): EnvironmentFormState {
  return {
    name: '',
    description: '',
    baseImage: '',
    packages: '',
    envVars: [],
    runtimeEnvYaml: '',
    projects: '',
    status: 'draft',
  }
}

export function environmentToForm(e: EnvironmentSpec): EnvironmentFormState {
  return {
    name: e.name,
    description: e.description ?? '',
    baseImage: e.base_image ?? '',
    packages: (e.packages ?? []).join('\n'),
    envVars: Object.entries(e.env_vars ?? {}).map(([key, value]) => ({ key, value })),
    runtimeEnvYaml: e.runtime_env_yaml ?? '',
    projects: (e.projects ?? []).join(', '),
    status: environmentStatus(e),
  }
}

/** RFC 1123 label, as the backend's environmentNameRe. */
const NAME_RE = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/
/** `name[extras]==version` — the backend's pinnedPackageRe, mirrored. */
export const PINNED_PACKAGE_RE =
  /^[A-Za-z0-9][A-Za-z0-9._-]*(\[[A-Za-z0-9._,\s-]+\])?==[A-Za-z0-9._+!-]+$/

export function packageLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'))
}

/** Client-side mirror of the backend's catalog validation (400s inline). */
export function validateEnvironmentForm(
  state: EnvironmentFormState,
  existing: EnvironmentSpec[],
  previousName?: string,
): string[] {
  const errors: string[] = []
  const name = state.name.trim()
  if (name === '') errors.push('Name is required.')
  else if (!NAME_RE.test(name) || name.length > 63) {
    errors.push('Name must be an RFC 1123 label: lowercase letters, digits and hyphens, at most 63 characters.')
  } else if (name !== previousName && existing.some((e) => e.name === name)) {
    errors.push(`An environment named "${name}" already exists.`)
  }
  for (const pkg of packageLines(state.packages)) {
    if (!PINNED_PACKAGE_RE.test(pkg)) {
      errors.push(`Package "${pkg}" is not pinned to an exact version (name[extras]==version).`)
    }
  }
  const seen = new Set<string>()
  for (const row of state.envVars) {
    const key = row.key.trim()
    if (key === '' && row.value.trim() === '') continue
    if (key === '') errors.push('An environment variable row is missing its name.')
    else if (seen.has(key)) errors.push(`Environment variable "${key}" is listed twice.`)
    seen.add(key)
  }
  if (state.baseImage.trim() !== '' && /\s/.test(state.baseImage.trim())) {
    errors.push('Base image must not contain whitespace.')
  }
  return errors
}

/**
 * Form → wire entry. Publish metadata and the scan verdict ride over from
 * `previous` untouched: the server stamps publishes itself and drops a
 * verdict whose packages or base image changed (#58).
 */
export function formToEnvironment(
  state: EnvironmentFormState,
  previous?: EnvironmentSpec,
): EnvironmentSpec {
  const envVars: Record<string, string> = {}
  for (const row of state.envVars) {
    const key = row.key.trim()
    if (key !== '') envVars[key] = row.value
  }
  const description = state.description.trim()
  return {
    name: state.name.trim(),
    description: description === '' ? null : description,
    base_image: state.baseImage.trim(),
    packages: packageLines(state.packages),
    env_vars: envVars,
    runtime_env_yaml: state.runtimeEnvYaml.trim() === '' ? '' : state.runtimeEnvYaml,
    projects: state.projects
      .split(',')
      .map((p) => p.trim())
      .filter((p) => p !== ''),
    status: state.status,
    published_by: previous?.published_by ?? null,
    published_at: previous?.published_at ?? null,
    scan: previous?.scan ?? null,
  }
}

/** Upsert into the catalog (replacing `previousName` on a rename). */
export function withEnvironment(
  environments: EnvironmentSpec[],
  entry: EnvironmentSpec,
  previousName?: string,
): EnvironmentSpec[] {
  const target = previousName ?? entry.name
  const index = environments.findIndex((e) => e.name === target)
  if (index < 0) return [...environments, entry]
  return environments.map((e, i) => (i === index ? entry : e))
}

export function withoutEnvironment(environments: EnvironmentSpec[], name: string): EnvironmentSpec[] {
  return environments.filter((e) => e.name !== name)
}

/** The catalog with one entry moved to `status`; the server enforces the move. */
export function withEnvironmentStatus(
  environments: EnvironmentSpec[],
  name: string,
  status: EnvironmentStatus,
): EnvironmentSpec[] {
  return environments.map((e) => (e.name === name ? { ...e, status } : e))
}
