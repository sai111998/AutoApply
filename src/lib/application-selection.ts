import { createId } from '@/lib/format'
import { sanitizeTailoredContent } from '@/lib/tailored-text'
import type {
  Application,
  ApplicationStatus,
  JobMatch,
  Resume,
  ResumeVersion,
  TailoredResumeContent,
} from '@/types/domain'

export const MASTER_RESUME_OPTION_ID = 'master'

export type ResumeOriginLabel = 'Original' | 'AI generated' | 'User edited'

export interface SelectableResumeOption {
  id: string
  versionId: string | null
  name: string
  origin: ResumeOriginLabel
  matchScore: number | null
  matchId: string | null
  isSelected: boolean
  createdBy: 'source' | 'ai' | 'user'
  content: TailoredResumeContent | null
  version: ResumeVersion | null
}

export interface ApplicationResumeDisplay {
  currentResumeLabel: string
  currentMatchScore: number | null
  previousMatchScore: number | null
  originalMatchScore: number | null
  selectedVersionId: string | null
  currentMatchId: string | null
  usingMaster: boolean
}

export function nextActionAfterResumeSelection(status: ApplicationStatus): string {
  if (status === 'applied') return 'Follow up in 5 days'
  if (status === 'interview') return 'Prepare interview notes'
  if (status === 'offer') return 'Review compensation'
  if (status === 'rejected') return 'Archive and note takeaways'
  if (status === 'withdrawn') return 'No action'
  return 'Ready to apply'
}

export function scoreChangeMessage(delta: number): string {
  if (delta > 0) return `Match score increased by ${delta} points.`
  if (delta < 0) return `Match score decreased by ${Math.abs(delta)} points.`
  return 'Match score is unchanged.'
}

function uniqueNames(values: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(trimmed)
  }
  return result
}

