import { extractEvidenceSnippet, textContainsTerm } from './normalize'
import type { EvidenceItem, JobProfile, JobSkill, ResumeProfile } from './types'

function keepNamed(item: EvidenceItem, source: string): EvidenceItem | null {
  if (!item.name.trim()) return null
  if (!textContainsTerm(source, item.name)) return null
  return {
    ...item,
    evidence: item.evidence && textContainsTerm(source, item.evidence.slice(0, 40))
      ? item.evidence
      : extractEvidenceSnippet(source, item.name) || item.evidence,
    years: typeof item.years === 'number' && Number.isFinite(item.years) ? item.years : null,
  }
}

function uniqueItems(items: EvidenceItem[]): EvidenceItem[] {
  const seen = new Set<string>()
  const result: EvidenceItem[] = []
  for (const item of items) {
    const key = item.name.trim().toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }
  return result
}

function uniqueStrings(values: string[], source: string): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed || !textContainsTerm(source, trimmed)) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(trimmed)
  }
  return result
}

export function emptyResumeProfile(): ResumeProfile {
  return {
    skills: [],
    languages: [],
    frameworks: [],
    cloud: [],
    databases: [],
    devops: [],
    security: [],
    jobTitles: [],
    employers: [],
    yearsOfExperience: null,
    education: [],
    certifications: [],
    projects: [],
    responsibilities: [],
    achievements: [],
    location: '',
    workArrangement: '',
    workAuthorization: '',
  }
}

export function emptyJobProfile(): JobProfile {
  return {
    requiredSkills: [],
    preferredSkills: [],
    languages: [],
    frameworks: [],
    cloud: [],
    databases: [],
    tools: [],
    security: [],
    yearsOfExperience: null,
    skillYears: [],
    education: { required: false, degree: '', field: '', details: '' },
    certifications: { required: [], preferred: [] },
    location: '',
    workArrangement: '',
    employmentType: '',
    sponsorship: '',
    responsibilities: [],
  }
}

export function groundResumeProfile(profile: ResumeProfile, resumeText: string): ResumeProfile {
  const keep = (items: EvidenceItem[]) => uniqueItems(items.map((item) => keepNamed(item, resumeText)).filter((item): item is EvidenceItem => Boolean(item)))

  const years =
    typeof profile.yearsOfExperience === 'number' && Number.isFinite(profile.yearsOfExperience)
      ? profile.yearsOfExperience
      : null

  return {
    skills: keep(profile.skills),
    languages: keep(profile.languages),
    frameworks: keep(profile.frameworks),
    cloud: keep(profile.cloud),
    databases: keep(profile.databases),
    devops: keep(profile.devops),
    security: keep(profile.security),
    jobTitles: uniqueStrings(profile.jobTitles, resumeText),
    employers: uniqueStrings(profile.employers, resumeText),
    yearsOfExperience: years,
    education: profile.education.filter((item) => {
      const probe = item.degree || item.field || item.evidence
      return probe && textContainsTerm(resumeText, probe)
    }),
    certifications: keep(profile.certifications),
    projects: keep(profile.projects),
    responsibilities: uniqueItems(
      profile.responsibilities
        .filter((item) => item.name && textContainsTerm(resumeText, item.name.slice(0, 48)))
        .map((item) => ({ ...item, evidence: item.evidence || extractEvidenceSnippet(resumeText, item.name) })),
    ),
    achievements: uniqueItems(
      profile.achievements
        .filter((item) => item.name && textContainsTerm(resumeText, item.name.slice(0, 48)))
        .map((item) => ({ ...item, evidence: item.evidence || extractEvidenceSnippet(resumeText, item.name) })),
    ),
    location: profile.location && textContainsTerm(resumeText, profile.location) ? profile.location : '',
    workArrangement: profile.workArrangement && textContainsTerm(resumeText, profile.workArrangement)
      ? profile.workArrangement
      : '',
    workAuthorization: profile.workAuthorization && textContainsTerm(resumeText, profile.workAuthorization)
      ? profile.workAuthorization
      : '',
  }
}

function keepJobSkills(skills: JobSkill[], jobText: string): JobSkill[] {
  const seen = new Set<string>()
  const result: JobSkill[] = []
  for (const skill of skills) {
    const name = skill.name.trim()
    if (!name || !textContainsTerm(jobText, name)) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push({ name, category: skill.category })
  }
  return result
}

export function groundJobProfile(profile: JobProfile, jobText: string): JobProfile {
  const years =
    typeof profile.yearsOfExperience === 'number' && Number.isFinite(profile.yearsOfExperience)
      ? profile.yearsOfExperience
      : null

  return {
    requiredSkills: keepJobSkills(profile.requiredSkills, jobText),
    preferredSkills: keepJobSkills(profile.preferredSkills, jobText),
    languages: keepJobSkills(profile.languages, jobText),
    frameworks: keepJobSkills(profile.frameworks, jobText),
    cloud: keepJobSkills(profile.cloud, jobText),
    databases: keepJobSkills(profile.databases, jobText),
    tools: keepJobSkills(profile.tools, jobText),
    security: keepJobSkills(profile.security, jobText),
    yearsOfExperience: years,
    skillYears: profile.skillYears.filter((item) => item.name && textContainsTerm(jobText, item.name) && item.years > 0),
    education: {
      required: Boolean(profile.education?.required),
      degree: profile.education?.degree ?? '',
      field: profile.education?.field ?? '',
      details: profile.education?.details ?? '',
    },
    certifications: {
      required: (profile.certifications?.required ?? []).filter((name) => textContainsTerm(jobText, name)),
      preferred: (profile.certifications?.preferred ?? []).filter((name) => textContainsTerm(jobText, name)),
    },
    location: profile.location,
    workArrangement: profile.workArrangement,
    employmentType: profile.employmentType,
    sponsorship: profile.sponsorship,
    responsibilities: (profile.responsibilities ?? []).filter((item) => item.text.trim()),
  }
}

export function allResumeSkills(profile: ResumeProfile): EvidenceItem[] {
  return [
    ...profile.skills,
    ...profile.languages,
    ...profile.frameworks,
    ...profile.cloud,
    ...profile.databases,
    ...profile.devops,
    ...profile.security,
  ]
}

export function mergeJobSkills(profile: JobProfile): { required: JobSkill[]; preferred: JobSkill[] } {
  const required = [
    ...profile.requiredSkills,
    ...profile.languages,
    ...profile.frameworks,
    ...profile.cloud,
    ...profile.databases,
    ...profile.tools,
    ...profile.security,
  ]
  return {
    required: keepJobSkills(required, required.map((item) => item.name).join(' ')),
    preferred: profile.preferredSkills,
  }
}
