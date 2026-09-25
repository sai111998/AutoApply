import { allResumeSkills } from '../match/ground'
import { detectRoleType } from '../match/lexicon'
import { sameSkill, textContainsTerm } from '../match/normalize'
import type { JobProfile, MatchReport, ResumeProfile } from '../match/types'
import type { JdCoverage, SourceFacts, TailorMatchSignals, TailoringPlan } from './types'
import type { JdIntelligence } from './jd-intel'
import type { ResumeEvidenceRecord } from './evidence'
import type { AtsAlignmentBreakdown } from './ats-score'
import type { MatchCoverageSnapshot } from './match-optimize'

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

function supportedByResume(name: string, resumeSkills: string[], source?: SourceFacts | null): boolean {
  return (
    resumeSkills.some((skill) => sameSkill(skill, name)) ||
    Boolean(source && textContainsTerm(source.text, name))
  )
}

export function coverageFromReport(report: MatchReport | null): JdCoverage {
  const required = [
    ...(report?.requiredSkills?.matched ?? []),
    ...(report?.requiredSkills?.partial ?? []),
    ...(report?.requiredSkills?.missing ?? []),
  ]
  const preferred = [
    ...(report?.preferredSkills?.matched ?? []),
    ...(report?.preferredSkills?.partial ?? []),
    ...(report?.preferredSkills?.missing ?? []),
  ]
  const requiredSupported = report?.requiredSkills?.matched.length ?? 0
  const preferredSupported = report?.preferredSkills?.matched.length ?? 0
  return {
    requiredSupported,
    requiredTotal: required.length,
    preferredSupported,
    preferredTotal: preferred.length,
    overallSupported: requiredSupported + preferredSupported,
    overallTotal: required.length + preferred.length,
  }
}

function inferTargetRole(jobDescription?: string, jobProfile?: JobProfile | null, jd?: JdIntelligence | null): string {
  if (jd?.targetRole) return jd.targetRole
  if (!jobDescription?.trim()) return ''
  const titled = jobDescription.match(
    /\b((?:senior |staff |principal |lead )?[\w+/]+(?:\s[\w+/]+){0,4}\s(?:engineer|developer|architect|analyst|specialist))\b/i,
  )
  if (titled?.[1]) return titled[1]
  return jobProfile?.responsibilities[0]?.text.slice(0, 60) ?? ''
}

export function applyAlignmentToPlan(
  plan: TailoringPlan,
  alignment: AtsAlignmentBreakdown,
  matchBefore?: MatchCoverageSnapshot,
  matchAfter?: MatchCoverageSnapshot,
  iterations?: number,
): TailoringPlan {
  const originalMatchScore = matchBefore?.matchScore
  const tailoredMatchScore = matchAfter?.matchScore
  const delta =
    originalMatchScore != null && tailoredMatchScore != null ? tailoredMatchScore - originalMatchScore : undefined
  return {
    ...plan,
    coverage: {
      requiredSupported: matchAfter?.requiredMatched ?? alignment.requiredSupported,
      requiredTotal: matchAfter?.requiredTotal ?? alignment.requiredTotal,
      preferredSupported: matchAfter?.preferredMatched ?? alignment.preferredSupported,
      preferredTotal: matchAfter?.preferredTotal ?? alignment.preferredTotal,
      overallSupported: matchAfter?.supportedCount ?? alignment.supportedTotal,
      overallTotal: matchAfter?.supportedTotal ?? alignment.requirementTotal,
      representedBefore: matchBefore?.supportedCount ?? alignment.supportedCoverageBefore,
      representedAfter: matchAfter?.supportedCount ?? alignment.supportedCoverageAfter,
    },
    atsAlignmentScore: alignment.atsAlignmentScore,
    supportedCoverageBefore: matchBefore?.supportedCount ?? alignment.supportedCoverageBefore,
    supportedCoverageAfter: matchAfter?.supportedCount ?? alignment.supportedCoverageAfter,
    requiredCoverage: alignment.requiredCoverage,
    preferredCoverage: alignment.preferredCoverage,
    responsibilityCoverage: matchAfter?.responsibilityCoverage ?? alignment.responsibilityCoverage,
    experienceAlignment: alignment.experienceAlignment,
    keywordAlignment: alignment.keywordAlignment,
    educationAlignment: alignment.educationAlignment,
    requiredSupportedCount: matchAfter?.requiredMatched ?? alignment.requiredSupported,
    preferredSupportedCount: matchAfter?.preferredMatched ?? alignment.preferredSupported,
    requiredTotal: matchAfter?.requiredTotal ?? alignment.requiredTotal,
    preferredTotal: matchAfter?.preferredTotal ?? alignment.preferredTotal,
    supportedTotal: matchAfter?.supportedTotal ?? alignment.supportedTotal,
    requirementTotal: matchAfter?.supportedTotal ?? alignment.requirementTotal,
    originalMatchScore,
    tailoredMatchScore,
    matchScoreDelta: delta,
    optimizationIterations: iterations,
    requiredMatchedBefore: matchBefore?.requiredMatched,
    requiredMatchedAfter: matchAfter?.requiredMatched,
    preferredMatchedBefore: matchBefore?.preferredMatched,
    preferredMatchedAfter: matchAfter?.preferredMatched,
    responsibilityCoverageBefore: matchBefore?.responsibilityCoverage,
    responsibilityCoverageAfter: matchAfter?.responsibilityCoverage,
    cannotReachEightyReason:
      matchAfter && matchAfter.matchScore < 80 && matchAfter.missingRequired.length
        ? `80–85% alignment could not be achieved because the resume does not demonstrate the following required qualifications: ${matchAfter.missingRequired.join(', ')}.`
        : undefined,
    alignmentSummary: [
      originalMatchScore != null && tailoredMatchScore != null
        ? `Match Engine ${originalMatchScore}/100 → ${tailoredMatchScore}/100. Supported JD requirements: ${matchAfter?.supportedCount ?? alignment.supportedCoverageAfter}/${matchAfter?.supportedTotal ?? alignment.requirementTotal}.`
        : `JobPilot Alignment Score ${alignment.atsAlignmentScore}/100. Clearly represented supported requirements: ${alignment.supportedCoverageAfter}/${alignment.requirementTotal}.`,
      matchAfter && matchAfter.matchScore < 80 && matchAfter.missingRequired.length
        ? `80–85% alignment could not be achieved because the resume does not demonstrate the following required qualifications: ${matchAfter.missingRequired.join(', ')}.`
        : '',
    ]
      .filter(Boolean)
      .join(' '),
  }
}

