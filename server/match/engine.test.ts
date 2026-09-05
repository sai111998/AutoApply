import { describe, expect, it } from 'vitest'
import { scoreMatch } from './engine'
import { emptyJobProfile, emptyResumeProfile, groundResumeProfile } from './ground'
import type { JobProfile, ResumeProfile } from './types'

const strongResume: ResumeProfile = {
  ...emptyResumeProfile(),
  skills: [
    { name: 'Java', evidence: 'Developed Java and Spring Boot applications for payments APIs.', years: 4 },
    { name: 'Spring Boot', evidence: 'Developed Java and Spring Boot applications for payments APIs.' },
    { name: 'PostgreSQL', evidence: 'Owned PostgreSQL schema changes for billing.' },
    { name: 'Docker', evidence: 'Worked with Docker in CI.' },
  ],
  languages: [{ name: 'Java', evidence: '4 years Java', years: 4 }],
  frameworks: [{ name: 'Spring Boot', evidence: 'Spring Boot applications' }],
  databases: [{ name: 'PostgreSQL', evidence: 'PostgreSQL schema changes' }],
  devops: [{ name: 'Docker', evidence: 'Worked with Docker in CI.' }],
  jobTitles: ['Backend Engineer'],
  employers: ['Northwind'],
  yearsOfExperience: 4,
  education: [{ degree: 'B.S.', field: 'Computer Science', evidence: 'B.S., Computer Science, State University' }],
  certifications: [{ name: 'AWS Certified Developer', evidence: 'AWS Certified Developer' }],
  responsibilities: [
    { name: 'Built payment APIs', evidence: 'Developed Java and Spring Boot applications for payments APIs.' },
    { name: 'Owned database schema', evidence: 'Owned PostgreSQL schema changes for billing.' },
  ],
  achievements: [{ name: 'Reduced checkout errors', evidence: 'Reduced checkout errors by adding contract tests.' }],
  location: 'Austin, TX',
  workArrangement: 'remote',
}

const strongJob: JobProfile = {
  ...emptyJobProfile(),
  requiredSkills: [{ name: 'Java' }, { name: 'Spring Boot' }, { name: 'PostgreSQL' }],
  preferredSkills: [{ name: 'Docker' }, { name: 'Kubernetes' }],
  yearsOfExperience: 3,
  skillYears: [{ name: 'Java', years: 3 }],
  education: { required: true, degree: 'Bachelor', field: 'Computer Science', details: 'B.S. in Computer Science' },
  certifications: { required: [], preferred: ['AWS Certified Developer'] },
  location: 'Remote (US)',
  workArrangement: 'remote',
  responsibilities: [
    { text: 'Build and maintain payment APIs', required: true },
    { text: 'Own relational database schema changes', required: true },
  ],
}

