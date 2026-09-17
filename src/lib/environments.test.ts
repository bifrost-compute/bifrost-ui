import { describe, expect, it } from 'vitest'

import {
  allowedTransitions,
  compiledPreview,
  environmentToForm,
  environmentsForProject,
  formToEnvironment,
  scanLabel,
  scanTone,
  statusTone,
  validateEnvironmentForm,
  withEnvironment,
  withEnvironmentStatus,
  withoutEnvironment,
  type EnvironmentSpec,
} from './environments'

const published: EnvironmentSpec = {
  name: 'ml-base', base_image: 'rayproject/ray:2.56.0', packages: ['scanpy==1.10.2', 'polars==1.9.0'],
  env_vars: { OMP_NUM_THREADS: '1' }, projects: ['team-a'], status: 'published',
  published_by: 'alice', published_at: '2026-09-13T10:00:00Z', scan: { status: 'clean', scanner: 'trivy 0.57' },
}
const draft: EnvironmentSpec = { name: 'wip', packages: ['numpy==2.1.0'] }
const open: EnvironmentSpec = { name: 'shared', status: 'published', runtime_env_yaml: 'working_dir: /w\n' }

describe('lifecycle and badges', () => {
  it('offers only the transitions the backend accepts', () => {
    expect(allowedTransitions('draft')).toEqual(['published'])
    expect(allowedTransitions('published')).toEqual(['deprecated'])
    expect(allowedTransitions('deprecated')).toEqual(['draft'])
  })
  it('tones statuses and scan verdicts', () => {
    expect(statusTone('published')).toBe('success')
    expect(statusTone('draft')).toBe('warning')
    expect(scanLabel(undefined)).toBe('not scanned')
    expect(scanTone({ status: 'failed' })).toBe('destructive')
    expect(scanTone(null)).toBe('muted')
  })
})

describe('environmentsForProject', () => {
  it('returns published entries open to the project, or all published when no project is typed', () => {
    const all = [published, draft, open]
    expect(environmentsForProject(all, 'team-a').map((e) => e.name)).toEqual(['ml-base', 'shared'])
    expect(environmentsForProject(all, 'team-b').map((e) => e.name)).toEqual(['shared'])
    expect(environmentsForProject(all, '').map((e) => e.name)).toEqual(['ml-base', 'shared'])
  })
})

describe('compiledPreview', () => {
  it('shows what a job gets', () => {
    expect(compiledPreview(published)).toEqual([
      'image: rayproject/ray:2.56.0',
      'pip: [scanpy==1.10.2, polars==1.9.0]',
      'env_vars.OMP_NUM_THREADS: 1',
    ])
    expect(compiledPreview(open)).toEqual(['+ runtime_env_yaml escape hatch (merged at resolution)'])
  })
})

describe('catalog editor', () => {
  it('round-trips an entry through the form, keeping publish metadata and the verdict', () => {
    const form = environmentToForm(published)
    expect(form.packages).toBe('scanpy==1.10.2\npolars==1.9.0')
    expect(form.envVars).toEqual([{ key: 'OMP_NUM_THREADS', value: '1' }])
    const back = formToEnvironment({ ...form, packages: form.packages + '\n\n# comment\n' }, published)
    expect(back).toEqual({ ...published, description: null, runtime_env_yaml: '' })
  })
  it('validates like the backend', () => {
    const form = environmentToForm(draft)
    expect(validateEnvironmentForm({ ...form, name: 'Bad_Name' }, [])).toEqual([
      'Name must be an RFC 1123 label: lowercase letters, digits and hyphens, at most 63 characters.',
    ])
    expect(validateEnvironmentForm({ ...form, name: 'ml-base' }, [published])).toEqual([
      'An environment named "ml-base" already exists.',
    ])
    expect(validateEnvironmentForm({ ...form, name: 'ml-base' }, [published], 'ml-base')).toEqual([])
    expect(validateEnvironmentForm({ ...form, packages: 'numpy\nscanpy>=1' }, [])).toEqual([
      'Package "numpy" is not pinned to an exact version (name[extras]==version).',
      'Package "scanpy>=1" is not pinned to an exact version (name[extras]==version).',
    ])
    expect(validateEnvironmentForm({ ...form, packages: 'ray[default]==2.56.0' }, [])).toEqual([])
    expect(validateEnvironmentForm({ ...form, envVars: [{ key: 'A', value: '1' }, { key: 'A', value: '2' }, { key: '', value: 'x' }] }, [])).toEqual([
      'Environment variable "A" is listed twice.',
      'An environment variable row is missing its name.',
    ])
  })
  it('upserts, removes and moves status', () => {
    const list = [published, draft]
    expect(withEnvironment(list, { ...draft, name: 'renamed' }, 'wip').map((e) => e.name)).toEqual(['ml-base', 'renamed'])
    expect(withEnvironment(list, open).map((e) => e.name)).toEqual(['ml-base', 'wip', 'shared'])
    expect(withoutEnvironment(list, 'wip')).toEqual([published])
    expect(withEnvironmentStatus(list, 'wip', 'published')[1].status).toBe('published')
  })
})
