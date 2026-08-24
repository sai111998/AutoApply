import type { JobMatch, TailoringPlan } from '@/types/domain'

export function planFromMatch(match: JobMatch, resumeText: string): TailoringPlan {
  const text = resumeText.toLowerCase()
  const supported = (name: string) => text.includes(name.toLowerCase())
  const unique = (values: string[]) => {
    const seen = new Set<string>()
    const result: string[] = []
    for (const value of values) {
      const key = value.trim().toLowerCase()
      if (!value.trim() || seen.has(key)) continue
      seen.add(key)
      result.push(value.trim())
    }
    return result
  }

  const reportMatched = match.report
    ? [...match.report.requiredSkills.matched, ...match.report.preferredSkills.matched].map((item) => item.name)
    : []
  const reportPartial = match.report
    ? [...match.report.requiredSkills.partial, ...match.report.preferredSkills.partial].map((item) => item.name)
    : []
  const reportMissing = match.report
    ? [
        ...match.report.requiredSkills.missing,
        ...match.report.preferredSkills.missing,
        ...match.report.certifications.missing,
      ].map((item) => item.name)
    : []

  const skillsToEmphasize = unique(
    [...reportMatched, ...match.skillsMatched.map((item) => item.name)].filter(supported),
  )
  const relatedSkills = unique(
    [...reportPartial, ...match.skillsPartial.map((item) => item.name)].filter(
      (name) => !skillsToEmphasize.some((item) => item.toLowerCase() === name.toLowerCase()),
    ),
  )
  const missingSkills = unique(
    [...reportMissing, ...match.skillsMissing.map((item) => item.name)].filter(
      (name) => !supported(name) && !skillsToEmphasize.some((item) => item.toLowerCase() === name.toLowerCase()),
    ),
  )

  return {
    skillsToEmphasize,
    relatedSkills,
    missingSkills,
    experienceToEmphasize: unique([
      ...(match.report?.responsibilities.strongMatches ?? []).map((item) => item.name),
      ...match.strengths,
    ]),
  }
}
