import { createClient } from '@supabase/supabase-js'
import { readRuntimeJson, writeRuntimeJson } from '../automation/runtime-io'
import type { ServerConfig } from '../config'
import type { AutoApplyQueueItem } from './types'
import type { SubmissionConfirmation } from './confirm'

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface ConfirmedApplicationRecord {
  applicationId: string
  jobId: string
  userId: string
  jobTitle: string
  company: string
  location: string
  applicationUrl: string | null
  provider: string | null
  submittedResumeVersionId: string | null
  currentMatchScore: number | null
  currentMatchId: string | null
  originalMatchScore: number | null
  submittedAt: string
  status: 'applied'
  submittedJobDescriptionSnapshot: string | null
  confirmationNumber: string | null
  confirmationText: string | null
  isConfirmedSubmission: true
  identityKey: string
  createdAt: string
  updatedAt: string
  finalUrl?: string | null
  discoveryProvider?: string | null
  applicationProvider?: string | null
  tailoredMatchScore?: number | null
}

const APPLICATIONS_FILE = 'applications.json'
const confirmed = new Map<string, ConfirmedApplicationRecord>()

function reloadConfirmed() {
  const parsed = readRuntimeJson<ConfirmedApplicationRecord[]>(APPLICATIONS_FILE)
  if (!parsed) return
  for (const record of parsed) {
    if (!record?.userId || !record.identityKey) continue
    const key = confirmedApplicationKey(record.userId, record)
    if (!confirmed.has(key)) confirmed.set(key, record)
  }
}

function flushConfirmed() {
  writeRuntimeJson(APPLICATIONS_FILE, [...confirmed.values()])
}

export function isUuidValue(value: string | null | undefined): value is string {
  return Boolean(value && UUID.test(value))
}

export function confirmedApplicationIdentity(item: Pick<AutoApplyQueueItem, 'identityKey' | 'jobId' | 'applicationUrl'>): string {
  return (item.identityKey || item.applicationUrl || item.jobId).trim().toLowerCase()
}

export function confirmedApplicationKey(userId: string, item: Pick<AutoApplyQueueItem, 'identityKey' | 'jobId' | 'applicationUrl'>): string {
  return `${userId}:${confirmedApplicationIdentity(item)}`
}

export function sanitizeJobDescriptionSnapshot(value: string | null | undefined): string | null {
  if (!value) return null
  const cleaned = value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned || null
}

export function isConfirmedSubmissionResult(confirmation?: SubmissionConfirmation | null): boolean {
  return Boolean(confirmation?.success && confirmation.confirmed)
}

export function shouldPersistConfirmedApplication(item: Pick<AutoApplyQueueItem, 'applicationStatus'>): boolean {
  return item.applicationStatus === 'submitted'
}

export function applyConfirmationToQueueItem(
  item: AutoApplyQueueItem,
  confirmation: SubmissionConfirmation,
  submittedAt = new Date().toISOString(),
): AutoApplyQueueItem {
  const confirmedSubmission = isConfirmedSubmissionResult(confirmation)
  item.confirmationNumber = confirmation.confirmationNumber ?? item.confirmationNumber
  item.confirmationText = confirmation.confirmationText ?? item.confirmationText
  if (confirmation.finalUrl) {
    item.applicationUrl = confirmation.finalUrl
    item.finalApplicationUrl = confirmation.finalUrl
  }
  if (confirmedSubmission) {
    item.applicationStatus = 'submitted'
    item.submittedAt = submittedAt
    item.failureReason = null
  } else if (item.applicationStatus === 'submitting' || item.applicationStatus === 'submitted') {
    item.applicationStatus = 'needs_confirmation'
    item.failureReason = confirmation.reason ?? 'Submission could not be confirmed on the employer site.'
  }
  item.updatedAt = submittedAt
  return item
}

export function buildConfirmedApplicationRecord(input: {
  userId: string
  item: AutoApplyQueueItem
  provider?: string | null
  now?: string
}): ConfirmedApplicationRecord | null {
  if (!shouldPersistConfirmedApplication(input.item)) return null
  const now = input.now ?? input.item.submittedAt ?? new Date().toISOString()
  const applicationId = input.item.applicationId && isUuidValue(input.item.applicationId) ? input.item.applicationId : input.item.jobId
  return {
    applicationId,
    jobId: input.item.jobId,
    userId: input.userId,
    jobTitle: input.item.title,
    company: input.item.company,
    location: input.item.location ?? '',
    applicationUrl: input.item.applicationUrl,
    provider: input.provider ?? null,
    submittedResumeVersionId: input.item.resumeVersionId,
    currentMatchScore: input.item.finalMatchScore,
    currentMatchId: null,
    originalMatchScore: input.item.initialMatchScore,
    submittedAt: input.item.submittedAt ?? now,
    status: 'applied',
    submittedJobDescriptionSnapshot: sanitizeJobDescriptionSnapshot(input.item.jobDescriptionSnapshot),
    confirmationNumber: input.item.confirmationNumber,
    confirmationText: input.item.confirmationText,
    isConfirmedSubmission: true,
    identityKey: input.item.identityKey,
    createdAt: input.item.createdAt,
    updatedAt: now,
    finalUrl: input.item.finalApplicationUrl || input.item.applicationUrl,
    discoveryProvider: input.item.discoverySource ?? null,
    applicationProvider: input.item.applicationProvider ?? input.provider ?? null,
    tailoredMatchScore: input.item.finalMatchScore,
  }
}

