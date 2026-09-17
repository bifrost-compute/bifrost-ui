import type { CreateCluster, WorkerGroup } from './api'
import { defaultImageFor, type Engine } from './engine'

// --- New-cluster form state (route /clusters/new) ---------------------------

/** One editable worker-group row; numeric fields stay strings while typing. */
export interface WorkerGroupRow {
  name: string
  cpu: string
  memory: string
  /** Empty string = no GPUs. */
  gpu: string
  minReplicas: string
  maxReplicas: string
  replicas: string
}

export interface ClusterFormState {
  /** Stable cluster id — also the gateway routing key / cluster CR name. */
  id: string
  project: string
  /** Ray | Dask — decides which runtime fields apply and the POST `engine`. */
  engine: Engine
  /** Ray only; ignored (but harmlessly sent) for Dask. */
  rayVersion: string
  image: string
  headCpu: string
  headMemory: string
  /** Empty string = no max-age reaping (wire: `ttl_seconds: null`). */
  ttlSeconds: string
  workerGroups: WorkerGroupRow[]
}

export function emptyWorkerGroup(): WorkerGroupRow {
  return {
    name: '',
    cpu: '4',
    memory: '16Gi',
    gpu: '',
    minReplicas: '1',
    maxReplicas: '4',
    replicas: '1',
  }
}

export function emptyClusterForm(): ClusterFormState {
  return {
    id: '',
    project: '',
    engine: 'ray',
    rayVersion: '2.57.0',
    image: defaultImageFor('ray'),
    headCpu: '2',
    headMemory: '8Gi',
    ttlSeconds: '',
    workerGroups: [emptyWorkerGroup()],
  }
}

/**
 * Client-side mirror of the backend's quantity grammar
 * (the backend policy quantity parser): a non-negative number (exponent
 * notation allowed) with an optional K8s suffix — binary `Ki`…`Ei` or
 * decimal `n`, `u`, `m`, `k`, `M`…`E`. The server stays authoritative; this
 * exists to render the same 400s inline.
 */
const QUANTITY_RE =
  /^\d+(\.\d+)?([eE][+-]?\d+)?(Ki|Mi|Gi|Ti|Pi|Ei|n|u|m|k|M|G|T|P|E)?$/

export function isValidQuantity(value: string): boolean {
  return QUANTITY_RE.test(value.trim())
}

function parseCount(value: string): number | null {
  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) return null
  return Number(trimmed)
}

/** Client-side validation mirroring the backend's 400s (api-v1.md §5.1). */
export function validateClusterForm(state: ClusterFormState): string[] {
  const errors: string[] = []
  if (state.id.trim() === '') errors.push('Cluster name is required.')
  if (state.project.trim() === '') errors.push('Project is required.')
  // Ray version applies to Ray only; Dask is pinned by its image.
  if (state.engine === 'ray' && state.rayVersion.trim() === '') {
    errors.push('Ray version is required.')
  }
  if (state.image.trim() === '') errors.push('Image is required.')
  if (!isValidQuantity(state.headCpu)) {
    errors.push(`Head CPU "${state.headCpu}" is not a valid quantity.`)
  }
  if (!isValidQuantity(state.headMemory)) {
    errors.push(`Head memory "${state.headMemory}" is not a valid quantity.`)
  }
  if (state.ttlSeconds.trim() !== '') {
    if (parseCount(state.ttlSeconds) === null) {
      errors.push('TTL must be a non-negative whole number of seconds.')
    }
  }
  if (state.workerGroups.length === 0) {
    errors.push('At least one worker group is required.')
  }
  errors.push(...validateWorkerGroupRows(state.workerGroups))
  return errors
}

/** Per-row worker-group checks, shared with the job form (`/jobs/new`). */
export function validateWorkerGroupRows(groups: WorkerGroupRow[]): string[] {
  const errors: string[] = []
  groups.forEach((group, i) => {
    const label = `Worker group ${i + 1}`
    if (group.name.trim() === '') errors.push(`${label}: name is required.`)
    if (!isValidQuantity(group.cpu)) {
      errors.push(`${label}: CPU "${group.cpu}" is not a valid quantity.`)
    }
    if (!isValidQuantity(group.memory)) {
      errors.push(`${label}: memory "${group.memory}" is not a valid quantity.`)
    }
    if (group.gpu.trim() !== '' && !isValidQuantity(group.gpu)) {
      errors.push(`${label}: GPU "${group.gpu}" is not a valid quantity.`)
    }
    const min = parseCount(group.minReplicas)
    const max = parseCount(group.maxReplicas)
    const replicas = parseCount(group.replicas)
    if (min === null || max === null || replicas === null) {
      errors.push(`${label}: replica counts must be non-negative whole numbers.`)
      return
    }
    if (min > max) {
      errors.push(
        `${label}: min replicas (${min}) cannot exceed max replicas (${max}).`,
      )
    }
    if (replicas < min || replicas > max) {
      errors.push(
        `${label}: replicas (${replicas}) must be between min (${min}) and max (${max}).`,
      )
    }
  })
  return errors
}

/**
 * Convert validated form state into the `POST /api/v1/clusters` body. The
 * wire's `spec.name` is the RayCluster name — the same string as the
 * top-level `id`, which is why the form collects it once.
 */
export function buildCreateCluster(state: ClusterFormState): CreateCluster {
  const id = state.id.trim()
  const workerGroups: WorkerGroup[] = state.workerGroups.map((group) => ({
    name: group.name.trim(),
    cpu: group.cpu.trim(),
    memory: group.memory.trim(),
    gpu: group.gpu.trim() === '' ? null : group.gpu.trim(),
    minReplicas: Number(group.minReplicas),
    maxReplicas: Number(group.maxReplicas),
    replicas: Number(group.replicas),
  }))
  return {
    id,
    spec: {
      name: id,
      project: state.project.trim(),
      engine: state.engine,
      rayVersion: state.rayVersion.trim(),
      image: state.image.trim(),
      headCpu: state.headCpu.trim(),
      headMemory: state.headMemory.trim(),
      ttlSeconds:
        state.ttlSeconds.trim() === '' ? null : Number(state.ttlSeconds),
      workerGroups,
    },
  }
}
