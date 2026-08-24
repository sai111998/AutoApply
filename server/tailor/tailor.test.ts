import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { scoreMatch } from '../match/engine'
import { emptyJobProfile, emptyResumeProfile } from '../match/ground'
import type { JobProfile, ResumeProfile } from '../match/types'
import type { LlmClient } from '../services/llm'
import { conservativeTailor, tailorResume } from './engine'
import { buildTailoringPlan } from './plan'
import { isPdfBuffer, renderResumePdf } from './pdf'
import { collectSourceFacts } from './source'
import { VALIDATION_USER_MESSAGE, validateTailoredResume } from './validate'
import { createResumeVersion, deleteResumeVersion, versionsForUser } from './versions'
import type { ResumeVersionRecord } from './versions'
import type { TailoredResume } from './types'

export const JAVA_RESUME_TEXT = `Jordan Hale
Austin, TX
jordan.hale@example.com

Summary
Software Engineer with experience in Java development.

Experience
Backend Engineer, Northwind — 2021 to present
- Developed Java and Spring Boot applications for payments APIs.
- Owned PostgreSQL schema changes for billing.
- Worked with Docker in CI.
- Reduced checkout errors by adding contract tests.

Backend Engineer, Harbor Software — 2018 to 2021
- Built REST APIs in Java.
- Supported AWS-based services.

Skills
Java, Python, React, AWS, Docker, Spring Boot, PostgreSQL

Education
B.S., Computer Science, State University

Certifications
AWS Certified Developer

Projects
Billing API
`

const javaResume: ResumeProfile = {
  ...emptyResumeProfile(),
  skills: [
    { name: 'Java', evidence: 'Developed Java and Spring Boot applications for payments APIs.', years: 4 },
    { name: 'Spring Boot', evidence: 'Developed Java and Spring Boot applications for payments APIs.' },
    { name: 'PostgreSQL', evidence: 'Owned PostgreSQL schema changes for billing.' },
    { name: 'Docker', evidence: 'Worked with Docker in CI.' },
    { name: 'Python', evidence: 'Python' },
    { name: 'React', evidence: 'React' },
    { name: 'AWS', evidence: 'Supported AWS-based services.' },
  ],
  languages: [{ name: 'Java', evidence: '4 years Java', years: 4 }],
  frameworks: [{ name: 'Spring Boot', evidence: 'Spring Boot applications' }],
  databases: [{ name: 'PostgreSQL', evidence: 'PostgreSQL schema changes' }],
  devops: [{ name: 'Docker', evidence: 'Worked with Docker in CI.' }],
  cloud: [{ name: 'AWS', evidence: 'Supported AWS-based services.' }],
  jobTitles: ['Backend Engineer'],
  employers: ['Northwind', 'Harbor Software'],
  yearsOfExperience: 4,
  education: [{ degree: 'B.S.', field: 'Computer Science', evidence: 'B.S., Computer Science, State University' }],
  certifications: [{ name: 'AWS Certified Developer', evidence: 'AWS Certified Developer' }],
  projects: [{ name: 'Billing API', evidence: 'Billing API' }],
  responsibilities: [
    { name: 'Built payment APIs', evidence: 'Developed Java and Spring Boot applications for payments APIs.' },
    { name: 'Owned database schema', evidence: 'Owned PostgreSQL schema changes for billing.' },
  ],
}

const strongJob: JobProfile = {
  ...emptyJobProfile(),
  requiredSkills: [{ name: 'Java' }, { name: 'Spring Boot' }, { name: 'PostgreSQL' }],
  preferredSkills: [{ name: 'Docker' }, { name: 'Kubernetes' }],
  yearsOfExperience: 3,
  education: { required: true, degree: 'Bachelor', field: 'Computer Science', details: 'B.S. in Computer Science' },
  certifications: { required: [], preferred: ['AWS Certified Developer'] },
  location: 'Remote (US)',
  workArrangement: 'remote',
  responsibilities: [
    { text: 'Build and maintain payment APIs', required: true },
    { text: 'Own relational database schema changes', required: true },
  ],
}

function llmReturning(payload: unknown): LlmClient {
  return {
    extractJson: vi.fn().mockResolvedValue(payload),
    extractResume: vi.fn(),
    extractJob: vi.fn(),
  }
}

