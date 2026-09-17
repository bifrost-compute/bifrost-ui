import { describe, expect, it } from 'vitest'

import { emptyWorkerGroup } from './cluster-form'
import type { EnvironmentSpec } from './environments'
import { buildSubmitJob, emptyJobForm, validateJobForm } from './job-form'

const withImage: EnvironmentSpec = { name: 'ml-base', base_image: 'rayproject/ray:2.56.0', status: 'published' }
const noImage: EnvironmentSpec = { name: 'pkgs-only', packages: ['polars==1.9.0'], status: 'published' }

describe('validateJobForm', () => {
  it('requires project, entrypoint and an image unless the environment brings one', () => {
    expect(validateJobForm(emptyJobForm(), [])).toEqual(['Project is required.', 'Entrypoint is required.', 'Image is required.'])
    const base = { ...emptyJobForm(), project: 'team-a', entrypoint: 'python -c 1' }
    expect(validateJobForm({ ...base, environment: 'ml-base' }, [withImage])).toEqual([])
    expect(validateJobForm({ ...base, environment: 'pkgs-only' }, [noImage])).toEqual([
      'Environment "pkgs-only" has no base image; give the job an image.',
    ])
    expect(validateJobForm({ ...base, environment: 'pkgs-only', image: 'rayproject/ray:2.56.0' }, [noImage])).toEqual([])
  })
  it('refuses the combinations the backend 400s', () => {
    const base = { ...emptyJobForm(), project: 'team-a', entrypoint: 'python -c 1', environment: 'ml-base' }
    expect(validateJobForm({ ...base, runtimeEnvYaml: 'pip: [x==1]' }, [withImage])).toEqual([
      'An environment and a runtime_env YAML are alternatives: name an environment or write a runtime_env, not both.',
    ])
    expect(validateJobForm({ ...base, image: 'other:1' }, [withImage])).toEqual([
      'Environment "ml-base" fixes the image (rayproject/ray:2.56.0); leave the image empty or pick a different environment.',
    ])
    expect(validateJobForm({ ...base, environment: 'gone' }, [withImage])).toEqual([
      'Environment "gone" is not available to this project.',
      'Image is required.',
    ])
    expect(validateJobForm({ ...base, id: 'Bad Id', headCpu: 'lots', ttlSecondsAfterFinished: '-1', workerGroups: [{ ...emptyWorkerGroup(), name: '' }] }, [withImage])).toEqual([
      'Job id must be an RFC 1123 label: lowercase letters, digits and hyphens, at most 63 characters.',
      'Head CPU "lots" is not a valid quantity.',
      'Keep-after-finish must be a non-negative whole number of seconds.',
      'Worker group 1: name is required.',
    ])
  })
})

describe('buildSubmitJob', () => {
  it('produces the snake_case wire body, dropping the runtime_env when an environment is named', () => {
    const body = buildSubmitJob({
      ...emptyJobForm(), id: ' train-1 ', project: 'team-a', entrypoint: 'python train.py', environment: 'ml-base',
      runtimeEnvYaml: 'ignored', headCpu: '2', headMemory: '4Gi', ttlSecondsAfterFinished: '30',
      workerGroups: [{ ...emptyWorkerGroup(), name: 'w', gpu: '' }],
    })
    expect(body).toEqual({
      id: 'train-1',
      spec: {
        project: 'team-a', entrypoint: 'python train.py', image: '', environment: 'ml-base', runtime_env_yaml: '',
        ray_version: '', head_cpu: '2', head_memory: '4Gi', ttl_seconds_after_finished: 30,
        worker_groups: [{ name: 'w', cpu: '4', memory: '16Gi', gpu: null, min_replicas: 1, max_replicas: 4, replicas: 1 }],
      },
    })
    const plain = buildSubmitJob({ ...emptyJobForm(), project: 'p', entrypoint: 'e', image: 'img:1', runtimeEnvYaml: 'env_vars:\n  A: "1"\n' })
    expect(plain.id).toBeUndefined()
    expect(plain.spec.environment).toBeNull()
    expect(plain.spec.runtime_env_yaml).toBe('env_vars:\n  A: "1"\n')
    expect(plain.spec.ttl_seconds_after_finished).toBeUndefined()
  })
})
