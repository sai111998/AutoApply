import { APPLICATION_SAVE_ERROR, isUuid } from '@/lib/analysis-persist'
import { nextActionForStatus } from '@/lib/format'
import { emptyTailoredContent } from '@/lib/tailored-text'
import type {
  Application,
  ApplicationStatus,
  Job,
  JobMatch,
  Resume,
  ResumeVersion,
} from '@/types/domain'

export { APPLICATION_SAVE_ERROR }

const TERMINAL_APPLICATION_STATUSES: ApplicationStatus[] = [
  'applied',
  'interview',
  'offer',
  'rejected',
  'withdrawn',
]

export type AutoApplyApplicationSource = {
  id: string
  jobId: string
  identityKey: string
  applicationId?: string | null
  resumeVersionId?: string | null
  resumeVersionName?: string
  title: string
  company: string
  applicationUrl?: string | null
  initialMatchScore?: number | null
  finalMatchScore?: number | null
  applicationStatus: string
  tailoredResumeText?: string | null
  createdAt?: string
  updatedAt?: string
}

export type AutoApplyListedJob = {
  id: string
  title: string
  company: string
  location?: string | null
  jobUrl?: string | null
  url?: string | null
  description?: string | null
  identityKey?: string | null
  provider?: string | null
  providerJobId?: string | null
  remote?: boolean | null
  workArrangement?: string | null
  employmentType?: string | null
  seniority?: string | null
  postedAt?: string | null
  discoveredAt?: string | null
  fetchedAt?: string | null
  lastVerifiedAt?: string | null
  salaryMin?: number | null
  salaryMax?: number | null
  salaryCurrency?: string | null
  source?: string | null
  matchScore?: number | null
  match?: { score?: number | null } | null
}

export function applicationStatusFromQueue(queueStatus: string, existing?: Application | null): ApplicationStatus {
  if (queueStatus === 'submitted') return 'applied'
  if (existing && TERMINAL_APPLICATION_STATUSES.includes(existing.status)) return existing.status
  return 'ready'
}

export function findExistingAutoApplyJob(jobs: Job[], item: AutoApplyApplicationSource): Job | null {
  return (
    jobs.find((job) => job.id === item.jobId) ??
    jobs.find((job) => item.identityKey && job.identityKey === item.identityKey) ??
    jobs.find((job) => item.applicationUrl && job.jobUrl === item.applicationUrl) ??
    null
  )
}

export function findExistingAutoApplyApplication(
  applications: Application[],
  jobs: Job[],
  item: AutoApplyApplicationSource,
): Application | null {
  if (item.applicationId) {
    const byId = applications.find((application) => application.id === item.applicationId)
    if (byId) return byId
  }
  const byJobId = applications.find((application) => application.jobId === item.jobId)
  if (byJobId) return byJobId
  const linkedJob = findExistingAutoApplyJob(jobs, item)
  if (!linkedJob) return null
  return applications.find((application) => application.jobId === linkedJob.id) ?? null
}

export function applicationsVisibleOnApplicationsPage(applications: Application[], jobs: Job[]): Application[] {
  return applications.filter((application) => jobs.some((job) => job.id === application.jobId))
}

export function usesTailoredResumeVersion(
  item: AutoApplyApplicationSource,
  masterResumeId: string | null,
): boolean {
  if (!item.resumeVersionId) return false
  if (masterResumeId && item.resumeVersionId === masterResumeId) return false
  if (item.resumeVersionName && item.resumeVersionName !== 'Master') return true
  return Boolean(item.tailoredResumeText)
}

export function jobFromAutoApplyItem(
  item: AutoApplyApplicationSource,
  userId: string,
  listedJob: AutoApplyListedJob | null,
  existing: Job | null,
  now: string,
): Job {
  const listed = listedJob
  const score = item.finalMatchScore ?? item.initialMatchScore ?? listed?.match?.score ?? listed?.matchScore ?? existing?.matchScore ?? null
  return {
    id: existing?.id ?? listed?.id ?? item.jobId,
    userId,
    title: listed?.title || item.title || existing?.title || 'Untitled role',
    company: listed?.company || item.company || existing?.company || 'Unknown company',
    location: listed?.location ?? existing?.location ?? '',
    jobUrl: listed?.jobUrl || listed?.url || item.applicationUrl || existing?.jobUrl || '',
    description: listed?.description ?? existing?.description ?? '',
    createdAt: existing?.createdAt ?? listed?.discoveredAt ?? listed?.fetchedAt ?? item.createdAt ?? now,
    provider: listed?.provider ?? existing?.provider ?? null,
    providerJobId: listed?.providerJobId ?? existing?.providerJobId ?? null,
    remote: listed?.remote ?? existing?.remote ?? null,
    workArrangement: listed?.workArrangement ?? existing?.workArrangement ?? null,
    employmentType: listed?.employmentType ?? existing?.employmentType ?? null,
    seniority: listed?.seniority ?? existing?.seniority ?? null,
    postedAt: listed?.postedAt ?? existing?.postedAt ?? null,
    discoveredAt: listed?.discoveredAt ?? listed?.fetchedAt ?? existing?.discoveredAt ?? item.createdAt ?? now,
    lastVerifiedAt: listed?.lastVerifiedAt ?? existing?.lastVerifiedAt ?? null,
    salaryMin: listed?.salaryMin ?? existing?.salaryMin ?? null,
    salaryMax: listed?.salaryMax ?? existing?.salaryMax ?? null,
    salaryCurrency: listed?.salaryCurrency ?? existing?.salaryCurrency ?? null,
    source: listed?.source ?? existing?.source ?? 'auto-apply',
    identityKey: listed?.identityKey ?? item.identityKey ?? existing?.identityKey ?? null,
    matchScore: score,
  }
}

