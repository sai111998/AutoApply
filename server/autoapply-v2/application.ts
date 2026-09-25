import { listConfirmedApplications } from '../apply/confirmed'
import { getLiveJobSnapshot } from '../jobs/live-store'
import { V2Error } from './errors'
import type { V2JobRef } from './types'

export function isSyntheticV2Url(url: string): boolean {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.toLowerCase()
    const loopback = host === 'localhost' || host === '127.0.0.1' || host === '::1'
    return loopback && parsed.pathname.startsWith('/test-employer/')
  } catch {
    return false
  }
}

export function validateV2ApplicationUrl(applicationUrl: string): void {
  if (!applicationUrl?.trim()) {
    throw new V2Error('INVALID_APPLICATION_URL', 'Job is missing an application URL.', 422)
  }
  if (isSyntheticV2Url(applicationUrl)) return
  let parsed: URL
  try {
    parsed = new URL(applicationUrl)
  } catch {
    throw new V2Error('INVALID_APPLICATION_URL', 'Job application URL is not a valid URL.', 422)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new V2Error('INVALID_APPLICATION_URL', 'Job application URL must use http or https.', 422)
  }
  const host = parsed.hostname.toLowerCase()
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
    throw new V2Error(
      'INVALID_APPLICATION_URL',
      'Localhost application URLs are only allowed for the synthetic test environment.',
      422,
    )
  }
}

export function isV2JobAlreadyApplied(
  userId: string,
  job: { id: string; applicationUrl: string },
): boolean {
  const normalizedUrl = normalizeV2Url(job.applicationUrl)
  return listConfirmedApplications(userId).some((record) => {
    if (record.jobId === job.id) return true
    if (record.identityKey === `live:${job.id}`) return true
    if (normalizeV2Url(record.applicationUrl ?? '') === normalizedUrl) return true
    if (record.finalUrl && normalizeV2Url(record.finalUrl) === normalizedUrl) {
      return true
    }
    return false
  })
}

function normalizeV2Url(url: string): string {
  try {
    const parsed = new URL(url.trim())
    parsed.hash = ''
    return parsed.toString().replace(/\/$/, '')
  } catch {
    return url.trim()
  }
}

export function firstValidV2Job(
  userId: string,
  jobs: Array<{
    id: string
    title: string
    company: string
    location?: string | null
    description?: string | null
    applicationUrl: string
  }>,
): V2JobRef | null {
  for (const job of jobs) {
    if (!job.id || !job.title?.trim() || !job.company?.trim()) continue
    try {
      validateV2ApplicationUrl(job.applicationUrl)
    } catch {
      continue
    }
    if (isV2JobAlreadyApplied(userId, job)) continue
    return {
      id: job.id,
      title: job.title.trim(),
      company: job.company.trim(),
      location: job.location ?? null,
      description: job.description ?? null,
      applicationUrl: job.applicationUrl,
    }
  }
  return null
}

export function resolveV2ApplicationUrl(snapshot: { jobUrl?: string | null; url?: string | null }): string | null {
  const value = (snapshot.jobUrl || snapshot.url || '').trim()
  return value || null
}

export function loadV2Job(userId: string, jobId: string): V2JobRef {
  const snapshot = getLiveJobSnapshot(jobId)
  if (!snapshot) {
    throw new V2Error('JOB_NOT_FOUND', 'Job not found in the live-job dataset.', 404)
  }
  if (!snapshot.title?.trim() || !snapshot.company?.trim()) {
    throw new V2Error('JOB_NOT_FOUND', 'Job is missing a valid title or company.', 422)
  }
  const applicationUrl = resolveV2ApplicationUrl(snapshot)
  if (!applicationUrl) {
    throw new V2Error('INVALID_APPLICATION_URL', 'Job is missing an application URL.', 422)
  }
  validateV2ApplicationUrl(applicationUrl)
  if (isV2JobAlreadyApplied(userId, { id: snapshot.id, applicationUrl })) {
    throw new V2Error('ALREADY_APPLIED', 'This job already has a confirmed application.', 409)
  }
  const job: V2JobRef = {
    id: snapshot.id,
    title: snapshot.title.trim(),
    company: snapshot.company.trim(),
    location: snapshot.location ?? null,
    description: snapshot.description ?? null,
    applicationUrl,
  }
  console.log(`[V2] JOB_SELECTED id=${job.id} company=${job.company}`)
  return job
}
