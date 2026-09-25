import { extractResumeLocal } from '../match/extract-local'
import type { EvidenceItem, ResumeProfile } from '../match/types'
import type { AutoApplyProfile } from '../apply/types'
import { splitCandidateName } from './candidate-profile'

export interface CandidateExperience {
  employer: string
  title: string
  dates: string
  responsibilities: string[]
  achievements: string[]
}

export interface CandidateEducation {
  school: string
  degree: string
  field: string
  dates: string
}

export interface CandidateSkillGroups {
  languages: EvidenceItem[]
  frameworks: EvidenceItem[]
  cloud: EvidenceItem[]
  databases: EvidenceItem[]
  tools: EvidenceItem[]
}

export interface CandidateApplicationProfile {
  userId: string
  identity: {
    firstName: string
    lastName: string
    preferredName: string
    fullName: string
  }
  contact: {
    email: string
    phone: string
  }
  location: {
    address: string
    city: string
    state: string
    zip: string
    country: string
    raw: string
  }
  professional: {
    linkedin: string
    github: string
    portfolio: string
  }
  work: {
    experience: CandidateExperience[]
    employers: string[]
    titles: string[]
  }
  education: CandidateEducation[]
  skills: CandidateSkillGroups
  certifications: string[]
  projects: string[]
  employment: {
    workAuthorization: string | null
    sponsorshipRequired: boolean
    yearsOfExperience: number | null
  }
  preferences: {
    desiredRoles: string[]
    locations: string[]
    remotePreference: string | null
    employmentTypes: string[]
    c2c: boolean
    salaryMin: number | null
    salaryMax: number | null
  }
  resume: {
    masterText: string
    defaultVersionId: string | null
    versions: Array<{ id: string; name: string; text: string }>
  }
}

export interface CandidateProfileInput {
  userId?: string
  profile: AutoApplyProfile & {
    phone?: string | null
    linkedin?: string | null
    github?: string | null
    portfolio?: string | null
    address?: string | null
    city?: string | null
    state?: string | null
    zip?: string | null
    country?: string | null
    preferredName?: string | null
    desiredRoles?: string[]
    desiredLocations?: string[]
    employmentTypes?: string[]
    c2c?: boolean
  }
  resumeText?: string | null
  masterResumeText?: string | null
  resumeVersionId?: string | null
  resumeVersionName?: string | null
}

function splitName(fullName: string): { firstName: string; lastName: string } {
  return splitCandidateName(fullName)
}

function parseLocation(raw: string): { city: string; state: string; zip: string; country: string } {
  const text = raw.trim()
  const zip = text.match(/\b\d{5}(?:-\d{4})?\b/)?.[0] ?? ''
  const country = /\b(united states|usa|u\.s\.a?\.?)\b/i.test(text) ? 'United States' : ''
  const parts = text.split(',').map((item) => item.trim()).filter(Boolean)
  const city = parts[0] && !/\d/.test(parts[0]) ? parts[0] : ''
  const stateToken = parts[1]?.replace(/\d.*/, '').trim() ?? ''
  const state = stateToken.length <= 20 ? stateToken : ''
  return { city, state, zip, country }
}

function pairExperience(resume: ResumeProfile): CandidateExperience[] {
  const count = Math.max(resume.employers.length, resume.jobTitles.length)
  return Array.from({ length: count }, (_, index) => ({
    employer: resume.employers[index] ?? '',
    title: resume.jobTitles[index] ?? '',
    dates: '',
    responsibilities: resume.responsibilities.filter((_, itemIndex) => itemIndex === index).map((item) => item.name),
    achievements: resume.achievements.filter((_, itemIndex) => itemIndex === index).map((item) => item.name),
  })).filter((item) => item.employer || item.title)
}