function validTailored(): TailoredResume {
  return {
    summary:
      'Software Engineer with 4+ years of experience developing Java and Spring Boot applications, REST APIs, PostgreSQL-backed services, and AWS-based solutions.',
    skills: ['Java', 'Spring Boot', 'PostgreSQL', 'AWS', 'Docker', 'React', 'Python'],
    experience: [
      {
        company: 'Northwind',
        title: 'Backend Engineer',
        dates: '2021 to present',
        bullets: [
          'Developed backend applications using Java and Spring Boot to support payment APIs.',
          'Owned PostgreSQL schema changes for billing.',
          'Worked with Docker in CI.',
        ],
      },
      {
        company: 'Harbor Software',
        title: 'Backend Engineer',
        dates: '2018 to 2021',
        bullets: ['Built REST APIs in Java.', 'Supported AWS-based services.'],
      },
    ],
    projects: [{ name: 'Billing API', bullets: [] }],
    education: [{ degree: 'B.S.', field: 'Computer Science', details: 'B.S., Computer Science, State University' }],
    certifications: ['AWS Certified Developer'],
    changes: [
      { kind: 'emphasis', label: 'Spring Boot moved higher in Skills' },
      {
        kind: 'rewritten',
        label: 'Payment API bullet',
        before: 'Developed Java and Spring Boot applications for payments APIs.',
        after: 'Developed backend applications using Java and Spring Boot to support payment APIs.',
      },
    ],
    omissions: ['Kubernetes'],
    warnings: [],
    contact: { name: 'Jordan Hale', email: 'jordan.hale@example.com', location: 'Austin, TX' },
  }
}

