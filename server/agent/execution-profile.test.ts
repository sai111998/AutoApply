import { afterEach, describe, expect, it, vi } from 'vitest'
import { runExecutionBrowser } from '../browser-worker/browser'
import { getCandidateProfile, resetCandidateStoreForTests, saveCandidateProfile } from '../application/candidate-store'
import { resetConfirmedApplicationsForTests } from '../apply/confirmed'
import { defaultAutoApplyConfig } from '../apply/engine'
import { clearAutoApplyMemory } from '../apply/store'
import type { AutoApplyProfile, AutoApplyQueueItem, AutoApplyStartInput } from '../apply/types'
import type { ServerConfig } from '../config'
import { startExecutionCampaign } from './campaign'
import { resetAgentForTests } from './index'

const USER_ID = '11111111-1111-4111-8111-111111111111'

const config: ServerConfig = {
  port: 0,
  llmApiKey: '',
  llmApiBaseUrl: 'https://example.invalid/v1',
  llmModel: 'test-model',
  supabaseUrl: 'https://project.supabase.co',
  supabaseServiceRoleKey: 'service-role-test',
  joobleApiKey: '',
  joobleEnabled: false,
  joobleApiBaseUrl: 'https://jooble.org/api',
  usajobsApiKey: '',
  usajobsUserAgentEmail: '',
  usajobsEnabled: false,
  jobOpportunitiesEnabled: false,
  jobOpportunitiesApiBaseUrl: 'https://api.jobopportunitiesapi.org',
}

// What the browser sends when the Profile Name is a single word and no Phone is saved.
const oneWordNameNoPhone: AutoApplyProfile = {
  fullName: 'Jordan',
  email: 'jordan.hale@example.com',
  location: 'Austin, TX',
  yearsOfExperience: 6,
  workAuthorization: 'us_citizen',
  sponsorshipRequired: false,
  preferredWorkArrangement: 'hybrid',
  targetSalaryMin: null,
  targetSalaryMax: null,
  phone: null,
}

function startInput(profile: AutoApplyProfile): AutoApplyStartInput {
  return {
    userId: USER_ID,
    resumeId: 'resume-1',
    resumeVersionId: 'resume-1',
    resumeText: 'Java resume',
    masterResumeText: 'Java resume',
    profile,
    config: defaultAutoApplyConfig({ maxJobs: 1, minimumMatchRate: 70, autoTailorResume: false }),
  }
}

function syntheticItem(): AutoApplyQueueItem {
  return {
    id: 'item-1',
    runId: 'run-1',
    jobId: 'synthetic-job-1',
    identityKey: 'synthetic:1',
    applicationId: 'app-1',
    resumeVersionId: 'resume-1',
    resumeVersionName: 'Master',
    title: 'Senior Java Full Stack Developer',
    company: 'Test Employer',
    applicationUrl: 'http://127.0.0.1:8787/test-employer/job/1',
    initialMatchScore: null,
    finalMatchScore: null,
    c2cStatus: 'unknown',
    c2cEvidence: [],
    applicationStatus: 'queued',
    failureReason: null,
    questions: [],
    tailoredResumeText: 'Java resume',
    jobDescriptionSnapshot: 'JD',
    location: 'Austin, TX',
    confirmationNumber: null,
    confirmationText: null,
    submittedAt: null,
    masterResumeUnchanged: true,
    sessionId: null,
    createdAt: '2026-09-25T00:00:00.000Z',
    updatedAt: '2026-09-25T00:00:00.000Z',
  }
}

function stubSupabaseProfilesRow(row: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input)
      const body = url.includes('/rest/v1/profiles') ? JSON.stringify([row]) : '[]'
      return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } })
    }),
  )
}

afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 50))
  vi.unstubAllGlobals()
  resetAgentForTests()
  resetCandidateStoreForTests()
  resetConfirmedApplicationsForTests()
  clearAutoApplyMemory()
})

describe('Auto Apply button path profile source', () => {
  it('reports MISSING_PROFILE_FIELD:last_name,phone for a one-word name without phone', async () => {
    saveCandidateProfile({ userId: USER_ID, profile: oneWordNameNoPhone, resumeText: 'Java resume', resumeVersionId: 'resume-1' })
    const result = await runExecutionBrowser({ item: syntheticItem(), userId: USER_ID, playwrightAvailable: false })
    expect(result.executionState).toBe('needs_user_input')
    expect(result.failureReason).toBe('MISSING_PROFILE_FIELD:last_name,phone')
  })

  it('uses the last name and phone saved in Supabase profiles when the browser payload lacks them', async () => {
    stubSupabaseProfilesRow({ id: USER_ID, full_name: 'Jordan Hale', email: 'jordan.hale@example.com', phone: '5125550100' })
    await startExecutionCampaign(config, startInput(oneWordNameNoPhone))
    expect(getCandidateProfile(USER_ID)?.profile).toMatchObject({ fullName: 'Jordan Hale', phone: '5125550100' })
    const result = await runExecutionBrowser({ item: syntheticItem(), userId: USER_ID, playwrightAvailable: false })
    expect(result.failureReason).toBe('BROWSER_UNAVAILABLE')
  })

  it('still reports phone missing when Supabase has no phone either', async () => {
    stubSupabaseProfilesRow({ id: USER_ID, full_name: 'Jordan Hale', email: 'jordan.hale@example.com' })
    await startExecutionCampaign(config, startInput(oneWordNameNoPhone))
    const result = await runExecutionBrowser({ item: syntheticItem(), userId: USER_ID, playwrightAvailable: false })
    expect(result.executionState).toBe('needs_user_input')
    expect(result.failureReason).toBe('MISSING_PROFILE_FIELD:phone')
  })
})