export function rememberConfirmedApplication(record: ConfirmedApplicationRecord): ConfirmedApplicationRecord {
  reloadConfirmed()
  const key = confirmedApplicationKey(record.userId, {
    identityKey: record.identityKey,
    jobId: record.jobId,
    applicationUrl: record.applicationUrl,
  })
  const existing = confirmed.get(key)
  if (existing) return existing
  confirmed.set(key, record)
  flushConfirmed()
  return record
}

export function findConfirmedApplication(
  userId: string,
  item: Pick<AutoApplyQueueItem, 'identityKey' | 'jobId' | 'applicationUrl'>,
): ConfirmedApplicationRecord | null {
  reloadConfirmed()
  return confirmed.get(confirmedApplicationKey(userId, item)) ?? null
}

export function listConfirmedApplications(userId?: string): ConfirmedApplicationRecord[] {
  reloadConfirmed()
  const records = [...confirmed.values()]
  return userId ? records.filter((record) => record.userId === userId) : records
}

export function resetConfirmedApplicationsForTests() {
  confirmed.clear()
}

function database(config?: ServerConfig) {
  if (!config?.supabaseUrl || !config.supabaseServiceRoleKey) return null
  return createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export async function persistConfirmedSubmission(input: {
  userId: string
  item: AutoApplyQueueItem
  provider?: string | null
  config?: ServerConfig
}): Promise<ConfirmedApplicationRecord | null> {
  const record = buildConfirmedApplicationRecord(input)
  if (!record) return null
  const existing = findConfirmedApplication(input.userId, input.item)
  if (existing) return existing
  const stored = rememberConfirmedApplication(record)
  const supabase = database(input.config)
  if (!supabase || !isUuidValue(input.userId) || !isUuidValue(stored.jobId) || !isUuidValue(stored.applicationId)) {
    return stored
  }
  const now = stored.updatedAt
  const jobRow = {
    id: stored.jobId,
    user_id: stored.userId,
    title: stored.jobTitle,
    company: stored.company,
    location: stored.location,
    job_url: stored.applicationUrl ?? '',
    description: stored.submittedJobDescriptionSnapshot ?? '',
    identity_key: stored.identityKey,
    provider: stored.provider,
    source: 'auto-apply',
    updated_at: now,
  }
  const jobResult = await supabase.from('jobs').upsert(jobRow, { onConflict: 'id', defaultToNull: false })
  if (jobResult.error) {
    await supabase.from('jobs').upsert(
      {
        id: stored.jobId,
        user_id: stored.userId,
        title: stored.jobTitle,
        company: stored.company,
        location: stored.location,
        job_url: stored.applicationUrl ?? '',
        description: stored.submittedJobDescriptionSnapshot ?? '',
      },
      { onConflict: 'id', defaultToNull: false },
    )
  }

  if (stored.submittedResumeVersionId && isUuidValue(stored.submittedResumeVersionId) && input.item.tailoredResumeText) {
    const sourceResumeId = isUuidValue(input.item.sourceResumeId) ? input.item.sourceResumeId : null
    if (sourceResumeId) {
      const versionRow = {
        id: stored.submittedResumeVersionId,
        user_id: stored.userId,
        source_resume_id: sourceResumeId,
        job_id: stored.jobId,
        analysis_id: null,
        version_name: input.item.resumeVersionName || `Submitted — ${stored.jobTitle}`,
        resume_content: {
          summary: input.item.tailoredResumeText,
          skills: [],
          experience: [],
          projects: [],
          education: [],
          certifications: [],
          changes: [],
          omissions: [],
          warnings: [],
          contact: { name: '', email: '', location: stored.location },
        },
        tailoring_summary: {
          skillsToEmphasize: [],
          relatedSkills: [],
          missingSkills: [],
          experienceToEmphasize: [],
        },
        changes: [],
        warnings: [],
        status: 'completed',
        created_by: 'ai',
        is_selected: true,
        created_at: stored.createdAt,
        updated_at: now,
      }
      await supabase.from('resume_versions').upsert(versionRow, { onConflict: 'id', defaultToNull: false })
    }
  }

  const applicationRow = {
    id: stored.applicationId,
    user_id: stored.userId,
    job_id: stored.jobId,
    match_id: null,
    resume_id: null,
    selected_resume_version_id: stored.submittedResumeVersionId,
    current_match_id: stored.currentMatchId,
    current_match_score: stored.currentMatchScore,
    status: 'applied',
    date_added: stored.createdAt.slice(0, 10),
    date_applied: stored.submittedAt.slice(0, 10),
    next_action: 'Follow up in 5 days',
    notes: stored.confirmationNumber ? `Confirmation ${stored.confirmationNumber}` : '',
    updated_at: now,
    is_confirmed_submission: true,
    submitted_job_description_snapshot: stored.submittedJobDescriptionSnapshot,
    confirmation_number: stored.confirmationNumber,
    confirmation_text: stored.confirmationText,
    submitted_at: stored.submittedAt,
    application_url: stored.finalUrl || stored.applicationUrl,
  }
  let applicationResult = await supabase.from('applications').upsert(applicationRow, { onConflict: 'id', defaultToNull: false })
  if (applicationResult.error) {
    const { is_confirmed_submission: _c, submitted_job_description_snapshot: _s, confirmation_number: _n, confirmation_text: _t, submitted_at: _a, application_url: _u, selected_resume_version_id: _r, ...core } = applicationRow
    applicationResult = await supabase.from('applications').upsert(core, { onConflict: 'id', defaultToNull: false })
  }
  return stored
}
