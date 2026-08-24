import { describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { createApp } from './app'
import type { ServerConfig } from './config'
import type { LlmClient } from './services/llm'

const config: ServerConfig = {
  port: 0,
  llmApiKey: 'test-key',
  llmApiBaseUrl: 'https://example.invalid/v1',
  llmModel: 'test-model',
  supabaseUrl: '',
  supabaseServiceRoleKey: '',
}

const resumeExtract = {
  skills: [{ name: 'TypeScript', evidence: 'TypeScript engineer, 2018-2024', years: 6 }],
  languages: [{ name: 'TypeScript', evidence: 'TypeScript engineer', years: 6 }],
  frameworks: [],
  cloud: [],
  databases: [],
  devops: [],
  security: [],
  jobTitles: ['TypeScript engineer'],
  employers: [],
  yearsOfExperience: 6,
  education: [],
  certifications: [],
  projects: [],
  responsibilities: [{ name: 'Built product UI', evidence: 'TypeScript engineer, 2018-2024, remote in Texas.' }],
  achievements: [],
  location: 'Texas',
  workArrangement: 'remote',
  workAuthorization: '',
}

const jobExtract = {
  requiredSkills: [{ name: 'TypeScript' }],
  preferredSkills: [{ name: 'Kubernetes' }],
  languages: [{ name: 'TypeScript' }],
  frameworks: [],
  cloud: [],
  databases: [],
  tools: [],
  security: [],
  yearsOfExperience: 3,
  skillYears: [{ name: 'TypeScript', years: 3 }],
  education: { required: false, degree: '', field: '', details: '' },
  certifications: { required: [], preferred: [] },
  location: 'remote US',
  workArrangement: 'remote',
  employmentType: '',
  sponsorship: '',
  responsibilities: [{ text: 'Build TypeScript product surfaces', required: true }],
}

function llmStub(overrides: Partial<LlmClient> = {}): LlmClient {
  return {
    extractJson: vi.fn(),
    extractResume: vi.fn().mockResolvedValue(resumeExtract),
    extractJob: vi.fn().mockResolvedValue(jobExtract),
    ...overrides,
  }
}

describe('POST /api/jobs/analyze', () => {
  it('returns 400 when jobDescription or resumeText is empty', async () => {
    const app = createApp({ config, llm: llmStub() })
    const missingJob = await request(app).post('/api/jobs/analyze').send({
      jobDescription: ' ',
      resumeText: 'React developer',
    })
    expect(missingJob.status).toBe(400)
    expect(missingJob.body.error).toMatch(/jobDescription/)

    const missingResume = await request(app).post('/api/jobs/analyze').send({
      jobDescription: 'Frontend role',
      resumeText: '',
    })
    expect(missingResume.status).toBe(400)
    expect(missingResume.body.error).toMatch(/resumeText/)
  })

  it('returns a scored report from extracted resume and job facts', async () => {
    const llm = llmStub()
    const app = createApp({ config, llm })
    const response = await request(app).post('/api/jobs/analyze').send({
      jobDescription: 'TypeScript engineer, remote US. 3+ years TypeScript. Kubernetes is a plus.',
      resumeText: 'TypeScript engineer, 2018-2024, remote in Texas.',
    })

    expect(response.status).toBe(200)
    expect(response.body.matchScore).toBeGreaterThan(0)
    expect(['APPLY', 'REVIEW', 'SKIP']).toContain(response.body.recommendation)
    expect(response.body.matchedSkills).toContain('TypeScript')
    expect(response.body.confidence).toMatch(/HIGH|MEDIUM|LOW/)
    expect(response.body.report).toBeTruthy()
    expect(response.body.persisted).toBe(false)
    expect(llm.extractResume).toHaveBeenCalled()
    expect(llm.extractJob).toHaveBeenCalled()
  })

  it('returns 503 when the LLM key is missing', async () => {
    const app = createApp({
      config: { ...config, llmApiKey: '' },
    })
    const response = await request(app).post('/api/jobs/analyze').send({
      jobDescription: 'Role',
      resumeText: 'Resume',
    })
    expect(response.status).toBe(503)
    expect(response.body.error).toMatch(/LLM_API_KEY/)
  })

  it('returns 502 when the LLM payload is invalid', async () => {
    const app = createApp({
      config,
      llm: llmStub({ extractResume: vi.fn().mockResolvedValue({ hello: 'world' }) }),
    })
    const response = await request(app).post('/api/jobs/analyze').send({
      jobDescription: 'TypeScript engineer, remote US',
      resumeText: 'TypeScript engineer, 2018-2024, remote in Texas.',
    })
    expect(response.status).toBe(200)
    expect(response.body.report).toBeTruthy()
  })

  it('returns 502 when the LLM returns a non-object', async () => {
    const app = createApp({
      config,
      llm: llmStub({ extractResume: vi.fn().mockResolvedValue('not-json-object') }),
    })
    const response = await request(app).post('/api/jobs/analyze').send({
      jobDescription: 'Role requiring TypeScript',
      resumeText: 'TypeScript engineer',
    })
    expect(response.status).toBe(502)
  })

  it('returns 502 when the LLM call fails', async () => {
    const app = createApp({
      config,
      llm: llmStub({
        extractResume: vi.fn().mockRejectedValue(new Error('upstream failed')),
      }),
    })
    const response = await request(app).post('/api/jobs/analyze').send({
      jobDescription: 'Role',
      resumeText: 'Resume with TypeScript',
    })
    expect(response.status).toBe(502)
    expect(JSON.stringify(response.body)).not.toMatch(/test-key/)
  })

  it('still returns the report when database persistence fails', async () => {
    const persist = vi.fn().mockRejectedValue(new Error('insert failed'))
    const app = createApp({ config, llm: llmStub(), persist })
    const response = await request(app).post('/api/jobs/analyze').send({
      jobDescription: 'TypeScript engineer, remote US. 3+ years TypeScript.',
      resumeText: 'TypeScript engineer, 2018-2024, remote in Texas.',
      userId: 'user-1',
    })
    expect(response.status).toBe(200)
    expect(response.body.persisted).toBe(false)
    expect(response.body.matchScore).toEqual(expect.any(Number))
  })

  it('persists the analysis when storage succeeds', async () => {
    const persist = vi.fn().mockResolvedValue({
      persisted: true,
      jobId: 'job-1',
      matchId: 'match-1',
    })
    const app = createApp({ config, llm: llmStub(), persist })
    const response = await request(app).post('/api/jobs/analyze').send({
      jobDescription: 'TypeScript engineer, remote US',
      resumeText: 'TypeScript engineer, 2018-2024, remote in Texas.',
      userId: 'user-1',
    })
    expect(response.status).toBe(200)
    expect(response.body.persisted).toBe(true)
    expect(response.body.jobId).toBe('job-1')
    expect(response.body.matchId).toBe('match-1')
    expect(persist).toHaveBeenCalled()
  })

  it('does not expose an API key in the JSON body', async () => {
    const app = createApp({ config, llm: llmStub() })
    const response = await request(app).post('/api/jobs/analyze').send({
      jobDescription: 'TypeScript engineer, remote US',
      resumeText: 'TypeScript engineer, 2018-2024, remote in Texas.',
    })
    expect(JSON.stringify(response.body)).not.toMatch(/test-key/)
    expect(JSON.stringify(response.body)).not.toMatch(/LLM_API_KEY/)
  })
})

describe('POST /api/resumes/extract', () => {
  it('extracts plain text from a .txt resume', async () => {
    const app = createApp({ config, llm: llmStub() })
    const response = await request(app)
      .post('/api/resumes/extract')
      .set('X-File-Name', 'resume.txt')
      .set('Content-Type', 'text/plain')
      .send('Java and Spring Boot engineer')
    expect(response.status).toBe(200)
    expect(response.body.text).toBe('Java and Spring Boot engineer')
  })
})

describe('POST /api/resumes/tailor', () => {
  const resumeText = `Jordan Hale
Austin, TX
jordan.hale@example.com

Summary
Software Engineer with experience in Java development.

Experience
Backend Engineer, Northwind — 2021 to present
- Developed Java and Spring Boot applications for payments APIs.

Skills
Java, Spring Boot, PostgreSQL
`

  it('rejects missing resume or job text', async () => {
    const app = createApp({ config, llm: llmStub() })
    const missingResume = await request(app).post('/api/resumes/tailor').send({
      resumeText: ' ',
      jobDescription: 'Java role',
    })
    expect(missingResume.status).toBe(400)

    const missingJob = await request(app).post('/api/resumes/tailor').send({
      resumeText,
      jobDescription: ' ',
    })
    expect(missingJob.status).toBe(400)
  })

  it('returns an invalid payload when the model invents a skill', async () => {
    const app = createApp({
      config,
      llm: llmStub({
        extractJson: vi.fn().mockResolvedValue({
          summary: 'Java engineer',
          skills: ['Java', 'Kubernetes'],
          experience: [],
          projects: [],
          education: [],
          certifications: [],
          changes: [],
          omissions: [],
          warnings: [],
        }),
      }),
    })
    const response = await request(app).post('/api/resumes/tailor').send({
      resumeText,
      jobDescription: 'Senior Java Software Engineer. Kubernetes required.',
    })
    expect(response.status).toBe(422)
    expect(response.body.status).toBe('invalid')
    expect(response.body.tailored).toBeNull()
    expect(response.body.message).toMatch(/could not be verified/)
    expect(JSON.stringify(response.body)).not.toMatch(/test-key/)
  })

  it('returns failed instead of hanging when the LLM times out', async () => {
    const { HttpError } = await import('./types')
    const app = createApp({
      config,
      llm: llmStub({
        extractJson: vi.fn().mockRejectedValue(new HttpError(504, 'The analysis model timed out. Please try again.')),
      }),
    })
    const response = await request(app).post('/api/resumes/tailor').send({
      resumeText,
      jobDescription: 'Senior Java Software Engineer. Required: Java, Spring Boot.',
    })
    expect(response.status).toBe(504)
    expect(response.body.status).toBe('failed')
    expect(response.body.tailored).toBeNull()
    expect(JSON.stringify(response.body)).not.toMatch(/test-key/)
  })

  it('returns a PDF for a verified tailored resume', async () => {
    const app = createApp({ config, llm: llmStub() })
    const response = await request(app).post('/api/resumes/pdf').send({
      tailored: {
        summary: 'Software Engineer with experience in Java development.',
        skills: ['Java', 'Spring Boot'],
        experience: [{ company: 'Northwind', title: 'Backend Engineer', dates: '2021 to present', bullets: ['Developed Java applications.'] }],
        projects: [],
        education: [],
        certifications: [],
        changes: [],
        omissions: [],
        warnings: [],
      },
      contact: { name: 'Jordan Hale', email: 'jordan.hale@example.com', location: 'Austin, TX' },
    })
    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toMatch(/pdf/)
    expect(response.body.length).toBeGreaterThan(500)
  })
})

describe('GET /api/health', () => {
  it('reports whether the LLM key is present without returning it', async () => {
    const app = createApp({ config })
    const response = await request(app).get('/api/health')
    expect(response.status).toBe(200)
    expect(response.body.ok).toBe(true)
    expect(response.body.llmConfigured).toBe(true)
    expect(JSON.stringify(response.body)).not.toContain('test-key')
  })
})