export function buildTailoringPlan(
  report: MatchReport | null,
  profile: ResumeProfile | null,
  extras?: {
    signals?: TailorMatchSignals | null
    source?: SourceFacts | null
    jobDescription?: string
    jobProfile?: JobProfile | null
    jd?: JdIntelligence | null
    evidence?: ResumeEvidenceRecord[] | null
  },
): TailoringPlan {
  const resumeSkills = [
    ...(profile ? allResumeSkills(profile).map((item) => item.name) : []),
    ...(extras?.source?.skills ?? []),
  ]
  const requiredMatched = (report?.requiredSkills?.matched ?? []).map((item) => item.name)
  const preferredMatched = (report?.preferredSkills?.matched ?? []).map((item) => item.name)
  const partial = [
    ...(report?.requiredSkills?.partial ?? []),
    ...(report?.preferredSkills?.partial ?? []),
  ].map((item) => item.name)
  const missing = [
    ...(report?.requiredSkills?.missing ?? []),
    ...(report?.preferredSkills?.missing ?? []),
    ...(report?.certifications?.missing ?? []),
  ].map((item) => item.name)

  const overlapFromText = (extras?.source?.skills ?? []).filter((skill) =>
    extras?.jobDescription ? textContainsTerm(extras.jobDescription, skill) : false,
  )
  const evidenceSupported = (extras?.evidence ?? [])
    .filter(
      (item) =>
        (item.strength === 'strong' || item.strength === 'partial') &&
        (item.type === 'required' || item.type === 'preferred') &&
        item.requirement.split(/\s+/).length <= 4,
    )
    .map((item) => item.requirement)
  const jdRequired = extras?.jd?.required.technicalSkills ?? []
  const jdPreferred = extras?.jd?.preferred.technicalSkills ?? []

  const requiredSupported = uniqueNames(
    [...requiredMatched, ...jdRequired, ...(extras?.signals?.matched ?? []), ...overlapFromText, ...evidenceSupported].filter(
      (name) => supportedByResume(name, resumeSkills, extras?.source),
    ),
  )
  const preferredSupported = uniqueNames(
    [...preferredMatched, ...jdPreferred].filter(
      (name) =>
        supportedByResume(name, resumeSkills, extras?.source) &&
        !requiredSupported.some((item) => sameSkill(item, name)),
    ),
  )

  const skillsToEmphasize = uniqueNames([...requiredSupported, ...preferredSupported])
  const relatedSkills = uniqueNames(
    [
      ...partial,
      ...(extras?.signals?.partial ?? []),
      ...(extras?.evidence ?? []).filter((item) => item.strength === 'related').map((item) => item.requirement),
    ].filter((name) => !skillsToEmphasize.some((item) => sameSkill(item, name))),
  )
  const missingSkills = uniqueNames(
    [
      ...missing,
      ...(extras?.signals?.missing ?? []),
      ...(extras?.evidence ?? [])
        .filter(
          (item) =>
            item.strength === 'missing' &&
            (item.type === 'required' || item.type === 'preferred') &&
            item.requirement.split(/\s+/).length <= 4,
        )
        .map((item) => item.requirement),
    ].filter(
      (name) =>
        !skillsToEmphasize.some((item) => sameSkill(item, name)) &&
        !relatedSkills.some((item) => sameSkill(item, name)) &&
        !(extras?.source && textContainsTerm(extras.source.text, name)),
    ),
  )

  return {
    skillsToEmphasize,
    relatedSkills,
    missingSkills,
    experienceToEmphasize: uniqueNames([
      ...(report?.responsibilities?.strongMatches ?? []).map((item) => item.name),
      ...(report?.responsibilities?.partialMatches ?? []).map((item) => item.name),
      ...(extras?.jd?.required.responsibilities ?? []),
      ...(extras?.signals?.experienceThemes ?? []),
      ...(extras?.signals?.strengths ?? []).filter((item) => !/evidenced on the resume/i.test(item)),
    ]),
    coverage: coverageFromReport(report),
    roleType: extras?.jobDescription ? detectRoleType(extras.jobDescription) : 'general',
    targetRole: inferTargetRole(extras?.jobDescription, extras?.jobProfile, extras?.jd),
    unsupportedRequirements: missingSkills,
  }
}
