import { describe, expect, it } from 'vitest'
import { scoreMatch } from './engine'
import { emptyJobProfile, emptyResumeProfile } from './ground'
import type { ResumeProfile } from './types'

const alexResumeText = `Senior product-minded frontend engineer with 8 years building React and TypeScript applications, design systems, and accessible user interfaces. Comfortable working across Node.js services and PostgreSQL when needed.
Senior Frontend Engineer, Northstar Labs — 2021 to present
Led a React and TypeScript design system used by four product teams.
Built accessible dashboard UI, including keyboard support and screen-reader reviews.
Wrote Jest and Playwright coverage for critical checkout and settings flows.
Frontend Engineer, Harbor Software — 2018 to 2021
Shipped GraphQL-backed product surfaces in React.
Skills: React, TypeScript, Node.js, GraphQL, design systems, accessibility, PostgreSQL, Jest, Playwright, CSS, Tailwind.
Education: B.A., University of Texas at Austin`

const alex: ResumeProfile = {
  ...emptyResumeProfile(),
  skills: [
    { name: 'React', evidence: '8 years building React and TypeScript applications', years: 8 },
    { name: 'TypeScript', evidence: '8 years building React and TypeScript applications', years: 8 },
    { name: 'Node.js', evidence: 'Comfortable working across Node.js services' },
    { name: 'GraphQL', evidence: 'Shipped GraphQL-backed product surfaces in React.' },
    { name: 'PostgreSQL', evidence: 'Node.js services and PostgreSQL when needed' },
    { name: 'Jest', evidence: 'Wrote Jest and Playwright coverage' },
    { name: 'Playwright', evidence: 'Wrote Jest and Playwright coverage' },
    { name: 'accessibility', evidence: 'Built accessible dashboard UI' },
    { name: 'Tailwind', evidence: 'Skills: React, TypeScript, Node.js, GraphQL, design systems, accessibility, PostgreSQL, Jest, Playwright, CSS, Tailwind.' },
  ],
  frameworks: [{ name: 'React', evidence: 'Led a React and TypeScript design system' }],
  languages: [{ name: 'TypeScript', evidence: 'building React and TypeScript applications', years: 8 }],
  databases: [{ name: 'PostgreSQL', evidence: 'PostgreSQL when needed' }],
  jobTitles: ['Senior Frontend Engineer', 'Frontend Engineer'],
  employers: ['Northstar Labs', 'Harbor Software'],
  yearsOfExperience: 8,
  education: [{ degree: 'B.A.', field: '', evidence: 'B.A., University of Texas at Austin' }],
  responsibilities: [
    { name: 'Led a design system', evidence: 'Led a React and TypeScript design system used by four product teams.' },
    { name: 'Built accessible dashboard UI', evidence: 'Built accessible dashboard UI, including keyboard support and screen-reader reviews.' },
  ],
  location: '',
  workArrangement: '',
}

describe('real-world style scenarios (Alex Rivera sample resume)', () => {
  it('Test A — strong frontend dashboard match recommends APPLY', () => {
    const job = {
      ...emptyJobProfile(),
      requiredSkills: [{ name: 'React' }, { name: 'TypeScript' }, { name: 'accessibility' }],
      preferredSkills: [{ name: 'GraphQL' }, { name: 'Jest' }],
      yearsOfExperience: 5,
      education: { required: false, degree: '', field: '', details: '' },
      location: 'Remote (US)',
      workArrangement: 'remote',
      responsibilities: [
        { text: 'Build dashboard experiences and design systems in React', required: true },
        { text: 'Own accessibility reviews for financial UI', required: true },
      ],
    }
    const report = scoreMatch(alex, job, alexResumeText)
    expect(report.recommendation).toBe('APPLY')
    expect(report.matchScore).toBeGreaterThan(report.requiredSkills.missing.length === 0 ? 70 : 0)
    expect(report.requiredSkills.missing).toHaveLength(0)
    expect(report.requiredSkills.matched.some((item) => item.evidence)).toBe(true)
  })

  it('Test B — moderate full-stack / hybrid role recommends REVIEW', () => {
    const job = {
      ...emptyJobProfile(),
      requiredSkills: [{ name: 'React' }, { name: 'TypeScript' }, { name: 'CRDT' }],
      preferredSkills: [{ name: 'GraphQL' }],
      yearsOfExperience: 6,
      location: 'Hybrid San Francisco',
      workArrangement: 'hybrid',
      education: { required: false, degree: '', field: '', details: '' },
      responsibilities: [
        { text: 'Build collaborative editor infrastructure', required: true },
        { text: 'Ship product surfaces in React', required: true },
      ],
    }
    const report = scoreMatch(alex, job, alexResumeText)
    expect(report.requiredSkills.missing.some((item) => item.name === 'CRDT')).toBe(true)
    expect(report.recommendation).toBe('REVIEW')
    expect(report.matchScore).toBeLessThan(80)
  })

  it('Test C — poor embedded / on-site match recommends SKIP', () => {
    const job = {
      ...emptyJobProfile(),
      requiredSkills: [{ name: 'Rust' }, { name: 'Embedded Linux' }, { name: 'Robotics' }],
      preferredSkills: [{ name: 'C++' }],
      yearsOfExperience: 5,
      location: 'On-site Boston',
      workArrangement: 'onsite',
      education: { required: true, degree: 'Master', field: 'Electrical Engineering', details: 'M.S. EE preferred as required' },
      responsibilities: [{ text: 'Write robotics firmware and middleware', required: true }],
    }
    const report = scoreMatch(alex, job, alexResumeText)
    expect(report.recommendation).toBe('SKIP')
    expect(report.requiredSkills.missing.length).toBeGreaterThanOrEqual(2)
    expect(report.matchScore).toBeLessThan(50)
  })
})