export function buildCandidateApplicationProfile(input: CandidateProfileInput): CandidateApplicationProfile {
  const profile = input.profile
  const resumeText = input.resumeText?.trim() || input.masterResumeText?.trim() || ''
  const extracted = resumeText ? extractResumeLocal(resumeText) : null
  const { firstName, lastName } = splitName(profile.fullName)
  const parsed = parseLocation(profile.city || profile.location)
  const master = input.masterResumeText?.trim() || resumeText
  return {
    userId: input.userId?.trim() || '',
    identity: {
      firstName,
      lastName,
      preferredName: profile.preferredName?.trim() || firstName,
      fullName: profile.fullName.trim(),
    },
    contact: {
      email: profile.email.trim(),
      phone: profile.phone?.trim() || '',
    },
    location: {
      address: profile.address?.trim() || '',
      city: profile.city?.trim() || parsed.city,
      state: profile.state?.trim() || parsed.state,
      zip: profile.zip?.trim() || parsed.zip,
      country: profile.country?.trim() || parsed.country,
      raw: profile.location.trim(),
    },
    professional: {
      linkedin: profile.linkedin?.trim() || '',
      github: profile.github?.trim() || '',
      portfolio: profile.portfolio?.trim() || '',
    },
    work: {
      experience: extracted ? pairExperience(extracted) : [],
      employers: extracted?.employers ?? [],
      titles: extracted?.jobTitles ?? [],
    },
    education: (extracted?.education ?? []).map((item) => {
      const leftover = item.evidence
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part && part !== item.degree && part !== item.field)
      const school =
        leftover.find((part) => /university|college|institute|school/i.test(part)) || leftover[0] || ''
      return {
        school,
        degree: item.degree,
        field: item.field,
        dates: '',
      }
    }),
    skills: {
      languages: extracted?.languages ?? [],
      frameworks: extracted?.frameworks ?? [],
      cloud: extracted?.cloud ?? [],
      databases: extracted?.databases ?? [],
      tools: [...(extracted?.devops ?? []), ...(extracted?.skills ?? [])],
    },
    certifications: (extracted?.certifications ?? []).map((item) => item.name),
    projects: (extracted?.projects ?? []).map((item) => item.name),
    employment: {
      workAuthorization: profile.workAuthorization,
      sponsorshipRequired: profile.sponsorshipRequired,
      yearsOfExperience: profile.yearsOfExperience ?? extracted?.yearsOfExperience ?? null,
    },
    preferences: {
      desiredRoles: profile.desiredRoles ?? [],
      locations: profile.desiredLocations ?? (profile.location ? [profile.location] : []),
      remotePreference: profile.preferredWorkArrangement,
      employmentTypes: profile.employmentTypes ?? [],
      c2c: profile.c2c === true,
      salaryMin: profile.targetSalaryMin,
      salaryMax: profile.targetSalaryMax,
    },
    resume: {
      masterText: master,
      defaultVersionId: input.resumeVersionId ?? null,
      versions: input.resumeVersionId
        ? [{ id: input.resumeVersionId, name: input.resumeVersionName || 'Selected', text: resumeText || master }]
        : [],
    },
  }
}

export function toAutoApplyProfile(profile: CandidateApplicationProfile): AutoApplyProfile {
  return {
    fullName: profile.identity.fullName,
    email: profile.contact.email,
    location: profile.location.raw || [profile.location.city, profile.location.state].filter(Boolean).join(', '),
    yearsOfExperience: profile.employment.yearsOfExperience,
    workAuthorization: profile.employment.workAuthorization,
    sponsorshipRequired: profile.employment.sponsorshipRequired,
    preferredWorkArrangement: profile.preferences.remotePreference,
    targetSalaryMin: profile.preferences.salaryMin,
    targetSalaryMax: profile.preferences.salaryMax,
  }
}

export function candidateFillValues(profile: CandidateApplicationProfile): Record<string, string> {
  const values: Record<string, string> = {
    fullName: profile.identity.fullName,
    firstName: profile.identity.firstName,
    lastName: profile.identity.lastName,
    email: profile.contact.email,
    phone: profile.contact.phone,
    city: profile.location.city || profile.location.raw,
    state: profile.location.state,
    zip: profile.location.zip,
    country: profile.location.country,
    address: profile.location.address,
    linkedin: profile.professional.linkedin,
    github: profile.professional.github,
    portfolio: profile.professional.portfolio,
  }
  if (profile.employment.yearsOfExperience != null) {
    values.yearsExperience = String(profile.employment.yearsOfExperience)
  }
  if (
    profile.employment.workAuthorization === 'us_citizen' ||
    profile.employment.workAuthorization === 'us_permanent_resident' ||
    profile.employment.workAuthorization === 'work_visa'
  ) {
    values.workAuthorization = 'Yes'
  } else if (profile.employment.workAuthorization === 'needs_sponsorship') {
    values.workAuthorization = 'No'
  }
  values.sponsorship = profile.employment.sponsorshipRequired ? 'Yes' : 'No'
  if (profile.preferences.salaryMin != null || profile.preferences.salaryMax != null) {
    values.salary = [profile.preferences.salaryMin, profile.preferences.salaryMax].filter((item) => item != null).join('-')
  }
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value.trim()))
}

export function verifiedSkillYears(profile: CandidateApplicationProfile, skill: string): number | null {
  const needle = skill.trim().toLowerCase()
  if (!needle) return null
  const items = [
    ...profile.skills.languages,
    ...profile.skills.frameworks,
    ...profile.skills.cloud,
    ...profile.skills.databases,
    ...profile.skills.tools,
  ]
  const match = items.find((item) => item.name.trim().toLowerCase() === needle)
  return typeof match?.years === 'number' && Number.isFinite(match.years) ? match.years : null
}