describe('match engine scoring', () => {
  it('scores an excellent match as APPLY with high required coverage', () => {
    const report = scoreMatch(strongResume, strongJob, 'Developed Java and Spring Boot applications. Worked with Docker. 4 years Java. B.S., Computer Science.')
    expect(report.matchScore).toBeGreaterThanOrEqual(78)
    expect(report.recommendation).toBe('APPLY')
    expect(report.requiredSkills.missing).toHaveLength(0)
    expect(report.requiredSkills.matched.map((item) => item.name)).toEqual(expect.arrayContaining(['Java', 'Spring Boot']))
    expect(report.experience.status).toBe('match')
    expect(report.summary).toMatch(/not a hiring or interview prediction/i)
    expect(report.summary).not.toMatch(/guaranteed|will get an interview|will be hired/i)
  })

  it('scores a moderate match as REVIEW when preferred and one required are incomplete', () => {
    const job: JobProfile = {
      ...strongJob,
      requiredSkills: [{ name: 'Java' }, { name: 'Spring Boot' }, { name: 'Kafka' }],
      preferredSkills: [{ name: 'Kubernetes' }],
      yearsOfExperience: 4,
    }
    const report = scoreMatch(strongResume, job, 'Developed Java and Spring Boot applications. 4 years Java.')
    expect(report.recommendation).toBe('REVIEW')
    expect(report.requiredSkills.missing.some((item) => item.name === 'Kafka')).toBe(true)
    expect(report.matchScore).toBeLessThan(78)
    expect(report.matchScore).toBeGreaterThan(49)
  })

  it('scores a poor match as SKIP when the stack does not overlap', () => {
    const job: JobProfile = {
      ...emptyJobProfile(),
      requiredSkills: [{ name: 'Rust' }, { name: 'Embedded Linux' }, { name: 'Kubernetes' }],
      preferredSkills: [{ name: 'C++' }],
      yearsOfExperience: 5,
      education: { required: true, degree: 'Master', field: 'Electrical Engineering', details: 'M.S. EE' },
      location: 'On-site Boston',
      workArrangement: 'onsite',
      responsibilities: [{ text: 'Write firmware for robotics middleware', required: true }],
    }
    const report = scoreMatch(strongResume, job, 'Developed Java and Spring Boot applications.')
    expect(report.recommendation).toBe('SKIP')
    expect(report.matchScore).toBeLessThan(50)
    expect(report.requiredSkills.missing.length).toBeGreaterThanOrEqual(2)
  })

  it('does not let many preferred skills hide a missing required skill', () => {
    const job: JobProfile = {
      ...strongJob,
      requiredSkills: [{ name: 'Java' }, { name: 'Kubernetes' }],
      preferredSkills: [
        { name: 'Docker' },
        { name: 'PostgreSQL' },
        { name: 'Spring Boot' },
        { name: 'AWS Certified Developer' },
      ],
    }
    const report = scoreMatch(strongResume, job, 'Developed Java and Spring Boot applications. Worked with Docker.')
    expect(report.requiredSkills.missing.some((item) => item.name === 'Kubernetes')).toBe(true)
    expect(report.matchScore).toBeLessThanOrEqual(74)
    expect(report.recommendation).not.toBe('APPLY')
  })

  it('classifies a missing preferred skill without collapsing the required match', () => {
    const report = scoreMatch(strongResume, strongJob, 'Developed Java and Spring Boot applications. Worked with Docker.')
    const kube = report.preferredSkills.missing.find((item) => item.name === 'Kubernetes')
    expect(kube).toBeTruthy()
    expect(report.requiredSkills.matched.length).toBeGreaterThan(0)
    expect(report.recommendation).toBe('APPLY')
  })

  it('flags insufficient experience when years are below the requirement', () => {
    const job: JobProfile = {
      ...strongJob,
      yearsOfExperience: 8,
      skillYears: [{ name: 'Java', years: 8 }],
    }
    const report = scoreMatch(strongResume, job, '4 years Java. Developed Java and Spring Boot applications.')
    expect(report.experience.status).toBe('gap')
    expect(report.experience.jobRequirement).toMatch(/8/)
    expect(report.experience.candidateEvidence).toMatch(/4/)
    expect(report.recommendation).not.toBe('APPLY')
  })

  it('flags an education mismatch when the field and degree do not overlap', () => {
    const job: JobProfile = {
      ...strongJob,
      education: { required: true, degree: 'Master', field: 'Electrical Engineering', details: 'M.S. Electrical Engineering required' },
    }
    const report = scoreMatch(strongResume, job, 'B.S., Computer Science, State University')
    expect(report.education.status === 'missing' || report.education.status === 'partial').toBe(true)
    expect(report.education.details).toMatch(/Computer Science|Electrical Engineering/)
  })

  it('labels missing years as insufficient evidence instead of inventing them', () => {
    const resume: ResumeProfile = {
      ...strongResume,
      yearsOfExperience: null,
      skills: strongResume.skills.map((item) => ({ ...item, years: null })),
      languages: strongResume.languages.map((item) => ({ ...item, years: null })),
    }
    const job: JobProfile = {
      ...emptyJobProfile(),
      requiredSkills: [{ name: 'Java' }],
      yearsOfExperience: 3,
    }
    const report = scoreMatch(resume, job, 'Developed Java and Spring Boot applications. Worked with Docker.')
    expect(report.experience.status).toBe('insufficient_evidence')
    expect(report.experience.gap).toMatch(/Insufficient evidence/)
    expect(report.missingEvidence.join(' ')).toMatch(/years/i)
  })

  it('drops invented resume skills during grounding', () => {
    const invented: ResumeProfile = {
      ...emptyResumeProfile(),
      skills: [
        { name: 'Docker', evidence: 'Worked with Docker' },
        { name: 'Kubernetes', evidence: 'Orchestrated clusters' },
      ],
    }
    const grounded = groundResumeProfile(invented, 'Worked with Docker in the CI pipeline.')
    expect(grounded.skills.map((item) => item.name)).toEqual(['Docker'])
  })

  it('treats REST APIs and RESTful services as a strong match', () => {
    const resume: ResumeProfile = {
      ...emptyResumeProfile(),
      skills: [{ name: 'REST APIs', evidence: 'Designed and implemented REST APIs for internal and external applications.' }],
    }
    const job: JobProfile = {
      ...emptyJobProfile(),
      requiredSkills: [{ name: 'RESTful services' }],
    }
    const report = scoreMatch(
      resume,
      job,
      'Designed and implemented REST APIs for internal and external applications.',
    )
    expect(report.requiredSkills.matched.map((item) => item.name)).toEqual(expect.arrayContaining(['RESTful services']))
    expect(report.requiredSkills.missing).toHaveLength(0)
  })

  it('treats AWS service evidence as a strong match for cloud-native AWS', () => {
    const resume: ResumeProfile = {
      ...emptyResumeProfile(),
      cloud: [{ name: 'AWS', evidence: 'Deployed applications to AWS using EC2, S3 and RDS.' }],
      skills: [{ name: 'AWS', evidence: 'Deployed applications to AWS using EC2, S3 and RDS.' }],
    }
    const job: JobProfile = {
      ...emptyJobProfile(),
      requiredSkills: [{ name: 'AWS' }],
    }
    const report = scoreMatch(resume, job, 'Deployed applications to AWS using EC2, S3 and RDS.')
    expect(report.requiredSkills.matched.some((item) => item.name === 'AWS')).toBe(true)
  })

  it('does not treat Docker as Kubernetes experience', () => {
    const resume: ResumeProfile = {
      ...emptyResumeProfile(),
      devops: [{ name: 'Docker', evidence: 'Docker containerization.' }],
      skills: [{ name: 'Docker', evidence: 'Docker containerization.' }],
    }
    const job: JobProfile = {
      ...emptyJobProfile(),
      requiredSkills: [{ name: 'Kubernetes administration' }],
    }
    const report = scoreMatch(resume, job, 'Docker containerization.')
    expect(report.requiredSkills.missing.some((item) => /kubernetes/i.test(item.name))).toBe(true)
    expect(report.requiredSkills.matched.some((item) => /kubernetes/i.test(item.name))).toBe(false)
  })

  it('treats PostgreSQL as supporting a relational database requirement', () => {
    const resume: ResumeProfile = {
      ...emptyResumeProfile(),
      databases: [{ name: 'PostgreSQL', evidence: 'Owned PostgreSQL schema changes for billing.' }],
      skills: [{ name: 'PostgreSQL', evidence: 'Owned PostgreSQL schema changes for billing.' }],
    }
    const job: JobProfile = {
      ...emptyJobProfile(),
      requiredSkills: [{ name: 'relational database' }],
    }
    const report = scoreMatch(resume, job, 'Owned PostgreSQL schema changes for billing.')
    expect(report.requiredSkills.matched.some((item) => /relational database/i.test(item.name))).toBe(true)
  })

  it('does not treat Java as JavaScript', () => {
    const resume: ResumeProfile = {
      ...emptyResumeProfile(),
      languages: [{ name: 'Java', evidence: 'Developed Java services.' }],
      skills: [{ name: 'Java', evidence: 'Developed Java services.' }],
    }
    const job: JobProfile = {
      ...emptyJobProfile(),
      requiredSkills: [{ name: 'JavaScript' }],
    }
    const report = scoreMatch(resume, job, 'Developed Java services.')
    expect(report.requiredSkills.missing.some((item) => item.name === 'JavaScript')).toBe(true)
  })
})