const javaResumeText = `Software Engineer with 5+ years software engineering.
Skills: Java, Spring Boot, REST APIs, AWS, PostgreSQL, Docker, Jenkins, JUnit, Mockito
Backend Engineer, Acme — 2018 to present
- Built Java and Spring Boot services exposing REST APIs.
- Deployed AWS applications and PostgreSQL databases.
- Used Docker, Jenkins, JUnit, and Mockito.
Education: B.S., Computer Science`

const javaResume: ResumeProfile = {
  ...emptyResumeProfile(),
  skills: [
    { name: 'Java', evidence: 'Built Java and Spring Boot services', years: 5 },
    { name: 'Spring Boot', evidence: 'Built Java and Spring Boot services' },
    { name: 'REST APIs', evidence: 'exposing REST APIs' },
    { name: 'AWS', evidence: 'Deployed AWS applications' },
    { name: 'PostgreSQL', evidence: 'PostgreSQL databases' },
    { name: 'Docker', evidence: 'Used Docker' },
    { name: 'Jenkins', evidence: 'Jenkins' },
    { name: 'JUnit', evidence: 'JUnit' },
    { name: 'Mockito', evidence: 'Mockito' },
  ],
  yearsOfExperience: 5,
  education: [{ degree: 'B.S.', field: 'Computer Science', evidence: 'B.S., Computer Science' }],
  responsibilities: [
    { name: 'Built REST APIs', evidence: 'Built Java and Spring Boot services exposing REST APIs.' },
    { name: 'Deployed AWS', evidence: 'Deployed AWS applications and PostgreSQL databases.' },
  ],
  location: 'Remote',
  workArrangement: 'remote',
}

describe('Java stack scoring model (strong / partial / bad)', () => {
  const strongJob = {
    ...emptyJobProfile(),
    requiredSkills: [
      { name: 'Java' },
      { name: 'Spring Boot' },
      { name: 'REST APIs' },
      { name: 'AWS' },
      { name: 'PostgreSQL' },
      { name: 'Docker' },
      { name: 'Jenkins' },
      { name: 'JUnit' },
      { name: 'Mockito' },
    ],
    yearsOfExperience: 5,
    education: { required: true, degree: 'Bachelor', field: 'Computer Science', details: 'B.S. Computer Science' },
    workArrangement: 'remote',
    location: 'Remote',
    responsibilities: [
      { text: 'Build Java Spring Boot REST APIs', required: true },
      { text: 'Deploy AWS and PostgreSQL', required: true },
    ],
  }

  it('Test A — strong match scores 80+ and is not capped at 49', () => {
    const report = scoreMatch(javaResume, strongJob, javaResumeText)
    expect(report.requiredSkills.missing).toHaveLength(0)
    expect(report.matchScore).toBeGreaterThanOrEqual(80)
    expect(report.matchScore).not.toBe(49)
  })

  it('Test B — partial match stays below 80 and names the gaps', () => {
    const job = {
      ...strongJob,
      requiredSkills: [
        { name: 'Java' },
        { name: 'Spring Boot' },
        { name: 'REST APIs' },
        { name: 'AWS' },
        { name: 'PostgreSQL' },
        { name: 'Kubernetes' },
        { name: 'Terraform' },
        { name: 'Go' },
        { name: 'Kafka' },
      ],
      preferredSkills: [{ name: 'GraphQL' }, { name: 'Rust' }],
      location: 'On-site Boston',
      workArrangement: 'onsite',
      education: { required: true, degree: 'Master', field: 'Electrical Engineering', details: 'M.S. EE required' },
    }
    const report = scoreMatch(javaResume, job, javaResumeText)
    expect(report.requiredSkills.missing.length).toBeGreaterThanOrEqual(3)
    expect(report.requiredSkills.missing.map((item) => item.name)).toEqual(
      expect.arrayContaining(['Kubernetes', 'Terraform', 'Go', 'Kafka']),
    )
    expect(report.matchScore).toBeLessThan(80)
  })

  it('Test C — unrelated resume stays low and is not forced above 80', () => {
    const resume: ResumeProfile = {
      ...emptyResumeProfile(),
      skills: [
        { name: 'Python', evidence: 'Python scripts' },
        { name: 'Django', evidence: 'Django apps' },
        { name: 'Excel', evidence: 'Excel reporting' },
      ],
      yearsOfExperience: 2,
    }
    const report = scoreMatch(resume, strongJob, 'Marketing analyst. Python scripts. Django apps. Excel reporting.')
    expect(report.matchScore).toBeLessThan(50)
    expect(report.recommendation).toBe('SKIP')
  })
})
