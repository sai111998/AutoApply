import { readRuntimeJson, writeRuntimeJson } from '../automation/runtime-io'
import type { LiveJob } from './list'
import type { ListedAutoApplyJob } from '../apply/types'

const LIVE_JOBS_FILE = 'live-jobs.json'
const MAX_SNAPSHOTS = 500

const snapshots = new Map<string, LiveJob>()

function reloadSnapshots() {
  const parsed = readRuntimeJson<LiveJob[]>(LIVE_JOBS_FILE)
  if (!parsed) return
  for (const entry of parsed) {
    if (entry?.id && !snapshots.has(entry.id)) snapshots.set(entry.id, entry)
  }
}

function flushSnapshots() {
  writeRuntimeJson(LIVE_JOBS_FILE, [...snapshots.values()].slice(-MAX_SNAPSHOTS))
}

export function resetLiveJobStoreForTests() {
  snapshots.clear()
}

export function rememberLiveJobs(jobs: LiveJob[]): number {
  reloadSnapshots()
  let stored = 0
  for (const job of jobs) {
    if (!job?.id) continue
    snapshots.set(job.id, job)
    stored += 1
  }
  while (snapshots.size > MAX_SNAPSHOTS) {
    const oldest = snapshots.keys().next().value
    if (!oldest) break
    snapshots.delete(oldest)
  }
  flushSnapshots()
  return stored
}

export function getLiveJobSnapshot(jobId: string): LiveJob | null {
  reloadSnapshots()
  return snapshots.get(jobId.trim()) ?? null
}

export function listLiveJobSnapshots(): LiveJob[] {
  reloadSnapshots()
  return [...snapshots.values()]
}

export function liveJobToListedJob(job: LiveJob): ListedAutoApplyJob {
  return {
    id: job.id,
    title: job.title,
    company: job.company,
    description: job.description,
    url: job.url,
    jobUrl: job.jobUrl,
    identityKey: job.identityKey,
    provider: job.provider,
    providerJobId: job.providerJobId,
    employmentType: job.employmentType,
    location: job.location,
    c2cStatus: job.c2cStatus,
    c2cEvidence: job.c2cEvidence,
    match: job.match,
    matchScore: job.matchScore,
    postedAt: job.postedAt,
    fetchedAt: job.fetchedAt,
    rawMetadata: job.rawMetadata,
    applicationCapability: job.applicationCapability,
    applicationProvider: job.applicationProvider,
    discoveryProvider: job.discoveryProvider,
    applicationUrl: job.applicationUrl,
  }
}
