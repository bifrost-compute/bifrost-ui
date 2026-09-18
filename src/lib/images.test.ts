import { describe, expect, it } from 'vitest'

import {
  catalogEntryForImage,
  catalogOnlyProjects,
  catalogOptionsFor,
  dockerfileLine,
  dockerfileLines,
  formToImage,
  formatBytes,
  imageRepository,
  pinnedRef,
  shortDigest,
  validateImageForm,
  withCatalogOnly,
  withImage,
  withoutImage,
  type ImageEntry,
} from './images'

const digest = `sha256:${'ab'.repeat(32)}`
const ray: ImageEntry = { name: 'ray-2.56', ref: 'rayproject/ray:2.56.0', ray_version: '2.56.0', python_version: '3.11' }
const pinned: ImageEntry = { name: 'team', ref: 'localhost:32000/ray/team:2.56.0', digest, ray_version: '2.56.0', projects: ['team-a'] }
const dask: ImageEntry = { name: 'dask', ref: 'ghcr.io/dask/dask:2024.1', engine: 'dask' }

describe('references', () => {
  it('strips tags and digests but not registry ports', () => {
    expect(imageRepository('localhost:32000/ray/team:2.56.0')).toBe('localhost:32000/ray/team')
    expect(imageRepository(`rayproject/ray@${digest}`)).toBe('rayproject/ray')
    expect(imageRepository('rayproject/ray')).toBe('rayproject/ray')
  })
  it('pins to the digest when the entry has one', () => {
    expect(pinnedRef(pinned)).toBe(`localhost:32000/ray/team@${digest}`)
    expect(pinnedRef(ray)).toBe('rayproject/ray:2.56.0')
  })
  it('shortens digests for display', () => {
    expect(shortDigest(digest)).toBe('sha256:abababababab')
    expect(shortDigest('')).toBe('')
  })
  it('formats sizes in binary units', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(812_345_678)).toBe('774.7 MiB')
    expect(formatBytes(4_123_456_789)).toBe('3.8 GiB')
    expect(formatBytes(null)).toBe('—')
  })
})

describe('dockerfile view', () => {
  it('normalizes classic-builder and BuildKit history into instructions', () => {
    expect(dockerfileLine('/bin/sh -c #(nop)  ENV RAY_USAGE_STATS_ENABLED=0')).toEqual({
      instruction: 'ENV', text: 'ENV RAY_USAGE_STATS_ENABLED=0',
    })
    expect(dockerfileLine('/bin/sh -c pip install ray==2.56.0')).toEqual({
      instruction: 'RUN', text: 'RUN pip install ray==2.56.0',
    })
    expect(dockerfileLine('COPY requirements.txt /tmp/ # buildkit')).toEqual({
      instruction: 'COPY', text: 'COPY requirements.txt /tmp/',
    })
    expect(dockerfileLine('RUN /bin/sh -c pip install ray # buildkit')).toEqual({
      instruction: 'RUN', text: 'RUN pip install ray',
    })
    expect(dockerfileLine('|1 PY=3.11 /bin/sh -c echo hi')).toEqual({
      instruction: 'RUN', text: 'RUN |1 PY=3.11 /bin/sh -c echo hi',
    })
  })
  it('carries layer sizes only for layer-producing steps', () => {
    const lines = dockerfileLines([
      { created_by: 'FROM ubuntu', empty_layer: false, size_bytes: 10, layer_digest: 'sha256:1' },
      { created_by: '/bin/sh -c #(nop) USER ray', empty_layer: true, size_bytes: 99 },
    ])
    expect(lines[0]).toMatchObject({ instruction: 'FROM', sizeBytes: 10, layerDigest: 'sha256:1' })
    expect(lines[1]).toMatchObject({ instruction: 'USER', text: 'USER ray', sizeBytes: null, layerDigest: null })
  })
})

describe('picker', () => {
  it('offers only the current engine and recognises typed references', () => {
    expect(catalogOptionsFor([ray, pinned, dask], 'ray').map((e) => e.name)).toEqual(['ray-2.56', 'team'])
    expect(catalogOptionsFor([ray, dask], 'dask')).toEqual([dask])
    expect(catalogEntryForImage([ray, pinned], 'rayproject/ray:2.56.0')?.name).toBe('ray-2.56')
    expect(catalogEntryForImage([ray, pinned], pinnedRef(pinned))?.name).toBe('team')
    expect(catalogEntryForImage([ray, pinned], 'rayproject/ray:2.57.0')).toBeUndefined()
  })
})

describe('catalog editor', () => {
  it('validates like the backend', () => {
    const form = { name: 'ray-2.56', description: '', ref: 'rayproject/ray:2.56.0', digest: '', engine: 'ray' as const, rayVersion: '', pythonVersion: '', projects: '' }
    expect(validateImageForm(form, [ray])).toEqual([
      'An image named "ray-2.56" already exists.',
      'Ray version is required for a Ray image.',
    ])
    expect(validateImageForm({ ...form, rayVersion: '2.56.0' }, [ray], 'ray-2.56')).toEqual([])
    expect(validateImageForm({ ...form, name: 'x', ref: 'bad ref', digest: 'sha256:xyz', rayVersion: '1' }, [])).toEqual([
      'Reference must not contain whitespace.',
      'Digest must be sha256: followed by 64 hex characters.',
    ])
    expect(validateImageForm({ ...form, name: 'd', engine: 'dask' }, [])).toEqual([])
  })
  it('round-trips the form to a wire entry and upserts by name', () => {
    const entry = formToImage({ name: ' team ', description: 'x', ref: pinned.ref, digest, engine: 'ray', rayVersion: '2.56.0', pythonVersion: '', projects: 'team-a, team-b,' })
    expect(entry).toEqual({ name: 'team', description: 'x', ref: pinned.ref, digest, engine: 'ray', ray_version: '2.56.0', python_version: '', projects: ['team-a', 'team-b'] })
    expect(withImage([ray], entry).map((e) => e.name)).toEqual(['ray-2.56', 'team'])
    expect(withImage([ray, pinned], { ...entry, name: 'renamed' }, 'team').map((e) => e.name)).toEqual(['ray-2.56', 'renamed'])
    expect(withoutImage([ray, pinned], 'team')).toEqual([ray])
  })
})

