import { allResumeSkills } from '../match/ground'
import { detectRoleType } from '../match/lexicon'
import { sameSkill, textContainsTerm } from '../match/normalize'
import type { JobProfile, MatchReport, ResumeProfile } from '../match/types'
import type { JdCoverage, SourceFacts, TailorMatchSignals, TailoringPlan } from './types'

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

function inferTargetRole(jobDescription?: string, jobProfile?: JobProfile | null): string {
  if (!jobDescription?.trim()) return ''
  const firstLine = jobDescription.split(/\n/)[0]?.trim() ?? ''
  if (firstLine.length > 8 && firstLine.length < 80 && !/required|preferred|responsib/i.test(firstLine)) {
    return firstLine.replace(/[:.]+$/, '')
  }
  const titled = jobDescription.match(
    /\b((?:senior |staff |principal |lead )?[\w+/]+(?:\s[\w+/]+){0,4}\s(?:engineer|developer|architect|analyst|specialist))\b/i,
  )
  return titled?.[1] ?? jobProfile?.responsibilities[0]?.text.slice(0, 60) ?? ''
}

export function buildTailoringPlan(
  report: MatchReport | null,
  profile: ResumeProfile | null,
  extras?: {
    signals?: TailorMatchSignals | null
    source?: SourceFacts | null
    jobDescription?: string
    jobProfile?: JobProfile | null
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

  const requiredSupported = uniqueNames(
    [...requiredMatched, ...(extras?.signals?.matched ?? []), ...overlapFromText].filter((name) =>
      supportedByResume(name, resumeSkills, extras?.source),
    ),
  )
  const preferredSupported = uniqueNames(
    preferredMatched.filter(
      (name) =>
        supportedByResume(name, resumeSkills, extras?.source) &&
        !requiredSupported.some((item) => sameSkill(item, name)),
    ),
  )

  const skillsToEmphasize = uniqueNames([...requiredSupported, ...preferredSupported])
  const relatedSkills = uniqueNames(
    [...partial, ...(extras?.signals?.partial ?? [])].filter(
      (name) => !skillsToEmphasize.some((item) => sameSkill(item, name)),
    ),
  )
  const missingSkills = uniqueNames(
    [...missing, ...(extras?.signals?.missing ?? [])].filter(
      (name) =>
        !skillsToEmphasize.some((item) => sameSkill(item, name)) &&
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
      ...(extras?.signals?.experienceThemes ?? []),
      ...(extras?.signals?.strengths ?? []).filter((item) => !/evidenced on the resume/i.test(item)),
    ]),
    coverage: coverageFromReport(report),
    roleType: extras?.jobDescription ? detectRoleType(extras.jobDescription) : 'general',
    targetRole: inferTargetRole(extras?.jobDescription, extras?.jobProfile),
  }
}
