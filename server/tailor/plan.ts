import { allResumeSkills } from '../match/ground'
import { sameSkill, textContainsTerm } from '../match/normalize'
import type { MatchReport, ResumeProfile } from '../match/types'
import type { SourceFacts, TailorMatchSignals, TailoringPlan } from './types'

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

export function buildTailoringPlan(
  report: MatchReport | null,
  profile: ResumeProfile | null,
  extras?: {
    signals?: TailorMatchSignals | null
    source?: SourceFacts | null
    jobDescription?: string
  },
): TailoringPlan {
  const resumeSkills = [
    ...(profile ? allResumeSkills(profile).map((item) => item.name) : []),
    ...(extras?.source?.skills ?? []),
  ]
  const matched = [
    ...(report?.requiredSkills.matched ?? []),
    ...(report?.preferredSkills.matched ?? []),
  ].map((item) => item.name)
  const partial = [
    ...(report?.requiredSkills.partial ?? []),
    ...(report?.preferredSkills.partial ?? []),
  ].map((item) => item.name)
  const missing = [
    ...(report?.requiredSkills.missing ?? []),
    ...(report?.preferredSkills.missing ?? []),
    ...(report?.certifications.missing ?? []),
  ].map((item) => item.name)

  const overlapFromText = (extras?.source?.skills ?? []).filter((skill) =>
    extras?.jobDescription ? textContainsTerm(extras.jobDescription, skill) : false,
  )

  const skillsToEmphasize = uniqueNames(
    [...matched, ...(extras?.signals?.matched ?? []), ...overlapFromText].filter(
      (name) =>
        resumeSkills.some((skill) => sameSkill(skill, name)) ||
        (extras?.source ? textContainsTerm(extras.source.text, name) : !resumeSkills.length),
    ),
  )
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
      ...(report?.responsibilities.strongMatches ?? []).map((item) => item.name),
      ...(report?.strengths ?? []),
      ...(extras?.signals?.experienceThemes ?? []),
      ...(extras?.signals?.strengths ?? []),
    ]),
  }
}