describe('catalog_only admission', () => {
  it('toggles one project without touching the other knobs, and drops empty rules', () => {
    const admission = { '*': { allowed_images: ['rayproject/'], max_workers: 8 }, 'team-a': { allow_conda: true } }
    const on = withCatalogOnly(admission, 'team-a', true)
    expect(on['team-a']).toEqual({ allow_conda: true, catalog_only: true })
    expect(on['*']).toEqual(admission['*'])
    expect(catalogOnlyProjects(on)).toEqual(['team-a'])
    expect(withCatalogOnly(on, 'team-a', false)['team-a']).toEqual({ allow_conda: true })
    expect(withCatalogOnly({ 'team-b': { catalog_only: true, max_workers: 0 } }, 'team-b', false)).toEqual({})
    expect(withCatalogOnly(undefined, '*', true)).toEqual({ '*': { catalog_only: true } })
  })
})

// --- Image sources (#10) ------------------------------------------------------------

import {
  emptySourceForm,
  formToSource,
  sourceRefOptions,
  suggestImageName,
  validateSourceForm,
  withSource,
  withoutSource,
} from './images'
import type { ImageSourceTags } from './images'

describe('image sources', () => {
  const tags: ImageSourceTags = {
    name: 'node',
    registry: 'localhost:32000',
    repositories: [
      { repository: 'jupyter-ray', tags: ['2.56.0'], refs: ['localhost:32000/jupyter-ray:2.56.0'] },
      { repository: 'ray/team', tags: ['1', '2-py312'], refs: ['localhost:32000/ray/team:1', 'localhost:32000/ray/team:2-py312'] },
    ],
  }

  it('flattens a listing into pickable references, repository by repository', () => {
    const options = sourceRefOptions(tags)
    expect(options.map((o) => o.ref)).toEqual([
      'localhost:32000/jupyter-ray:2.56.0',
      'localhost:32000/ray/team:1',
      'localhost:32000/ray/team:2-py312',
    ])
    expect(options[2]).toEqual({ ref: 'localhost:32000/ray/team:2-py312', repository: 'ray/team', tag: '2-py312' })
    expect(sourceRefOptions(undefined)).toEqual([])
  })

  it('suggests an RFC 1123 catalog name from a picked reference', () => {
    expect(suggestImageName('localhost:32000/jupyter-ray:2.56.0')).toBe('jupyter-ray-2-56-0')
    expect(suggestImageName('artifact-keeper-backend.artifact-keeper.svc.cluster.local:8080/ray/team:2.57.0-py312')).toBe('team-2-57-0-py312')
    expect(suggestImageName('rayproject/ray')).toBe('ray')
    expect(suggestImageName('ghcr.io/org/Weird_Name:v1@sha256:abc')).toBe('weird-name-v1')
  })

  it('validates the source form like the backend', () => {
    const existing = [{ name: 'node', registry: 'localhost:32000' }]
    expect(validateSourceForm({ ...emptySourceForm(), name: 'ak', registry: 'ak.svc:8080', repository: 'ray/team' }, existing)).toEqual([])
    expect(validateSourceForm({ ...emptySourceForm(), name: 'node', registry: 'x' }, existing)).toContain('A source named "node" already exists.')
    expect(validateSourceForm({ ...emptySourceForm(), name: 'Bad.Name', registry: 'x' }, [])).toContain(
      'Name must be an RFC 1123 label (lowercase letters, digits, hyphens).',
    )
    expect(validateSourceForm({ ...emptySourceForm(), name: 'a', registry: 'https://ghcr.io' }, [])).toContain(
      'Registry must be a host[:port], not a URL or a path.',
    )
    expect(validateSourceForm({ ...emptySourceForm(), name: 'a', registry: 'ghcr.io', repository: 'Ray/Team' }, [])).toContain(
      'Repository must be a lowercase OCI path such as ray/team.',
    )
    expect(validateSourceForm(emptySourceForm(), [])).toEqual(['Name is required.', 'Registry is required.'])
  })

  it('round-trips the form and edits the list by name', () => {
    const src = formToSource({ name: ' ak ', description: '', registry: 'ak.svc:8080 ', repository: 'ray/team', projects: 'team-a, ,team-b' })
    expect(src).toEqual({ name: 'ak', description: null, registry: 'ak.svc:8080', repository: 'ray/team', projects: ['team-a', 'team-b'] })
    const list = withSource([{ name: 'node', registry: 'localhost:32000' }], src)
    expect(list.map((s) => s.name)).toEqual(['node', 'ak'])
    expect(withSource(list, { ...src, repository: 'other' })[1].repository).toBe('other')
    expect(withoutSource(list, 'node').map((s) => s.name)).toEqual(['ak'])
  })
})