export function tailoredResumeVersionFromAutoApply(input: {
  item: AutoApplyApplicationSource
  job: Job
  masterResume: Resume | null
  existingVersions: ResumeVersion[]
  now: string
}): ResumeVersion | null {
  const masterResumeId = input.masterResume?.id ?? null
  if (!usesTailoredResumeVersion(input.item, masterResumeId)) return null
  if (!input.masterResume || !isUuid(input.masterResume.id)) return null
  const versionId = input.item.resumeVersionId
  if (!versionId || !isUuid(versionId)) return null
  const existing = input.existingVersions.find((version) => version.id === versionId)
  if (existing) {
    return {
      ...existing,
      jobId: existing.jobId ?? input.job.id,
      isSelected: true,
      status: existing.status === 'failed' || existing.status === 'generating' ? existing.status : existing.status,
      updatedAt: input.now,
    }
  }
  return {
    id: versionId,
    userId: input.job.userId,
    sourceResumeId: input.masterResume.id,
    jobId: input.job.id,
    analysisId: null,
    versionName: input.item.resumeVersionName || `Tailored v1 — ${input.job.title}`,
    resumeContent: {
      ...emptyTailoredContent(),
      summary: input.item.tailoredResumeText?.trim() ?? '',
    },
    tailoringSummary: {
      skillsToEmphasize: [],
      relatedSkills: [],
      missingSkills: [],
      experienceToEmphasize: [],
      originalMatchScore: input.item.initialMatchScore ?? undefined,
      tailoredMatchScore: input.item.finalMatchScore ?? undefined,
    },
    changes: [],
    warnings: [],
    status: 'completed',
    createdBy: 'ai',
    isSelected: true,
    generationId: versionId,
    comparisonAnalysisId: null,
    originalContent: null,
    createdAt: input.item.createdAt ?? input.now,
    updatedAt: input.now,
  }
}

export function buildAutoApplyWorkspaceRecords(input: {
  item: AutoApplyApplicationSource
  listedJob?: AutoApplyListedJob | null
  userId: string
  jobs: Job[]
  applications: Application[]
  matches: JobMatch[]
  resumeVersions: ResumeVersion[]
  masterResume: Resume | null
  now?: string
}): { job: Job; application: Application; resumeVersion: ResumeVersion | null; created: boolean } {
  const now = input.now ?? new Date().toISOString()
  const existingJob = findExistingAutoApplyJob(input.jobs, input.item)
  const existingApplication = findExistingAutoApplyApplication(input.applications, input.jobs, input.item)
  const job = jobFromAutoApplyItem(input.item, input.userId, input.listedJob ?? null, existingJob, now)
  const resumeVersion = tailoredResumeVersionFromAutoApply({
    item: input.item,
    job,
    masterResume: input.masterResume,
    existingVersions: input.resumeVersions,
    now,
  })
  const selectedResumeVersionId = resumeVersion?.id ?? null
  const originalMatch =
    (existingApplication?.matchId
      ? input.matches.find((match) => match.id === existingApplication.matchId)
      : null) ??
    input.matches.find((match) => match.jobId === job.id && !match.parentMatchId && !match.resumeVersionId) ??
    null
  const versionMatch = selectedResumeVersionId
    ? input.matches.find(
        (match) =>
          match.jobId === job.id &&
          (match.resumeVersionId === selectedResumeVersionId || match.id === resumeVersion?.comparisonAnalysisId),
      ) ?? null
    : null
  const knownMatchId = (value: string | null | undefined) =>
    value && input.matches.some((match) => match.id === value) ? value : null
  const currentMatch = selectedResumeVersionId ? versionMatch : originalMatch
  const status = applicationStatusFromQueue(input.item.applicationStatus, existingApplication)
  const currentMatchScore =
    input.item.finalMatchScore ??
    currentMatch?.overallScore ??
    existingApplication?.currentMatchScore ??
    input.item.initialMatchScore ??
    originalMatch?.overallScore ??
    null
  const applicationId =
    existingApplication?.id ??
    (input.item.applicationId && isUuid(input.item.applicationId) ? input.item.applicationId : job.id)
  const application: Application = {
    id: applicationId,
    userId: input.userId,
    jobId: job.id,
    matchId: existingApplication?.matchId ?? originalMatch?.id ?? null,
    resumeId: existingApplication?.resumeId ?? input.masterResume?.id ?? null,
    selectedResumeVersionId,
    currentMatchId:
      currentMatch?.id ??
      (selectedResumeVersionId
        ? knownMatchId(existingApplication?.currentMatchId)
        : knownMatchId(originalMatch?.id ?? existingApplication?.currentMatchId)),
    currentMatchScore,
    status,
    dateAdded: existingApplication?.dateAdded ?? now.slice(0, 10),
    dateApplied:
      status === 'applied'
        ? existingApplication?.dateApplied ?? now.slice(0, 10)
        : existingApplication?.dateApplied ?? null,
    nextAction: nextActionForStatus(status),
    notes: existingApplication?.notes ?? '',
    updatedAt: now,
  }

  return {
    job,
    application,
    resumeVersion,
    created: !existingApplication,
  }
}
