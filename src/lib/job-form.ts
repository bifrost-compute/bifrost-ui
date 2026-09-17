import type { WorkerGroupRow } from './cluster-form'
import { isValidQuantity, validateWorkerGroupRows } from './cluster-form'
import type { EnvironmentSpec } from './environments'

/**
 * Submit-job form (route /jobs/new) — pure logic. Backed by
 * `POST /api/v1/jobs` (#5), hand-fetched because the published client
 * predates `environment` on `RayJobSpec` (#55).
 *
 * The backend's rule (#55): a job names an environment OR writes its own
 * runtime_env_yaml, never both. An environment's base image fills an empty
 * image; a differing non-empty image is a 400.
 */
export interface JobFormState {
  /** Optional stable id; the server generates `job-<8 hex>` when empty. */
  id: string
  project: string
  entrypoint: string
  /** Environment catalog name; '' = none. */
  environment: string
  image: string
  rayVersion: string
  runtimeEnvYaml: string
  headCpu: string
  headMemory: string
  workerGroups: WorkerGroupRow[]
  /** Empty = the server default (60 s). */
  ttlSecondsAfterFinished: string
}

export function emptyJobForm(): JobFormState {
  return {
    id: '',
    project: '',
    entrypoint: '',
    environment: '',
    image: '',
    rayVersion: '',
    runtimeEnvYaml: '',
    headCpu: '1',
    headMemory: '2Gi',
    workerGroups: [],
    ttlSecondsAfterFinished: '',
  }
}

const ID_RE = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/

export function validateJobForm(state: JobFormState, environments: EnvironmentSpec[]): string[] {
  const errors: string[] = []
  const id = state.id.trim()
  if (id !== '' && (!ID_RE.test(id) || id.length > 63)) {
    errors.push('Job id must be an RFC 1123 label: lowercase letters, digits and hyphens, at most 63 characters.')
  }
  if (state.project.trim() === '') errors.push('Project is required.')
  if (state.entrypoint.trim() === '') errors.push('Entrypoint is required.')
  const env = environments.find((e) => e.name === state.environment)
  if (state.environment !== '' && !env) {
    errors.push(`Environment "${state.environment}" is not available to this project.`)
  }
  if (state.environment !== '' && state.runtimeEnvYaml.trim() !== '') {
    errors.push('An environment and a runtime_env YAML are alternatives: name an environment or write a runtime_env, not both.')
  }
  const image = state.image.trim()
  if (image === '' && !(env && env.base_image)) {
    errors.push(env ? `Environment "${env.name}" has no base image; give the job an image.` : 'Image is required.')
  }
  if (env && env.base_image && image !== '' && image !== env.base_image) {
    errors.push(`Environment "${env.name}" fixes the image (${env.base_image}); leave the image empty or pick a different environment.`)
  }
  if (!isValidQuantity(state.headCpu)) errors.push(`Head CPU "${state.headCpu}" is not a valid quantity.`)
  if (!isValidQuantity(state.headMemory)) errors.push(`Head memory "${state.headMemory}" is not a valid quantity.`)
  const ttl = state.ttlSecondsAfterFinished.trim()
  if (ttl !== '' && !/^\d+$/.test(ttl)) {
    errors.push('Keep-after-finish must be a non-negative whole number of seconds.')
  }
  errors.push(...validateWorkerGroupRows(state.workerGroups))
  return errors
}

/** Raw snake_case body of `POST /api/v1/jobs` (`SubmitJob` in the contract). */
export interface SubmitJobBody {
  id?: string
  spec: {
    project: string
    entrypoint: string
    image: string
    environment: string | null
    runtime_env_yaml: string
    ray_version: string
    head_cpu: string
    head_memory: string
    worker_groups: {
      name: string
      cpu: string
      memory: string
      gpu: string | null
      min_replicas: number
      max_replicas: number
      replicas: number
    }[]
    ttl_seconds_after_finished?: number
  }
}

export function buildSubmitJob(state: JobFormState): SubmitJobBody {
  const body: SubmitJobBody = {
    spec: {
      project: state.project.trim(),
      entrypoint: state.entrypoint.trim(),
      image: state.image.trim(),
      environment: state.environment === '' ? null : state.environment,
      runtime_env_yaml: state.environment === '' ? state.runtimeEnvYaml : '',
      ray_version: state.rayVersion.trim(),
      head_cpu: state.headCpu.trim(),
      head_memory: state.headMemory.trim(),
      worker_groups: state.workerGroups.map((g) => ({
        name: g.name.trim(),
        cpu: g.cpu.trim(),
        memory: g.memory.trim(),
        gpu: g.gpu.trim() === '' ? null : g.gpu.trim(),
        min_replicas: Number(g.minReplicas),
        max_replicas: Number(g.maxReplicas),
        replicas: Number(g.replicas),
      })),
    },
  }
  if (state.id.trim() !== '') body.id = state.id.trim()
  if (state.ttlSecondsAfterFinished.trim() !== '') {
    body.spec.ttl_seconds_after_finished = Number(state.ttlSecondsAfterFinished)
  }
  return body
}
