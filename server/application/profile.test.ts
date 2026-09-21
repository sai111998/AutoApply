import { describe, expect, it } from 'vitest'
import { JAVA_RESUME_TEXT } from '../tailor/fixtures'
import type { AutoApplyProfile } from '../apply/types'
import {
  buildCandidateApplicationProfile,
  candidateFillValues,
  toAutoApplyProfile,
  verifiedSkillYears,
} from './profile'

const profile: AutoApplyProfile = {
  fullName: 'Jordan Hale',
  email: 'jordan.hale@example.com',
  location: 'Austin, TX 78701',
  yearsOfExperience: 6,
  workAuthorization: 'us_citizen',
  sponsorshipRequired: false,
  preferredWorkArrangement: 'hybrid',
  targetSalaryMin: 120000,
  targetSalaryMax: 150000,
}

describe('candidate application profile', () => {
  it('reuses AutoApply profile and resume evidence without inventing fields', () => {
    const candidate = buildCandidateApplicationProfile({
      userId: 'user-1',
      profile: {
        ...profile,
        phone: '512-555-0100',
        linkedin: 'https://linkedin.com/in/jordanhale',
        github: 'https://github.com/jordanhale',
        preferredName: 'Jordan',
        desiredRoles: ['Java Engineer'],
        c2c: true,
      },
      resumeText: JAVA_RESUME_TEXT,
      masterResumeText: JAVA_RESUME_TEXT,
      resumeVersionId: 'resume-1',
      resumeVersionName: 'Master',
    })
    expect(candidate.identity.firstName).toBe('Jordan')
    expect(candidate.identity.lastName).toBe('Hale')
    expect(candidate.contact.email).toBe('jordan.hale@example.com')
    expect(candidate.contact.phone).toBe('512-555-0100')
    expect(candidate.location.city).toBe('Austin')
    expect(candidate.professional.linkedin).toContain('linkedin.com')
    expect(candidate.work.employers.join(' ')).toMatch(/Northwind|Harbor/i)
    expect(candidate.work.titles.join(' ')).toMatch(/Backend Engineer/i)
    expect(candidate.education.some((item) => /computer science/i.test(item.field) || /b\.s/i.test(item.degree))).toBe(true)
    expect(candidate.skills.languages.some((item) => /java/i.test(item.name))).toBe(true)
    expect(candidate.certifications.join(' ')).toMatch(/AWS/i)
    expect(candidate.projects.join(' ')).toMatch(/Billing/i)
    expect(candidate.employment.workAuthorization).toBe('us_citizen')
    expect(candidate.employment.sponsorshipRequired).toBe(false)
    expect(candidate.preferences.c2c).toBe(true)
    expect(candidate.preferences.salaryMin).toBe(120000)
    expect(candidate.resume.masterText).toBe(JAVA_RESUME_TEXT)
    expect(candidate.resume.defaultVersionId).toBe('resume-1')
    expect(toAutoApplyProfile(candidate).email).toBe(profile.email)
  })

  it('fills only verified profile values and never invents skill years', () => {
    const candidate = buildCandidateApplicationProfile({
      profile: { ...profile, phone: '512-555-0100' },
      resumeText: JAVA_RESUME_TEXT,
    })
    const values = candidateFillValues(candidate)
    expect(values.firstName).toBe('Jordan')
    expect(values.email).toBe('jordan.hale@example.com')
    expect(values.phone).toBe('512-555-0100')
    expect(values.workAuthorization).toBe('Yes')
    expect(values.sponsorship).toBe('No')
    expect(values.salary).toBe('120000-150000')
    expect(verifiedSkillYears(candidate, 'Rust')).toBeNull()
    expect(values).not.toHaveProperty('inventedSkill')
  })
})