describe('resume tailoring', () => {
  it('emphasizes matching skills for a strong Java/Spring Boot role', async () => {
    const report = scoreMatch(javaResume, strongJob, JAVA_RESUME_TEXT)
    const result = await tailorResume(llmReturning(validTailored()), {
      resumeText: JAVA_RESUME_TEXT,
      jobDescription: 'Senior Java Software Engineer. Java, Spring Boot, PostgreSQL, Docker, Kubernetes.',
      resumeProfile: javaResume,
      matchReport: report,
      candidateName: 'Jordan Hale',
      candidateEmail: 'jordan.hale@example.com',
      candidateLocation: 'Austin, TX',
    })
    expect(result.status).toBe('complete')
    expect(result.plan.skillsToEmphasize).toEqual(expect.arrayContaining(['Java', 'Spring Boot']))
    expect(result.plan.missingSkills).toEqual(expect.arrayContaining(['Kubernetes']))
    expect(result.tailored?.skills[0]).toBe('Java')
    expect(result.tailored?.skills).not.toContain('Kubernetes')
    expect(result.tailored?.summary).toMatch(/Java and Spring Boot/)
  })

  it('builds a plan from a partial matchReport without preferred or certification buckets', () => {
    const plan = buildTailoringPlan(
      {
        matchScore: 91,
        recommendation: 'APPLY',
        requiredSkills: { matched: [{ name: 'Java' }], partial: [], missing: [{ name: 'Kubernetes' }] },
      } as never,
      javaResume,
      { jobDescription: 'Senior Java Software Engineer. Kubernetes required.' },
    )
    expect(plan.skillsToEmphasize).toEqual(expect.arrayContaining(['Java']))
    expect(plan.missingSkills).toEqual(expect.arrayContaining(['Kubernetes']))
  })

  it('falls back to a conservative draft when the LLM times out', async () => {
    const { HttpError } = await import('../types')
    const result = await tailorResume(
      {
        extractJson: vi.fn().mockRejectedValue(new HttpError(504, 'The analysis model timed out. Please try again.')),
        extractResume: vi.fn(),
        extractJob: vi.fn(),
      },
      {
        resumeText: JAVA_RESUME_TEXT,
        jobDescription: 'Senior Java Software Engineer. Java, Spring Boot, PostgreSQL.',
        resumeProfile: javaResume,
        matchReport: {
          matchScore: 91,
          recommendation: 'APPLY',
          requiredSkills: { matched: [{ name: 'Java' }], partial: [], missing: [] },
        } as never,
      },
    )
    expect(result.status).toBe('complete')
    expect(result.tailored?.skills).toEqual(expect.arrayContaining(['Java', 'Spring Boot']))
    expect(result.message).toMatch(/unavailable/i)
  })

  it('keeps partial matches from being invented for a moderate role', () => {
    const job: JobProfile = {
      ...strongJob,
      requiredSkills: [{ name: 'Java' }, { name: 'Spring Boot' }, { name: 'Kafka' }],
    }
    const report = scoreMatch(javaResume, job, JAVA_RESUME_TEXT)
    const plan = buildTailoringPlan(report, javaResume)
    expect(plan.missingSkills.some((item) => /kafka/i.test(item))).toBe(true)
    const conservative = conservativeTailor({
      resumeText: JAVA_RESUME_TEXT,
      jobDescription: 'Java Kafka role',
      resumeProfile: javaResume,
      matchReport: report,
    })
    expect(conservative.tailored?.skills.join(' ')).not.toMatch(/Kafka/i)
  })

  it('does not add missing stack items for a poor match', () => {
    const job: JobProfile = {
      ...emptyJobProfile(),
      requiredSkills: [{ name: 'Rust' }, { name: 'Embedded Linux' }, { name: 'Kubernetes' }],
    }
    const report = scoreMatch(javaResume, job, JAVA_RESUME_TEXT)
    const conservative = conservativeTailor({
      resumeText: JAVA_RESUME_TEXT,
      jobDescription: 'Rust embedded role',
      resumeProfile: javaResume,
      matchReport: report,
    })
    expect(conservative.tailored?.skills).not.toEqual(expect.arrayContaining(['Rust', 'Kubernetes']))
    expect(conservative.plan.missingSkills.length).toBeGreaterThan(0)
  })

  it('does not add a job-required skill that is absent from the resume', () => {
    const source = collectSourceFacts(JAVA_RESUME_TEXT, javaResume)
    const tailored = { ...validTailored(), skills: [...validTailored().skills, 'Kubernetes'] }
    const validation = validateTailoredResume(tailored, source, ['Kubernetes'])
    expect(validation.ok).toBe(false)
    expect(validation.errors.join(' ')).toMatch(/Kubernetes/)
  })

  it('does not invent metrics when the source resume has none beyond existing facts', () => {
    const source = collectSourceFacts(JAVA_RESUME_TEXT, javaResume)
    const tailored = validTailored()
    tailored.experience[0].bullets = ['Increased throughput by 47% and saved $2,000,000']
    const validation = validateTailoredResume(tailored, source, [])
    expect(validation.ok).toBe(false)
    expect(validation.errors.join(' ')).toMatch(/metric/i)
  })

  it('preserves multiple jobs from the source resume', () => {
    const conservative = conservativeTailor({
      resumeText: JAVA_RESUME_TEXT,
      jobDescription: 'Senior Java Software Engineer',
      resumeProfile: javaResume,
    })
    expect(conservative.tailored?.experience).toHaveLength(2)
    expect(conservative.tailored?.experience.map((item) => item.company)).toEqual(['Northwind', 'Harbor Software'])
  })

  it('keeps certifications that already exist', () => {
    const conservative = conservativeTailor({
      resumeText: JAVA_RESUME_TEXT,
      jobDescription: 'Senior Java Software Engineer',
      resumeProfile: javaResume,
    })
    expect(conservative.tailored?.certifications).toContain('AWS Certified Developer')
  })

  it('keeps projects that already exist', () => {
    const conservative = conservativeTailor({
      resumeText: JAVA_RESUME_TEXT,
      jobDescription: 'Senior Java Software Engineer',
      resumeProfile: javaResume,
    })
    expect(conservative.tailored?.projects.map((item) => item.name)).toContain('Billing API')
  })

  it('rejects an invalid AI response', async () => {
    const result = await tailorResume(llmReturning({ hello: 'world' }), {
      resumeText: JAVA_RESUME_TEXT,
      jobDescription: 'Senior Java Software Engineer',
      resumeProfile: javaResume,
    })
    expect(result.status).toBe('invalid')
    expect(result.tailored).toBeNull()
    expect(result.message).toBe(VALIDATION_USER_MESSAGE)
  })

  it('rejects an unsupported skill hallucination', async () => {
    const result = await tailorResume(llmReturning({ ...validTailored(), skills: ['Java', 'Kubernetes'] }), {
      resumeText: JAVA_RESUME_TEXT,
      jobDescription: 'Senior Java Software Engineer with Kubernetes',
      resumeProfile: javaResume,
      matchReport: scoreMatch(javaResume, strongJob, JAVA_RESUME_TEXT),
    })
    expect(result.status).toBe('invalid')
    expect(result.validation.errors.join(' ')).toMatch(/Kubernetes/)
  })

  it('rejects an unsupported certification hallucination', async () => {
    const result = await tailorResume(
      llmReturning({ ...validTailored(), certifications: ['CKA', 'AWS Certified Developer'] }),
      {
        resumeText: JAVA_RESUME_TEXT,
        jobDescription: 'Senior Java Software Engineer',
        resumeProfile: javaResume,
      },
    )
    expect(result.status).toBe('invalid')
    expect(result.validation.errors.join(' ')).toMatch(/CKA|certification/i)
  })

  it('rejects a date modification attempt', () => {
    const source = collectSourceFacts(JAVA_RESUME_TEXT, javaResume)
    const tailored = validTailored()
    tailored.experience[0].dates = '2015 to 2017'
    const validation = validateTailoredResume(tailored, source, [])
    expect(validation.ok).toBe(false)
    expect(validation.errors.join(' ')).toMatch(/Date/)
  })

  it('generates a PDF buffer for a tailored resume', async () => {
    const pdf = await renderResumePdf(validTailored())
    expect(isPdfBuffer(pdf)).toBe(true)
    expect(pdf.length).toBeGreaterThan(500)
    expect(pdf.toString('latin1')).toContain('Jordan Hale')
  })

  it('creates a resume version without replacing the source resume', () => {
    const store: ResumeVersionRecord[] = []
    const sourceIds = ['source-1']
    const version = createResumeVersion(store, {
      id: 'ver-1',
      userId: 'user-a',
      sourceResumeId: 'source-1',
      jobId: 'job-1',
      analysisId: 'match-1',
      versionName: 'Tailored — Senior Java Engineer — Northwind',
      resumeContent: validTailored(),
      tailoringSummary: { skillsToEmphasize: ['Java'], relatedSkills: [], missingSkills: ['Kubernetes'], experienceToEmphasize: [] },
      changes: validTailored().changes,
      warnings: [],
    })
    expect(store).toHaveLength(1)
    expect(version.sourceResumeId).toBe('source-1')
    expect(sourceIds).toEqual(['source-1'])
  })

  it('deletes a tailored version without removing the master resume id', () => {
    const store: ResumeVersionRecord[] = []
    createResumeVersion(store, {
      id: 'ver-1',
      userId: 'user-a',
      sourceResumeId: 'source-1',
      jobId: null,
      analysisId: null,
      versionName: 'Tailored',
      resumeContent: validTailored(),
      tailoringSummary: { skillsToEmphasize: [], relatedSkills: [], missingSkills: [], experienceToEmphasize: [] },
      changes: [],
      warnings: [],
    })
    const result = deleteResumeVersion(store, 'user-a', 'ver-1', ['source-1'])
    expect(result.deleted).toBe(true)
    expect(result.remainingSourceIds).toEqual(['source-1'])
    expect(store).toHaveLength(0)
  })

  it('extracts education, certifications, and projects from resume text without a profile', () => {
    const source = collectSourceFacts(JAVA_RESUME_TEXT, null)
    expect(source.certifications).toContain('AWS Certified Developer')
    expect(source.projects).toContain('Billing API')
    expect(source.education.some((item) => /computer science/i.test(item.field) || /computer science/i.test(item.details))).toBe(true)
    expect(source.roles).toHaveLength(2)
  })

  it('isolates resume versions by user', () => {
    const store: ResumeVersionRecord[] = []
    createResumeVersion(store, {
      id: 'ver-a',
      userId: 'user-a',
      sourceResumeId: 'source-a',
      jobId: null,
      analysisId: null,
      versionName: 'A',
      resumeContent: validTailored(),
      tailoringSummary: { skillsToEmphasize: [], relatedSkills: [], missingSkills: [], experienceToEmphasize: [] },
      changes: [],
      warnings: [],
    })
    createResumeVersion(store, {
      id: 'ver-b',
      userId: 'user-b',
      sourceResumeId: 'source-b',
      jobId: null,
      analysisId: null,
      versionName: 'B',
      resumeContent: validTailored(),
      tailoringSummary: { skillsToEmphasize: [], relatedSkills: [], missingSkills: [], experienceToEmphasize: [] },
      changes: [],
      warnings: [],
    })
    expect(versionsForUser(store, 'user-a').map((item) => item.id)).toEqual(['ver-a'])
    expect(() => deleteResumeVersion(store, 'user-a', 'ver-b', [])).toThrow(/own resume versions/)
    const sql = readFileSync(path.resolve(process.cwd(), 'supabase/migrations/003_resume_versions.sql'), 'utf8')
    expect(sql).toMatch(/enable row level security/)
    expect(sql).toMatch(/auth\.uid\(\) = user_id/)
    const statusSql = readFileSync(path.resolve(process.cwd(), 'supabase/migrations/004_resume_version_status.sql'), 'utf8')
    expect(statusSql).toMatch(/auth\.uid\(\) = user_id/)
  })
})
