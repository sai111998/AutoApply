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

const llmResult = {
  matchScore: 72,
  recommendation: 'REVIEW',
  matchedSkills: ['TypeScript'],
  partiallyMatchedSkills: ['AWS'],
  missingSkills: ['Kubernetes'],
  experienceMatch: true,
  educationMatch: true,
  locationMatch: true,
  strengths: ['Resume lists TypeScript production work'],
  concerns: ['Resume does not mention Kubernetes'],
  summary: 'Partial infrastructure overlap based only on the resume text.',
}

function llmStub(result: unknown = llmResult): LlmClient {
  return {
    complete: vi.fn().mockResolvedValue(result),
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

  it('returns the structured analysis from the LLM', async () => {
    const llm = llmStub()
    const app = createApp({ config, llm })
    const response = await request(app).post('/api/jobs/analyze').send({
      jobDescription: 'TypeScript engineer, remote US',
      resumeText: 'TypeScript engineer, 2018-2024, remote in Texas.',
    })

    expect(response.status).toBe(200)
    expect(response.body.matchScore).toBe(72)
    expect(response.body.recommendation).toBe('REVIEW')
    expect(response.body.matchedSkills).toEqual(['TypeScript'])
    expect(response.body.persisted).toBe(false)
    expect(llm.complete).toHaveBeenCalledWith(
      'TypeScript engineer, remote US',
      'TypeScript engineer, 2018-2024, remote in Texas.',
    )
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
      llm: llmStub({ hello: 'world' }),
    })
    const response = await request(app).post('/api/jobs/analyze').send({
      jobDescription: 'Role',
      resumeText: 'Resume',
    })
    expect(response.status).toBe(502)
  })

  it('persists the analysis when storage succeeds', async () => {
    const persist = vi.fn().mockResolvedValue({
      persisted: true,
      jobId: 'job-1',
      matchId: 'match-1',
    })
    const app = createApp({ config, llm: llmStub(), persist })
    const response = await request(app).post('/api/jobs/analyze').send({
      jobDescription: 'Role',
      resumeText: 'Resume',
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
      jobDescription: 'Role',
      resumeText: 'Resume',
    })
    expect(JSON.stringify(response.body)).not.toMatch(/test-key/)
    expect(JSON.stringify(response.body)).not.toMatch(/LLM_API_KEY/)
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
