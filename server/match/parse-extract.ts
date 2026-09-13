import { asStringArray } from '../services/validate'
import { emptyJobProfile, emptyResumeProfile } from './ground'
import type { EvidenceItem, JobProfile, JobSkill, ResumeProfile } from './types'

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Analysis model returned an invalid payload')
  }
  return value as Record<string, unknown>
}

function asOptionalNumber(value: unknown): number | null {
  if (value == null || value === '') return null
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return null
  return number
}

function asEvidenceList(value: unknown): EvidenceItem[] {
  if (!Array.isArray(value)) return []
  const items: EvidenceItem[] = []
  for (const item of value) {
    if (typeof item === 'string' && item.trim()) {
      items.push({ name: item.trim(), evidence: '', years: null })
      continue
    }
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const name = typeof record.name === 'string' ? record.name.trim() : ''
    if (!name) continue
    items.push({
      name,
      evidence: typeof record.evidence === 'string' ? record.evidence.trim() : '',
      years: asOptionalNumber(record.years),
      category: typeof record.category === 'string' ? record.category : undefined,
    })
  }
  return items
}

function asJobSkills(value: unknown): JobSkill[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (typeof item === 'string') return { name: item.trim() }
      if (!item || typeof item !== 'object') return null
      const record = item as Record<string, unknown>
      const name = typeof record.name === 'string' ? record.name.trim() : ''
      if (!name) return null
      return { name, category: typeof record.category === 'string' ? record.category : undefined }
    })
    .filter((item): item is JobSkill => Boolean(item))
}

export function parseResumeProfile(value: unknown): ResumeProfile {
  const record = asObject(value)
  const base = emptyResumeProfile()
  return {
    ...base,
    skills: asEvidenceList(record.skills),
    languages: asEvidenceList(record.languages ?? record.programmingLanguages),
    frameworks: asEvidenceList(record.frameworks),
    cloud: asEvidenceList(record.cloud ?? record.cloudTechnologies),
    databases: asEvidenceList(record.databases),
    devops: asEvidenceList(record.devops ?? record.tools),
    security: asEvidenceList(record.security ?? record.securityTechnologies),
    jobTitles: asStringArray(record.jobTitles),
    employers: asStringArray(record.employers),
    yearsOfExperience: asOptionalNumber(record.yearsOfExperience),
    education: Array.isArray(record.education)
      ? record.education.flatMap((item) => {
          if (!item || typeof item !== 'object') return []
          const row = item as Record<string, unknown>
          return [
            {
              degree: typeof row.degree === 'string' ? row.degree : '',
              field: typeof row.field === 'string' ? row.field : '',
              evidence: typeof row.evidence === 'string' ? row.evidence : '',
            },
          ]
        })
      : [],
    certifications: asEvidenceList(record.certifications),
    projects: asEvidenceList(record.projects),
    responsibilities: asEvidenceList(record.responsibilities),
    achievements: asEvidenceList(record.achievements),
    location: typeof record.location === 'string' ? record.location : '',
    workArrangement: typeof record.workArrangement === 'string' ? record.workArrangement : '',
    workAuthorization: typeof record.workAuthorization === 'string' ? record.workAuthorization : '',
  }
}

export function parseJobProfile(value: unknown): JobProfile {
  const record = asObject(value)
  const base = emptyJobProfile()
  const education = record.education && typeof record.education === 'object' ? (record.education as Record<string, unknown>) : {}
  const certifications =
    record.certifications && typeof record.certifications === 'object'
      ? (record.certifications as Record<string, unknown>)
      : {}

  return {
    ...base,
    requiredSkills: asJobSkills(record.requiredSkills),
    preferredSkills: asJobSkills(record.preferredSkills),
    languages: asJobSkills(record.languages ?? record.programmingLanguages),
    frameworks: asJobSkills(record.frameworks),
    cloud: asJobSkills(record.cloud ?? record.cloudTechnologies),
    databases: asJobSkills(record.databases),
    tools: asJobSkills(record.tools),
    security: asJobSkills(record.security ?? record.securityRequirements),
    yearsOfExperience: asOptionalNumber(record.yearsOfExperience),
    skillYears: Array.isArray(record.skillYears)
      ? record.skillYears.flatMap((item) => {
          if (!item || typeof item !== 'object') return []
          const row = item as Record<string, unknown>
          const name = typeof row.name === 'string' ? row.name : typeof row.skill === 'string' ? row.skill : ''
          const years = asOptionalNumber(row.years)
          return name && years ? [{ name, years }] : []
        })
      : [],
    education: {
      required: education.required === true,
      degree: typeof education.degree === 'string' ? education.degree : '',
      field: typeof education.field === 'string' ? education.field : '',
      details: typeof education.details === 'string' ? education.details : '',
    },
    certifications: {
      required: asStringArray(certifications.required),
      preferred: asStringArray(certifications.preferred),
    },
    location: typeof record.location === 'string' ? record.location : '',
    workArrangement: typeof record.workArrangement === 'string' ? record.workArrangement : '',
    employmentType: typeof record.employmentType === 'string' ? record.employmentType : '',
    sponsorship: typeof record.sponsorship === 'string' ? record.sponsorship : '',
    responsibilities: Array.isArray(record.responsibilities)
      ? record.responsibilities.flatMap((item) => {
          if (typeof item === 'string') return [{ text: item, required: true }]
          if (!item || typeof item !== 'object') return []
          const row = item as Record<string, unknown>
          const text = typeof row.text === 'string' ? row.text : typeof row.name === 'string' ? row.name : ''
          return text ? [{ text, required: row.required !== false }] : []
        })
      : [],
  }
}
