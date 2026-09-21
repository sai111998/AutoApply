import { HttpError } from '../types'
import type { AutoApplyProfile, AutoApplyStartInput } from './types'
import type { JobTypeFilter } from '../jobs/c2c'
import type { EmploymentFilter, RemoteFilter } from '../jobs/types'
import { normalizeMinimumMatchRate } from './threshold'
import { DEFAULT_MAX_JOBS, DEFAULT_MINIMUM_MATCH_RATE } from './defaults'

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asNumber(value: unknown, fallback: number): number {
  if (typeof value === 'string' && value.trim().endsWith('%')) {
    const parsed = Number(value.trim().slice(0, -1))
    return Number.isFinite(parsed) ? parsed : fallback
  }
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value
  const text = asString(value).toLowerCase()
  if (text === 'true' || text === 'on' || text === '1') return true
  if (text === 'false' || text === 'off' || text === '0') return false
  return fallback
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(asString).filter(Boolean)
  const text = asString(value)
  return text ? text.split(',').map((item) => item.trim()).filter(Boolean) : []
}

function asProfile(value: unknown): AutoApplyProfile {
  const record = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  return {
    fullName: asString(record.fullName),
    email: asString(record.email),
    location: asString(record.location),
    yearsOfExperience: typeof record.yearsOfExperience === 'number' ? record.yearsOfExperience : null,
    workAuthorization: asString(record.workAuthorization) || null,
    sponsorshipRequired: record.sponsorshipRequired === true,
    preferredWorkArrangement: asString(record.preferredWorkArrangement) || null,
    targetSalaryMin: typeof record.targetSalaryMin === 'number' ? record.targetSalaryMin : null,
    targetSalaryMax: typeof record.targetSalaryMax === 'number' ? record.targetSalaryMax : null,
  }
}

export function parseAutoApplyProfile(value: unknown): AutoApplyProfile {
  return asProfile(value)
}

export function parseAutoApplyStart(body: unknown): AutoApplyStartInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'Request body must be a JSON object')
  }
  const record = body as Record<string, unknown>
  const userId = asString(record.userId)
  const resumeText = asString(record.resumeText)
  if (!userId) throw new HttpError(400, 'userId is required')
  if (!resumeText) throw new HttpError(400, 'resumeText is required')
  const configRecord =
    record.config && typeof record.config === 'object' && !Array.isArray(record.config)
      ? (record.config as Record<string, unknown>)
      : record
  const jobType = asString(configRecord.jobType).toLowerCase() as JobTypeFilter
  const remote = asString(configRecord.remotePreference || configRecord.remote).toLowerCase() as RemoteFilter
  const employmentType = asString(configRecord.employmentType || configRecord.employmentTypes).toLowerCase() as EmploymentFilter
  return {
    userId,
    resumeId: asString(record.resumeId) || null,
    resumeVersionId: asString(record.resumeVersionId) || null,
    resumeText,
    masterResumeText: asString(record.masterResumeText) || resumeText,
    profile: asProfile(record.profile),
    config: {
      maxJobs: asNumber(configRecord.maxJobs ?? configRecord.maxApplications, DEFAULT_MAX_JOBS),
      minimumMatchRate: normalizeMinimumMatchRate(
        asNumber(configRecord.minimumMatchRate ?? configRecord.minimumMatch, DEFAULT_MINIMUM_MATCH_RATE),
      ),
      autoTailorResume: asBoolean(configRecord.autoTailorResume ?? configRecord.autoTailor, true),
      jobType:
        configRecord.c2cOnly === true || configRecord.c2cOnly === 'true' || configRecord.c2cOnly === 'on'
          ? 'c2c'
          : ['all', 'c2c', 'contract', 'w2'].includes(jobType)
            ? jobType
            : 'all',
      remotePreference: ['any', 'remote', 'onsite', 'hybrid'].includes(remote) ? remote : 'any',
      employmentType: ['any', 'full-time', 'part-time', 'contract', 'temporary', 'internship'].includes(employmentType)
        ? employmentType
        : 'any',
      keywords: asStringList(configRecord.keywords),
      jobTitles: asStringList(configRecord.jobTitles ?? configRecord.jobTitle),
      excludedCompanies: asStringList(configRecord.excludedCompanies),
      q: asString(configRecord.q ?? record.q),
      country: asString(configRecord.country) || 'US',
      state: asString(configRecord.state),
      location: asString(configRecord.location),
      concurrency: 1,
    },
    existingApplications: Array.isArray(record.existingApplications)
      ? record.existingApplications.map((item) => {
          const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
          return {
            jobId: asString(row.jobId) || null,
            identityKey: asString(row.identityKey) || null,
            applicationUrl: asString(row.applicationUrl) || null,
            status: asString(row.status) || null,
          }
        })
      : [],
    existingQueueIdentities: asStringList(record.existingQueueIdentities),
  }
}
