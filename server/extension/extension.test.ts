import { afterEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../app'
import type { ServerConfig } from '../config'
import { resetExtensionSessionsForTests, startExtensionSession } from './sessions'
import { applicationDetector } from '../../extension/src/detection/application-detector'

const config: ServerConfig = {
  port: 0,
  llmApiKey: '',
  llmApiBaseUrl: 'https://example.invalid/v1',
  llmModel: 'test-model',
  supabaseUrl: '',
  supabaseServiceRoleKey: '',
  joobleApiKey: '',
  joobleEnabled: false,
  joobleApiBaseUrl: 'https://jooble.org/api',
  usajobsApiKey: '',
  usajobsUserAgentEmail: '',
  usajobsEnabled: false,
  jobOpportunitiesEnabled: false,
  jobOpportunitiesApiBaseUrl: 'https://api.jobopportunitiesapi.org',
}

afterEach(() => {
  resetExtensionSessionsForTests()
})

describe('extension backend APIs', () => {
  it('requires a user id and does not expose secrets', async () => {
    const app = createApp({ config })
    const missing = await request(app).get('/api/extension/context')
    expect(missing.status).toBe(401)
    const context = await request(app).get('/api/extension/context').set('x-jobpilot-user-id', 'user-1')
    expect(context.status).toBe(200)
    expect(JSON.stringify(context.body)).not.toMatch(/service.role|SUPABASE_SERVICE_ROLE_KEY/i)
    expect(context.body.userId).toBe('user-1')
    expect(context.body.profile).toBeNull()
  })

  it('creates a session, reports detection, and never marks submitted', async () => {
    const app = createApp({ config })
    const created = await request(app).post('/api/extension/sessions').send({
      userId: 'user-1',
      jobId: 'job-1',
      applicationId: 'app-1',
      currentUrl: 'http://127.0.0.1:8787/extension/test/application.html',
    })
    expect(created.status).toBe(200)
    expect(created.body.session.state).toBe('detecting')
    const detection = applicationDetector({
      html: '<form><label>Email</label><input type="email" name="email"><button>Submit Application</button></form>',
      url: 'http://127.0.0.1:8787/extension/test/application.html',
    })
    const event = await request(app)
      .post(`/api/extension/sessions/${created.body.session.applicationSessionId}/events`)
      .send({ userId: 'user-1', message: { type: 'APPLICATION_READY', detection } })
    expect(event.body.session.state).toBe('ready')
    expect(event.body.session.state).not.toBe('submitted')
    const resume = await request(app).get('/api/extension/resume').query({ userId: 'user-1' })
    expect(resume.body.available).toBe(false)
  })

  it('serves the synthetic application test page', async () => {
    const app = createApp({ config })
    const page = await request(app).get('/extension/test/application.html')
    expect(page.status).toBe(200)
    expect(page.text).toMatch(/First Name/)
    expect(page.text).toMatch(/Upload Resume/)
    const detection = applicationDetector({ html: page.text, url: 'http://127.0.0.1:8787/extension/test/application.html' })
    expect(detection.isApplicationPage).toBe(true)
    expect(detection.provider).toBe('generic')
  })

  it('does not leak another user session', async () => {
    const session = startExtensionSession({ userId: 'user-1', jobId: 'job-1' })
    const app = createApp({ config })
    const other = await request(app).get(`/api/extension/sessions/${session.applicationSessionId}`).query({ userId: 'user-2' })
    expect(other.status).toBe(404)
  })
})
