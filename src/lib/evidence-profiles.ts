import { extractResumeLocal, mergeResumeProfiles } from '../../server/match/extract-local'
import { emptyResumeProfile } from '../../server/match/ground'
import { tailoredResumeToText } from '@/lib/tailored-text'
import type { Job, JobMatch, TailoredResumeContent } from '@/types/domain'

export function yearsFromExperience(experience: { dates: string }[]): number | null {
  const spans: number[] = []
  for (const role of experience) {
    const years = role.dates.match(/(?:19|20)\d{2}/g)?.map(Number) ?? []
    if (!years.length) continue
    const start = years[0]
    const end = years[1] ?? new Date().getFullYear()
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) spans.push(end - start)
  }
  if (!spans.length) return null
  return spans.reduce((sum, item) => sum + item, 0)
}

export function resumeProfileFromTailored(content: TailoredResumeContent) {
  const skills = content.skills.filter((name) => name.trim())
  const years = yearsFromExperience(content.experience)
  const structured = {
    ...emptyResumeProfile(),
    skills: skills.map((name) => ({ name, evidence: name, years })),
    jobTitles: content.experience.map((role) => role.title).filter(Boolean),
    employers: content.experience.map((role) => role.company).filter(Boolean),
    yearsOfExperience: years,
    education: content.education.map((item) => ({
      degree: item.degree,
      field: item.field,
      evidence: item.details || [item.degree, item.field].filter(Boolean).join(', '),
    })),
    certifications: content.certifications.map((name) => ({ name, evidence: name })),
    projects: content.projects.map((item) => ({ name: item.name, evidence: item.name })),
    responsibilities: content.experience.flatMap((role) =>
      role.bullets
        .map((bullet) => bullet.trim())
        .filter(Boolean)
        .map((bullet) => ({ name: bullet, evidence: bullet })),
    ),
    location: content.contact.location,
  }
  return mergeResumeProfiles(structured, extractResumeLocal(tailoredResumeToText(content)))
}

export function jobProfileFromMatch(match: JobMatch, job: Pick<Job, 'location'>) {
  const required = match.report
    ? [
        ...(match.report.requiredSkills?.matched ?? []),
        ...(match.report.requiredSkills?.partial ?? []),
        ...(match.report.requiredSkills?.missing ?? []),
      ]
    : [...match.skillsMatched, ...match.skillsMissing]
  const preferred = match.report
    ? [
        ...(match.report.preferredSkills?.matched ?? []),
        ...(match.report.preferredSkills?.partial ?? []),
        ...(match.report.preferredSkills?.missing ?? []),
      ]
    : match.skillsPartial
  const responsibilities = match.report
    ? [
        ...(match.report.responsibilities?.strongMatches ?? []).map((item) => ({ text: item.name, required: true })),
        ...(match.report.responsibilities?.partialMatches ?? []).map((item) => ({ text: item.name, required: false })),
        ...(match.report.responsibilities?.gaps ?? []).map((item) => ({ text: item.name, required: true })),
      ]
    : []

  return {
    requiredSkills: required.map((item) => ({ name: item.name })),
    preferredSkills: preferred.map((item) => ({ name: item.name })),
    languages: [],
    frameworks: [],
    cloud: [],
    databases: [],
    tools: [],
    security: [],
    yearsOfExperience: null,
    skillYears: [],
    education: {
      required: false,
      degree: '',
      field: '',
      details: match.report?.education?.details || match.educationMatch?.summary || '',
    },
    certifications: {
      required: [],
      preferred: (match.report?.certifications?.matched ?? []).map((item) => item.name),
    },
    location: job.location,
    workArrangement: '',
    employmentType: '',
    sponsorship: '',
    responsibilities,
  }
}
