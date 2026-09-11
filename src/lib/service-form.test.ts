import { describe, expect, it } from 'vitest'

import type { Identity } from './api'
import {
  buildDeployService,
  emptyServiceForm,
  validateServiceForm,
} from './service-form'
import { canManageServices, serviceViewState } from './services'

function identity(roles: Identity['roles']): Identity {
  return { subject: 's', groups: [], roles }
}

describe('canManageServices', () => {
  it('grants service deploy/delete to Developer and Admin only (Target::Service)', () => {
    expect(canManageServices(identity(['developer']))).toBe(true)
    expect(canManageServices(identity(['admin']))).toBe(true)
    expect(canManageServices(identity(['viewer', 'developer']))).toBe(true)
    // Deploying is "code", not lifecycle: Operator is read-only here,
    // the mirror image of clusters.
    expect(canManageServices(identity(['operator']))).toBe(false)
    expect(canManageServices(identity(['viewer']))).toBe(false)
    // Fail closed when there is no identity at all.
    expect(canManageServices(null)).toBe(false)
  })
})

describe('serviceViewState', () => {
  it('maps known lifecycle states through like clusters', () => {
    expect(serviceViewState({ name: 's', project: 'p', state: 'running' })).toBe('running')
    expect(serviceViewState({ name: 's', project: 'p', state: 'updating' })).toBe('updating')
  })

  it('falls back to pending for an unrecognized state', () => {
    expect(serviceViewState({ name: 's', project: 'p', state: 'mystery' })).toBe('pending')
    expect(serviceViewState({ name: 's', project: 'p', state: '' })).toBe('pending')
  })
})

describe('validateServiceForm', () => {
  it('rejects the empty form with actionable errors', () => {
    const errors = validateServiceForm({
      ...emptyServiceForm(),
      serveConfigV2: '',
    })
    expect(errors).toContain('Service name is required.')
    expect(errors).toContain('Project is required.')
    expect(errors).toContain('Serve config (serve_config_v2 YAML) is required.')
  })

  it('rejects invalid quantities', () => {
    const form = emptyServiceForm()
    form.name = 'summarizer'
    form.project = 'proj-a'
    form.headCpu = 'two'
    form.workerMemory = '-1Gi'
    const errors = validateServiceForm(form)
    expect(errors.some((e) => e.includes('Head CPU "two"'))).toBe(true)
    expect(errors.some((e) => e.includes('Worker memory "-1Gi"'))).toBe(true)
  })

  it('rejects non-whole-number replica counts', () => {
    const form = emptyServiceForm()
    form.name = 'summarizer'
    form.project = 'proj-a'
    form.workerReplicas = '1.5'
    expect(
      validateServiceForm(form).some((e) =>
        e.includes('Worker replicas must be a non-negative whole number.'),
      ),
    ).toBe(true)
  })

  it('accepts zero replicas (scale-to-zero is valid)', () => {
    const form = emptyServiceForm()
    form.name = 'summarizer'
    form.project = 'proj-a'
    form.workerReplicas = '0'
    expect(validateServiceForm(form)).toEqual([])
  })

  it('accepts a complete form', () => {
    const form = emptyServiceForm()
    form.name = 'summarizer'
    form.project = 'proj-a'
    expect(validateServiceForm(form)).toEqual([])
  })
})

describe('buildDeployService', () => {
  it('builds the POST body, trimming and reusing the name in the spec', () => {
    const form = emptyServiceForm()
    form.name = ' summarizer '
    form.project = 'proj-a'
    form.workerReplicas = '3'
    form.upgrade = 'in_place'
    expect(buildDeployService(form)).toEqual({
      name: 'summarizer',
      spec: {
        name: 'summarizer',
        project: 'proj-a',
        rayVersion: '2.57.0',
        image: 'rayproject/ray:2.57.0',
        headCpu: '2',
        headMemory: '8Gi',
        workerReplicas: 3,
        workerCpu: '4',
        workerMemory: '16Gi',
        upgrade: 'in_place',
        serveConfigV2: form.serveConfigV2,
      },
    })
  })

  it('defaults to the canary upgrade strategy', () => {
    expect(emptyServiceForm().upgrade).toBe('canary')
  })
})
