import http from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { createApp } from './app'
import type { ServerConfig } from './config'
import type { LlmClient } from './services/llm'
import { createExpressVercelHandler, restoreApiPath } from './vercel-api'

const config: ServerConfig = {
  port: 0,
  llmApiKey: 'test-key',
  llmApiBaseUrl: 'https://example.invalid/v1',
  llmModel: 'test-model',
  supabaseUrl: '',
  supabaseServiceRoleKey: '',
  joobleApiKey: '',
  joobleEnabled: true,
  joobleApiBaseUrl: 'https://jooble.org/api',
  usajobsApiKey: '',
  usajobsUserAgentEmail: '',
  usajobsEnabled: true,
}

function llmStub(): LlmClient {
  return {
    extractJson: vi.fn(),
    extractResume: vi.fn(),
    extractJob: vi.fn(),
  }
}

describe('restoreApiPath', () => {
  it('keeps Express routes that already include /api', () => {
    expect(restoreApiPath('/api/jobs/analyze')).toBe('/api/jobs/analyze')
    expect(restoreApiPath('/api/health')).toBe('/api/health')
    expect(restoreApiPath('/api/resumes/tailor?x=1')).toBe('/api/resumes/tailor?x=1')
  })

  it('prefixes /api when a Vercel catch-all strips it', () => {
    expect(restoreApiPath('/jobs/analyze')).toBe('/api/jobs/analyze')
    expect(restoreApiPath('/health')).toBe('/api/health')
    expect(restoreApiPath('/resumes/extract?name=cv.pdf')).toBe('/api/resumes/extract?name=cv.pdf')
  })
})

describe('Vercel Express adapter', () => {
  it('routes POST /api/jobs/analyze when the /api prefix is present', async () => {
    const server = http.createServer(createExpressVercelHandler(createApp({ config, llm: llmStub() })))
    const response = await request(server).post('/api/jobs/analyze').send({
      jobDescription: ' ',
      resumeText: 'React developer',
    })
    expect(response.status).toBe(400)
    expect(response.status).not.toBe(404)
    expect(response.body.error).toMatch(/jobDescription/)
  })

  it('routes POST /jobs/analyze when Vercel strips /api', async () => {
    const server = http.createServer(createExpressVercelHandler(createApp({ config, llm: llmStub() })))
    const response = await request(server).post('/jobs/analyze').send({
      jobDescription: ' ',
      resumeText: 'React developer',
    })
    expect(response.status).toBe(400)
    expect(response.status).not.toBe(404)
    expect(response.body.error).toMatch(/jobDescription/)
  })

  it('routes GET /health to the existing health endpoint', async () => {
    const server = http.createServer(createExpressVercelHandler(createApp({ config, llm: llmStub() })))
    const response = await request(server).get('/health')
    expect(response.status).toBe(200)
    expect(response.body.ok).toBe(true)
  })
})
