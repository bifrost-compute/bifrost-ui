import type { Identity, JobView } from './api'
import { holdsRole } from './identity'

/**
 * Job-history helpers for the Overview stat tiles (spec §5.1). Pure and
 * status-string driven so the tiles come alive the moment
 * `GET /api/v1/jobs` starts returning gateway-submitted jobs (#89) — no
 * hardcoded values. Ray statuses: PENDING | RUNNING | SUCCEEDED | FAILED |
 * STOPPED (comparison is case-insensitive to match the wire verbatim).
 */

/**
 * Submitting a job needs Write on the job target: Developer or Admin, held
 * globally or in any project (the backend's job rule, #5 — the same shape
 * as services, "running code"). Reads are Viewer+ and never gated. Fails
 * closed on null identity.
 */
export function canSubmitJobs(identity: Identity | null): boolean {
  return holdsRole(identity, ['developer', 'admin'])
}

// --- Jobs submitted from this console ------------------------------------------------

/**
 * `GET /api/v1/jobs` is the persistent history: a job appears there once it
 * has finished. An ephemeral job that was just submitted is reachable only
 * by id, so the console remembers the ids it submitted (per browser, a
 * convenience — never platform state) and polls each until it settles.
 */
const SUBMITTED_KEY = 'bifrost.submittedJobs'
const SUBMITTED_MAX = 20

export function submittedJobIds(): string[] {
  try {
    const raw = window.localStorage.getItem(SUBMITTED_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

function writeSubmitted(ids: string[]): void {
  try {
    window.localStorage.setItem(SUBMITTED_KEY, JSON.stringify(ids.slice(0, SUBMITTED_MAX)))
  } catch {
    // Storage blocked or full: the banner still shows this session's id via the URL.
  }
}

export function rememberSubmittedJob(id: string): void {
  writeSubmitted([id, ...submittedJobIds().filter((v) => v !== id)])
}

export function forgetSubmittedJob(id: string): void {
  writeSubmitted(submittedJobIds().filter((v) => v !== id))
}

/** Terminal Ray statuses: the poll can stop. */
export function isTerminalJob(status: string): boolean {
  const s = status.toUpperCase()
  return s === 'SUCCEEDED' || s === 'FAILED' || s === 'STOPPED'
}

/** In-flight jobs — not yet terminal. */
export function isActiveJob(status: string): boolean {
  const s = status.toUpperCase()
  return s === 'RUNNING' || s === 'PENDING'
}

/** Count of jobs still in flight (PENDING or RUNNING). */
export function countActiveJobs(jobs: JobView[]): number {
  return jobs.filter((job) => isActiveJob(job.status)).length
}

/**
 * Count of jobs that FAILED with a submission timestamp at or after
 * `sinceUnixSecs`. `submittedAt` (unix seconds) is the only time the wire
 * carries, so it stands in for "failed in the window".
 */
export function countFailedJobsSince(
  jobs: JobView[],
  sinceUnixSecs: number,
): number {
  return jobs.filter(
    (job) =>
      job.status.toUpperCase() === 'FAILED' && job.submittedAt >= sinceUnixSecs,
  ).length
}

/**
 * Most-recently-submitted jobs first, capped at `limit`, for the Overview
 * "Recent activity" list. Does not mutate the input.
 */
export function recentJobs(jobs: JobView[], limit: number): JobView[] {
  return [...jobs]
    .sort((a, b) => b.submittedAt - a.submittedAt)
    .slice(0, limit)
}
