import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { DockerfileSection, ImageInspectView, LayersSection, OverviewSection } from '@/components/image-inspect'
import type { ImageInspect } from '@/lib/images'

const doc: ImageInspect = {
  reference: 'localhost:32000/ray/team:2.56.0',
  digest: `sha256:${'ab'.repeat(32)}`,
  platforms: [{ os: 'linux', architecture: 'amd64' }, { os: 'linux', architecture: 'arm64', variant: 'v8' }],
  size_bytes: 812_345_678 + 1024,
  config: {
    env: { PATH: '/usr/bin', RAY_USAGE_STATS_ENABLED: '0' },
    entrypoint: [],
    cmd: ['/bin/bash', '-c', 'ray start'],
    user: 'ray',
    working_dir: '/home/ray',
    exposed_ports: ['8265/tcp'],
    labels: { 'org.opencontainers.image.source': 'https://example/repo' },
  },
  history: [
    { created_by: 'FROM ubuntu:22.04', empty_layer: false, layer_digest: 'sha256:1', size_bytes: 1024 },
    { created_by: '/bin/sh -c #(nop)  ENV RAY_USAGE_STATS_ENABLED=0', empty_layer: true },
    { created_by: '/bin/sh -c pip install ray==2.56.0', empty_layer: false, layer_digest: 'sha256:2', size_bytes: 812_345_678 },
  ],
  layers: [
    { digest: 'sha256:1', media_type: 'application/vnd.oci.image.layer.v1.tar+gzip', size_bytes: 1024 },
    { digest: 'sha256:2', media_type: 'application/vnd.oci.image.layer.v1.tar+gzip', size_bytes: 812_345_678 },
  ],
  source: 'registry',
}

describe('ImageInspectView', () => {
  it('opens on the overview with the reference, platforms, size and container config', () => {
    const html = renderToStaticMarkup(<ImageInspectView doc={doc} />)
    expect(html).toContain('localhost:32000/ray/team:2.56.0')
    expect(html).toContain('linux/amd64')
    expect(html).toContain('linux/arm64/v8')
    expect(html).toContain('774.7 MiB')
    expect(html).toContain('across 2 layers')
    expect(html).toContain('8265/tcp')
    expect(html).toContain('/bin/bash -c &quot;ray start&quot;')
    expect(html).toContain('Layers (2)')
    expect(html).toContain('Environment (2)')
    expect(html).toContain('Labels (1)')
  })

  it('renders the history as Dockerfile instructions with layer sizes', () => {
    const html = renderToStaticMarkup(<DockerfileSection doc={doc} />)
    expect(html).toContain('FROM')
    expect(html).toContain(' ubuntu:22.04')
    expect(html).toContain('ENV RAY_USAGE_STATS_ENABLED=0'.replace('ENV', '</span>'))
    expect(html).toContain('RUN')
    expect(html).toContain(' pip install ray==2.56.0')
    expect(html).toContain('774.7 MiB')
    expect(html).toContain('1.0 KiB')
  })

  it('lists layers with their share of the image', () => {
    const html = renderToStaticMarkup(<LayersSection doc={doc} />)
    expect(html).toContain('sha256:1')
    expect(html).toContain('oci.image.layer.v1.tar+gzip')
    expect(html).toMatch(/width:\s*9\d(\.\d+)?%/)
  })

  it('says when the config is unset instead of showing blanks', () => {
    const bare: ImageInspect = { ...doc, config: { ...doc.config, user: '', working_dir: '', entrypoint: [], cmd: [], exposed_ports: [] } }
    const html = renderToStaticMarkup(<OverviewSection doc={bare} />)
    expect(html).toContain('root (unset)')
    expect(html).toContain('/ (unset)')
    expect(html).toContain('none declared')
  })
})
