import { afterEach, describe, expect, it } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import { mkdtempSync } from 'node:fs'
import { JAVA_RESUME_TEXT } from '../tailor/fixtures'
import { startExecutionCampaign, SYNTHETIC_SLICE_CONFIRMATION, SYNTHETIC_SLICE_TITLE } from './campaign'
import { resetAgentForTests } from './index'
import { createBrowserWorker, resetBrowserWorkerForTests } from '../browser-worker/worker'
import { startSyntheticEmployer } from '../browser-worker/synthetic'
import { getAutoApplyRun, resetAutoApplyEngineForTests } from '../apply/engine'
import { clearAutoApplyMemory } from '../apply/store'
import { listConfirmedApplications, resetConfirmedApplicationsForTests } from '../apply/confirmed'
import { getExecutionState } from './state'
import type { ServerConfig } from '../config'
import { defaultAutoApplyConfig } from '../apply/engine'

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

const profile = {
  fullName: 'Jordan Hale',
  email: 'jordan.hale@example.com',
  location: 'Austin, TX',
  yearsOfExperience: 6,
  workAuthorization: 'us_citizen' as const,
  sponsorshipRequired: false,
  preferredWorkArrangement: 'hybrid',
  targetSalaryMin: null,
  targetSalaryMax: null,
  phone: '5125550100',
  linkedin: 'https://linkedin.com/in/jordanhale',
}

afterEach(async () => {
  resetAgentForTests()
  resetAutoApplyEngineForTests()
  clearAutoApplyMemory()
  resetConfirmedApplicationsForTests()
  await resetBrowserWorkerForTests()
})

describe('synthetic Auto Apply vertical slice', () => {
  it('runs the real agent and browser worker through submit and confirmation', async () => {
    const site = await startSyntheticEmployer()
    const profileDir = mkdtempSync(path.join(os.tmpdir(), 'jobpilot-slice-'))
    const worker = await createBrowserWorker({ headless: true, userDataDir: profileDir })
    await worker.start()
    try {
      const started = await startExecutionCampaign(
        { ...config, port: site.port },
        {
          userId: 'slice-user',
          resumeId: 'resume-1',
          resumeVersionId: 'resume-1',
          resumeText: JAVA_RESUME_TEXT,
          masterResumeText: JAVA_RESUME_TEXT,
          profile,
          config: defaultAutoApplyConfig({
            maxJobs: 1,
            minimumMatchRate: 70,
            autoTailorResume: false,
            jobType: 'all',
            remotePreference: 'any',
            keywords: [],
          }),
        },
      )
      expect(started.status).toBe('running')
      expect(started.campaignId).toBeTruthy()

      const deadline = Date.now() + 90_000
      let current = await getAutoApplyRun(started.campaignId)
      while (Date.now() < deadline) {
        current = await getAutoApplyRun(started.campaignId)
        const status = current?.items[0]?.applicationStatus
        if (status && !['queued', 'opening', 'filling', 'preparing', 'submitting'].includes(status)) break
        await worker.processOnce()
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
      const item = current?.items[0]
      expect(item?.title).toBe(SYNTHETIC_SLICE_TITLE)
      expect(item?.applicationStatus).toBe('submitted')
      expect(item?.confirmationNumber).toBe(SYNTHETIC_SLICE_CONFIRMATION)
      expect(item?.failureReason).toBeNull()
      expect(getExecutionState(item!.id)?.state).toBe('submitted')
      const applications = listConfirmedApplications('slice-user')
      expect(applications).toHaveLength(1)
      expect(applications[0]?.confirmationNumber).toBe(SYNTHETIC_SLICE_CONFIRMATION)
      expect(applications[0]?.submittedResumeVersionId).toBe('resume-1')
      expect(applications[0]?.jobTitle).toBe(SYNTHETIC_SLICE_TITLE)
      expect(applications[0]?.status).toBe('applied')
    } finally {
      await worker.stop()
      await site.close()
    }
  }, 120_000)
})