function formatSkillList(names: string[]): string {
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`
}

export function scoreImprovementExplanation(input: {
  delta: number
  previousMatched?: string[]
  updatedMatched?: string[]
  emphasized?: string[]
}): string {
  const previous = uniqueNames(input.previousMatched ?? [])
  const updated = uniqueNames(input.updatedMatched ?? [])
  const emphasized = uniqueNames(input.emphasized ?? [])
  const newlyVisible = updated.filter(
    (name) => !previous.some((item) => item.toLowerCase() === name.toLowerCase()),
  )
  const evidence = uniqueNames([...newlyVisible, ...emphasized.filter((name) =>
    updated.some((item) => item.toLowerCase() === name.toLowerCase()) || newlyVisible.length === 0,
  )]).slice(0, 8)

  if (input.delta > 0 && evidence.length) {
    return `Improvement resulted from clearer representation of existing ${formatSkillList(evidence)} experience.`
  }
  if (input.delta > 0) {
    return 'Improvement resulted from clearer representation of existing supported experience.'
  }
  if (input.delta < 0) {
    return 'The match engine scored this version lower because some supported qualifications are less visible or no longer evidenced.'
  }
  if (evidence.length) {
    return `The match engine produced the same score. Supported ${formatSkillList(evidence)} experience remains represented.`
  }
  return 'The match engine produced the same score from the supplied resume and job description.'
}

export function formatScoreDelta(delta: number): string {
  if (delta > 0) return `+${delta}`
  return String(delta)
}

export function isUsableResumeVersion(version: ResumeVersion): boolean {
  return version.status === 'completed' || version.status === 'kept' || version.status === 'edited'
}

export function listJobResumeVersions(
  versions: ResumeVersion[],
  sourceResumeId: string,
  jobId: string,
): ResumeVersion[] {
  return versions
    .filter(
      (item) =>
        item.sourceResumeId === sourceResumeId && item.jobId === jobId && isUsableResumeVersion(item),
    )
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
}

export function nextTailoredVersionName(versions: ResumeVersion[], jobTitle: string): string {
  const title = jobTitle.trim() || 'Role'
  const tailoredCount = versions.filter((item) => item.createdBy === 'ai' && isUsableResumeVersion(item)).length
  if (tailoredCount === 0) return `Tailored — ${title}`
  return `Tailored v${tailoredCount + 1} — ${title}`
}

export function nextEditedVersionName(versions: ResumeVersion[], jobTitle: string): string {
  const title = jobTitle.trim() || 'Role'
  const editedCount = versions.filter((item) => item.createdBy === 'user' && isUsableResumeVersion(item)).length
  if (editedCount === 0) return `Edited Tailored — ${title}`
  return `Edited Tailored v${editedCount + 1} — ${title}`
}

export function createEditedResumeVersion(
  source: ResumeVersion,
  draft: TailoredResumeContent,
  jobTitle: string,
  siblings: ResumeVersion[],
): ResumeVersion {
  const now = new Date().toISOString()
  return {
    ...source,
    id: createId(),
    generationId: createId(),
    versionName: nextEditedVersionName(
      siblings.filter((item) => item.jobId === source.jobId && item.sourceResumeId === source.sourceResumeId),
      jobTitle,
    ),
    resumeContent: sanitizeTailoredContent(draft),
    createdBy: 'user',
    status: 'edited',
    isSelected: false,
    comparisonAnalysisId: null,
    warnings: [...source.warnings.filter((item) => item !== 'user-edited'), 'user-edited'],
    createdAt: now,
    updatedAt: now,
  }
}

export function matchForVersion(matches: JobMatch[], version: ResumeVersion | null): JobMatch | null {
  if (!version) return null
  const complete = (item: JobMatch) => item.analysisStatus === 'complete' && item.overallScore != null
  const byComparison = version.comparisonAnalysisId
    ? matches.find((item) => item.id === version.comparisonAnalysisId && complete(item))
    : null
  if (byComparison) return byComparison
  const linked = matches
    .filter((item) => item.resumeVersionId === version.id && complete(item))
    .sort((left, right) => (right.analyzedAt ?? right.createdAt).localeCompare(left.analyzedAt ?? left.createdAt))
  return linked[0] ?? matches.find((item) => item.id === version.comparisonAnalysisId) ?? null
}

export function originalMatchForJob(
  matches: JobMatch[],
  jobId: string,
  application?: Application | null,
): JobMatch | null {
  if (application?.matchId) {
    const linked = matches.find((item) => item.id === application.matchId)
    if (linked) return linked
  }
  const originals = matches
    .filter((item) => item.jobId === jobId && !item.parentMatchId && !item.resumeVersionId)
    .sort((left, right) => (right.analyzedAt ?? right.createdAt).localeCompare(left.analyzedAt ?? left.createdAt))
  return originals[0] ?? null
}

export function selectedVersionForJob(versions: ResumeVersion[], jobId: string): ResumeVersion | null {
  const selected = versions.filter((item) => item.jobId === jobId && item.isSelected && isUsableResumeVersion(item))
  return selected[0] ?? null
}

export function onlyOneVersionSelected(versions: ResumeVersion[], jobId: string): boolean {
  return versions.filter((item) => item.jobId === jobId && item.isSelected).length <= 1
}

export function markVersionSelected(
  versions: ResumeVersion[],
  versionId: string | null,
  jobId: string | null,
): ResumeVersion[] {
  const now = new Date().toISOString()
  return versions.map((item) => {
    if (versionId && item.id === versionId) {
      return {
        ...item,
        isSelected: true,
        status: item.status === 'failed' || item.status === 'generating' ? item.status : 'kept',
        updatedAt: now,
      }
    }
    if (jobId && item.jobId === jobId && item.isSelected) {
      return { ...item, isSelected: false }
    }
    return item
  })
}

export function buildSelectableResumeOptions(input: {
  masterResume: Resume | null
  versions: ResumeVersion[]
  matches: JobMatch[]
  sourceResumeId: string
  jobId: string
  application?: Application | null
  originalMatch: JobMatch | null
}): SelectableResumeOption[] {
  const jobVersions = listJobResumeVersions(input.versions, input.sourceResumeId, input.jobId)
  const selectedFromApplication = input.application?.selectedResumeVersionId ?? null
  const selectedFromFlags = selectedVersionForJob(input.versions, input.jobId)
  const selectedId = selectedFromApplication ?? selectedFromFlags?.id ?? null
  const masterSelected = selectedId == null
  const originalContent =
    jobVersions.find((item) => item.originalContent)?.originalContent ??
    jobVersions[0]?.originalContent ??
    null

  const master: SelectableResumeOption = {
    id: MASTER_RESUME_OPTION_ID,
    versionId: null,
    name: input.masterResume?.isMaster ? 'Master Resume' : (input.masterResume?.versionLabel ?? 'Master Resume'),
    origin: 'Original',
    matchScore: input.originalMatch?.overallScore ?? null,
    matchId: input.originalMatch?.id ?? input.application?.matchId ?? null,
    isSelected: masterSelected,
    createdBy: 'source',
    content: originalContent,
    version: null,
  }

  const tailored = jobVersions.map((version) => {
    const comparison = matchForVersion(input.matches, version)
    return {
      id: version.id,
      versionId: version.id,
      name: version.versionName,
      origin: (version.createdBy === 'user' ? 'User edited' : 'AI generated') as ResumeOriginLabel,
      matchScore: comparison?.overallScore ?? null,
      matchId: comparison?.id ?? version.comparisonAnalysisId,
      isSelected: version.id === selectedId,
      createdBy: version.createdBy,
      content: version.resumeContent,
      version,
    } satisfies SelectableResumeOption
  })

  return [master, ...tailored]
}

export function applyResumeSelection(input: {
  application: Application
  versions: ResumeVersion[]
  matches: JobMatch[]
  jobId: string
  resumeVersionId: string | null
  originalMatch: JobMatch | null
  now?: string
}): { application: Application; versions: ResumeVersion[] } {
  const now = input.now ?? new Date().toISOString()
  const version = input.resumeVersionId
    ? input.versions.find((item) => item.id === input.resumeVersionId) ?? null
    : null
  const currentMatch = version ? matchForVersion(input.matches, version) : input.originalMatch
  const nextVersions = markVersionSelected(input.versions, version?.id ?? null, input.jobId)
  const nextApplication: Application = {
    ...input.application,
    selectedResumeVersionId: version?.id ?? null,
    currentMatchId:
      currentMatch?.id ??
      version?.comparisonAnalysisId ??
      (version ? null : input.originalMatch?.id ?? input.application.matchId),
    currentMatchScore:
      currentMatch?.overallScore ?? (version ? null : input.originalMatch?.overallScore ?? null),
    nextAction: nextActionAfterResumeSelection(input.application.status),
    updatedAt: now,
  }
  return { application: nextApplication, versions: nextVersions }
}

export function resolveApplicationResumeDisplay(input: {
  application: Application
  versions: ResumeVersion[]
  matches: JobMatch[]
  resumes: Resume[]
}): ApplicationResumeDisplay {
  const original = originalMatchForJob(input.matches, input.application.jobId, input.application)
  const selectedVersion =
    (input.application.selectedResumeVersionId
      ? input.versions.find((item) => item.id === input.application.selectedResumeVersionId)
      : null) ?? selectedVersionForJob(input.versions, input.application.jobId)

  const versionMatch = matchForVersion(input.matches, selectedVersion)
  const storedCurrent =
    input.application.currentMatchId && input.application.currentMatchId !== input.application.matchId
      ? input.matches.find((item) => item.id === input.application.currentMatchId) ?? null
      : null
  const currentMatch = selectedVersion ? versionMatch ?? storedCurrent : original ?? storedCurrent

  const usingMaster = !selectedVersion
  const currentResumeLabel = selectedVersion
    ? selectedVersion.versionName
    : input.resumes.find((item) => item.id === input.application.resumeId)?.isMaster
      ? 'Master Resume'
      : input.resumes.find((item) => item.id === input.application.resumeId)?.versionLabel ?? 'Master Resume'

  return {
    currentResumeLabel,
    currentMatchScore: selectedVersion
      ? (versionMatch?.overallScore ?? currentMatch?.overallScore ?? input.application.currentMatchScore ?? original?.overallScore ?? null)
      : (original?.overallScore ?? input.application.currentMatchScore ?? null),
    previousMatchScore: original?.overallScore ?? null,
    originalMatchScore: original?.overallScore ?? null,
    selectedVersionId: selectedVersion?.id ?? null,
    currentMatchId:
      currentMatch?.id ??
      versionMatch?.id ??
      (selectedVersion ? input.application.currentMatchId : original?.id ?? input.application.matchId),
    usingMaster,
  }
}

export function mergeResumeVersionLists(fetched: ResumeVersion[], existing: ResumeVersion[]): ResumeVersion[] {
  const byId = new Map(existing.map((item) => [item.id, item]))
  const merged = fetched.map((incoming) => {
    const local = byId.get(incoming.id)
    if (!local) return incoming
    return {
      ...incoming,
      comparisonAnalysisId: incoming.comparisonAnalysisId ?? local.comparisonAnalysisId,
      isSelected: incoming.isSelected || local.isSelected,
      originalContent: incoming.originalContent ?? local.originalContent,
      createdBy: incoming.createdBy === 'ai' && local.createdBy === 'user' ? local.createdBy : incoming.createdBy,
    }
  })
  const fetchedIds = new Set(fetched.map((item) => item.id))
  return [...merged, ...existing.filter((item) => !fetchedIds.has(item.id))]
}

export function mergeFetchedResumeVersions(
  fetched: ResumeVersion[],
  existing: ResumeVersion[],
  jobId: string,
): ResumeVersion[] {
  const others = existing.filter((item) => item.jobId !== jobId)
  const merged = fetched.map((incoming) => {
    const local = existing.find((item) => item.id === incoming.id)
    if (!local) return incoming
    return {
      ...incoming,
      comparisonAnalysisId: incoming.comparisonAnalysisId ?? local.comparisonAnalysisId,
      isSelected: incoming.isSelected || local.isSelected,
      originalContent: incoming.originalContent ?? local.originalContent,
      createdBy: incoming.createdBy === 'ai' && local.createdBy === 'user' ? local.createdBy : incoming.createdBy,
    }
  })
  const fetchedIds = new Set(fetched.map((item) => item.id))
  const localOnly = existing.filter((item) => item.jobId === jobId && !fetchedIds.has(item.id))
  return [...merged, ...localOnly, ...others]
}

export function pdfContentForSelection(
  options: SelectableResumeOption[],
  fallback: TailoredResumeContent | null,
): TailoredResumeContent | null {
  const selected = options.find((item) => item.isSelected)
  return selected?.content ?? fallback
}

export function analysesForJob(matches: JobMatch[], jobId: string): JobMatch[] {
  return matches
    .filter((item) => item.jobId === jobId)
    .sort((left, right) => (left.analyzedAt ?? left.createdAt).localeCompare(right.analyzedAt ?? right.createdAt))
}

export function masterResumeUnchanged(
  before: Resume | null,
  after: Resume | null,
): boolean {
  if (!before || !after) return before === after
  return (
    before.id === after.id &&
    before.parsedText === after.parsedText &&
    before.fileName === after.fileName &&
    before.isMaster === after.isMaster
  )
}
