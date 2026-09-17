import { useState } from 'react'

import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { ImageInspect } from '@/lib/images'
import { dockerfileLines, formatBytes, shortDigest } from '@/lib/images'
import { cn } from '@/lib/utils'

type Section = 'overview' | 'dockerfile' | 'layers' | 'environment' | 'labels'

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'dockerfile', label: 'Dockerfile view' },
  { id: 'layers', label: 'Layers' },
  { id: 'environment', label: 'Environment' },
  { id: 'labels', label: 'Labels' },
]

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-3 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 [overflow-wrap:anywhere]">{children}</dd>
    </div>
  )
}

function Mono({ children }: { children: React.ReactNode }) {
  return <code className="font-mono text-xs">{children}</code>
}

function Argv({ argv }: { argv: string[] }) {
  if (argv.length === 0) return <span className="text-muted-foreground">—</span>
  return <Mono>{argv.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}</Mono>
}

/** Pairs as a two-column table; the empty state says what is missing. */
function PairTable({
  pairs,
  keyHeader,
  emptyMessage,
}: {
  pairs: Record<string, string>
  keyHeader: string
  emptyMessage: string
}) {
  const entries = Object.entries(pairs).sort(([a], [b]) => a.localeCompare(b))
  if (entries.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">{emptyMessage}</p>
  }
  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{keyHeader}</TableHead>
            <TableHead>Value</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map(([key, value]) => (
            <TableRow key={key}>
              <TableCell className="font-mono text-xs">{key}</TableCell>
              <TableCell className="font-mono text-xs break-all">{value}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

export function OverviewSection({ doc }: { doc: ImageInspect }) {
  const { config } = doc
  return (
    <dl className="divide-y">
      <Row label="Reference"><Mono>{doc.reference}</Mono></Row>
      <Row label="Digest">
        <Mono>{doc.digest}</Mono>
      </Row>
      <Row label="Platforms">
        <div className="flex flex-wrap gap-1">
          {doc.platforms.length === 0 ? (
            <span className="text-muted-foreground">unknown</span>
          ) : (
            doc.platforms.map((p) => (
              <Badge key={`${p.os}/${p.architecture}/${p.variant ?? ''}`} variant="outline">
                {p.os}/{p.architecture}
                {p.variant ? `/${p.variant}` : ''}
              </Badge>
            ))
          )}
        </div>
      </Row>
      <Row label="Compressed size">
        {formatBytes(doc.size_bytes)}{' '}
        <span className="text-muted-foreground">
          across {doc.layers.length} {doc.layers.length === 1 ? 'layer' : 'layers'}
        </span>
      </Row>
      <Row label="User">{config.user || <span className="text-muted-foreground">root (unset)</span>}</Row>
      <Row label="Working dir">{config.working_dir || <span className="text-muted-foreground">/ (unset)</span>}</Row>
      <Row label="Entrypoint"><Argv argv={config.entrypoint} /></Row>
      <Row label="Command"><Argv argv={config.cmd} /></Row>
      <Row label="Exposed ports">
        {config.exposed_ports.length === 0 ? (
          <span className="text-muted-foreground">none declared</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {config.exposed_ports.map((p) => (
              <Badge key={p} variant="secondary">{p}</Badge>
            ))}
          </div>
        )}
      </Row>
      <Row label="Read from">
        <Badge variant="muted">{doc.source}</Badge>
      </Row>
    </dl>
  )
}

/**
 * The image's build history rendered as the Dockerfile that produced it:
 * one row per recorded step, the instruction highlighted, the layer size
 * beside steps that produced one. This is reconstruction, not the file —
 * `history` is what the builder recorded, and a squashed or hand-assembled
 * image records less.
 */
export function DockerfileSection({ doc }: { doc: ImageInspect }) {
  const lines = dockerfileLines(doc.history)
  if (lines.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        This image records no build history; the registry only knows its layers.
      </p>
    )
  }
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Reconstructed from the image's recorded build history — the closest an
        image gets to its Dockerfile. Sizes are the compressed layer each step
        produced; metadata-only steps produce none.
      </p>
      <ol className="min-w-0 divide-y overflow-hidden rounded-lg border bg-muted/30 font-mono text-xs">
        {lines.map((line, i) => (
          <li key={i} className="flex min-w-0 items-start gap-3 px-3 py-2">
            <span className="w-6 shrink-0 text-right text-muted-foreground select-none">{i + 1}</span>
            <span className="min-w-0 flex-1 whitespace-pre-wrap [overflow-wrap:anywhere]">
              <span
                className={cn(
                  'font-semibold',
                  line.instruction === 'FROM' ? 'text-sky-600 dark:text-sky-400' : 'text-emerald-600 dark:text-emerald-400',
                )}
              >
                {line.instruction}
              </span>
              {line.text.slice(line.instruction.length)}
            </span>
            <span className="shrink-0 text-muted-foreground" title={line.layerDigest ?? undefined}>
              {line.emptyLayer ? '' : formatBytes(line.sizeBytes)}
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}

export function LayersSection({ doc }: { doc: ImageInspect }) {
  if (doc.layers.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">No layers.</p>
  }
  const total = doc.size_bytes || 1
  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8">#</TableHead>
            <TableHead>Digest</TableHead>
            <TableHead>Media type</TableHead>
            <TableHead className="text-right">Size</TableHead>
            <TableHead className="w-32">Share</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {doc.layers.map((layer, i) => {
            const share = Math.max(0, Math.min(100, (layer.size_bytes / total) * 100))
            return (
              <TableRow key={layer.digest + i}>
                <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                <TableCell className="font-mono text-xs" title={layer.digest}>{shortDigest(layer.digest)}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {layer.media_type.replace('application/vnd.', '')}
                </TableCell>
                <TableCell className="text-right">{formatBytes(layer.size_bytes)}</TableCell>
                <TableCell>
                  <div className="h-2 w-full rounded bg-muted" aria-hidden>
                    <div className="h-2 rounded bg-primary/70" style={{ width: `${share}%` }} />
                  </div>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

/** Tabbed view of an `ImageInspect` document; shared by the Images page dialog. */
export function ImageInspectView({ doc }: { doc: ImageInspect }) {
  const [section, setSection] = useState<Section>('overview')
  return (
    <div className="min-w-0 space-y-4">
      <div role="tablist" aria-label="Image sections" className="inline-flex flex-wrap rounded-md border p-0.5">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={section === s.id}
            onClick={() => setSection(s.id)}
            className={cn(
              'rounded px-3 py-1 text-sm transition-colors',
              section === s.id
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {s.label}
            {s.id === 'layers' ? ` (${doc.layers.length})` : ''}
            {s.id === 'environment' ? ` (${Object.keys(doc.config.env).length})` : ''}
            {s.id === 'labels' ? ` (${Object.keys(doc.config.labels).length})` : ''}
          </button>
        ))}
      </div>
      {section === 'overview' ? <OverviewSection doc={doc} /> : null}
      {section === 'dockerfile' ? <DockerfileSection doc={doc} /> : null}
      {section === 'layers' ? <LayersSection doc={doc} /> : null}
      {section === 'environment' ? (
        <PairTable pairs={doc.config.env} keyHeader="Variable" emptyMessage="The image sets no environment variables." />
      ) : null}
      {section === 'labels' ? (
        <PairTable pairs={doc.config.labels} keyHeader="Label" emptyMessage="The image carries no labels." />
      ) : null}
    </div>
  )
}
