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
