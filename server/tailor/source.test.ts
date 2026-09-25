import { describe, expect, it } from 'vitest'
import { emptyResumeProfile } from '../match/ground'
import {
  collectSourceFacts,
  extractContact,
  extractSummary,
  parseSourceRoles,
  rolesFromResumeProfile,
} from './source'

const STACKED_PDF_RESUME = `Varaha Sai Gopal Mukka
saigopal1558@gmail.com
Experienced in backend development, API integration, database interactions, CI/CD pipelines, testing frameworks, and production support aligned with scalable enterprise delivery standards consistently daily projects.

PROFESSIONAL SUMMARY

TECHNICAL SKILLS
Frontend & UI: React.js, Angular 10/16, Next.js, Redux, RxJS, HTML5, CSS3

EXPERIENCE
Amazon Web Services
System Development Engineer
Apr 2021 – Present
Dallas, TX
- Developed AWS automation for payment platforms.
- Designed software tools and maintained CI/CD pipelines.

Harbor Software
Backend Engineer
Jan 2018 – Mar 2021
- Built REST APIs in Java and Spring Boot.

EDUCATION
Master's in Computer Science – Governor's State University
2019 – 2021

CERTIFICATIONS
Microsoft Certified Azure Fundamentals
`

const PIPE_RESUME = `Alex Chen
Boston, MA
alex@example.com

Experience
Software Engineer | Acme Corp | 2019 to present
- Designed HTTP-based services.

Education
B.S., Computer Science
`

describe('resume source parsing', () => {
  it('keeps one-line Title, Company — Dates headers', () => {
    const roles = parseSourceRoles(`Experience
Backend Engineer, Northwind — 2021 to present
- Developed Java applications.
`)
    expect(roles).toEqual([
      {
        title: 'Backend Engineer',
        company: 'Northwind',
        dates: '2021 to present',
        bullets: ['Developed Java applications.'],
      },
    ])
  })

  it('parses stacked PDF company / title / dates blocks', () => {
    const roles = parseSourceRoles(STACKED_PDF_RESUME)
    expect(roles).toHaveLength(2)
    expect(roles[0]).toMatchObject({
      title: 'System Development Engineer',
      company: 'Amazon Web Services',
      dates: 'Apr 2021 – Present',
    })
    expect(roles[0].bullets).toEqual([
      'Developed AWS automation for payment platforms.',
      'Designed software tools and maintained CI/CD pipelines.',
    ])
    expect(roles[1]).toMatchObject({
      title: 'Backend Engineer',
      company: 'Harbor Software',
      dates: 'Jan 2018 – Mar 2021',
    })
  })

  it('parses pipe-separated role headers', () => {
    const roles = parseSourceRoles(PIPE_RESUME)
    expect(roles[0]).toMatchObject({
      title: 'Software Engineer',
      company: 'Acme Corp',
      dates: '2019 to present',
    })
  })

  it('does not treat education date ranges as jobs', () => {
    const roles = parseSourceRoles(STACKED_PDF_RESUME)
    expect(roles.some((role) => /governor|master/i.test(`${role.title} ${role.company}`))).toBe(false)
  })

  it('finds roles that PDF extraction placed after education', () => {
    const roles = parseSourceRoles(`Varaha Sai Gopal Mukka
saigopal1558@gmail.com

PROFESSIONAL SUMMARY

TECHNICAL SKILLS
React.js, Angular

EXPERIENCE

EDUCATION
Master's in Computer Science – Governor's State University

CERTIFICATIONS
Microsoft Certified Azure Fundamentals

Amazon Web Services
System Development Engineer
Apr 2021 – Present
- Developed AWS automation for payment platforms.
`)
    expect(roles).toHaveLength(1)
    expect(roles[0].title).toBe('System Development Engineer')
    expect(roles[0].company).toBe('Amazon Web Services')
  })

  it('does not treat a professional summary paragraph as the location', () => {
    const contact = extractContact(STACKED_PDF_RESUME)
    expect(contact.name).toBe('Varaha Sai Gopal Mukka')
    expect(contact.email).toBe('saigopal1558@gmail.com')
    expect(contact.location).toBe('Dallas, TX')
    expect(contact.location).not.toMatch(/Experienced in backend/)
  })

  it('keeps a real City, ST location and ignores summary text', () => {
    const contact = extractContact(`Jordan Hale
Austin, TX
jordan.hale@example.com
Experienced in backend development, API integration, database interactions, and CI pipelines.
`)
    expect(contact.location).toBe('Austin, TX')
  })

  it('does not use a heading-only professional summary as the summary body', () => {
    const summary = extractSummary(STACKED_PDF_RESUME)
    expect(summary).not.toMatch(/^professional summary$/i)
    expect(summary).toMatch(/Experienced in backend development/)
  })

  it('reconstructs roles from a resume profile when the text has no parseable headers', () => {
    const text = 'System Development Engineer at Amazon Web Services building payment APIs.'
    const roles = rolesFromResumeProfile(
      {
        ...emptyResumeProfile(),
        jobTitles: ['System Development Engineer'],
        employers: ['Amazon Web Services'],
        responsibilities: [{ name: 'Developed AWS automation for payment platforms.', evidence: 'Developed AWS automation for payment platforms.' }],
      },
      text,
    )
    expect(roles).toEqual([
      {
        title: 'System Development Engineer',
        company: 'Amazon Web Services',
        dates: '',
        bullets: ['Developed AWS automation for payment platforms.'],
      },
    ])
  })

  it('collects stacked roles for original and conservative resume drafts', () => {
    const source = collectSourceFacts(STACKED_PDF_RESUME, null)
    expect(source.roles).toHaveLength(2)
    expect(source.titles).toEqual(expect.arrayContaining(['System Development Engineer', 'Backend Engineer']))
    expect(source.employers).toEqual(expect.arrayContaining(['Amazon Web Services', 'Harbor Software']))
  })
})
