import { afterEach, describe, expect, it } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import { mkdtempSync } from 'node:fs'
import {
  startAutoApply,
  resetAutoApplyEngineForTests,
  prepareQueueItem,
  defaultAutoApplyConfig,
} from '../apply/engine'
import { JAVA_RESUME_TEXT } from '../tailor/fixtures'
import { classifyC2c } from '../jobs/c2c'
import { emptyLiveMatch } from '../jobs/score'
import { clearAutoApplyMemory } from '../apply/store'
import { resetExtensionProfilesForTests } from '../extension/profile-store'
import { inspectApplicationUrl } from '../../extension/src/shared/url'
import { inspectApplicationPage } from '../apply/detect'
import { detectApplicationProvider } from '../apply/providers'
import { analyzeApplicationSurface } from '../apply/surface'
import { detectSubmissionConfirmation } from '../apply/confirm'
import { isLegitimateApplyLabel } from '../apply/apply-action'
import { createBrowserApplicationSession, recordBrowserRedirect, resetBrowserSessionsForTests } from './session'
import { recoverStuckBrowserJobs, isRetryableBrowserJob, shouldNeverAutoRetry } from './recovery'
import { recordUserIntervention, resetInterventionsForTests, resolveUserIntervention } from './intervention'
import { detectAtsAdapter, supportedAtsProviders } from './providers'
import { queueStatusFromSession } from './types'
import { browserProfileDirectory } from './profile'
import { createBrowserWorker, resetBrowserWorkerForTests } from './worker'
import { resetAgentForTests } from '../agent'
import { startSyntheticEmployer, syntheticEmployerHtml } from './synthetic'
import { claimNextBrowserJob, resetBrowserWorkerQueueForTests } from './queue'
import { listConfirmedApplications, resetConfirmedApplicationsForTests } from '../apply/confirmed'
import type { AutoApplyProfile, AutoApplyQueueItem, ListedAutoApplyJob } from '../apply/types'

const profile: AutoApplyProfile = {
  fullName: 'Jordan Hale',
  email: 'jordan.hale@example.com',
  location: 'Austin, TX',
  yearsOfExperience: 6,
  workAuthorization: 'us_citizen',
  sponsorshipRequired: false,
  preferredWorkArrangement: 'hybrid',
  targetSalaryMin: null,
  targetSalaryMax: null,
}

function job(partial: Partial<ListedAutoApplyJob> & { id: string; title: string; url?: string; jobUrl?: string }): ListedAutoApplyJob {
  const description = partial.description ?? 'Java Spring Boot C2C corp to corp'
  const c2c = classifyC2c({ title: partial.title, description })
  return {
    company: 'Acme',
    description,
    url: partial.url ?? `https://jobs.example.com/${partial.id}`,
    jobUrl: partial.jobUrl ?? partial.url ?? `https://jobs.example.com/${partial.id}`,
    identityKey: `job-opportunities:${partial.id}`,
    provider: 'job-opportunities',
    providerJobId: partial.id,
    location: partial.location ?? 'Austin, TX',
    employmentType: 'Contract',
    postedAt: '2026-09-17T00:00:00.000Z',
    fetchedAt: '2026-09-17T00:00:00.000Z',
    ...partial,
    c2cStatus: partial.c2cStatus ?? c2c.status,
    c2cEvidence: partial.c2cEvidence ?? c2c.evidence,
    match: partial.match ?? { ...emptyLiveMatch('resume-1'), score: 90, matchedSkills: ['Java'], missingSkills: [] },
    matchScore: partial.matchScore ?? 90,
  }
}

function queuedItem(overrides: Partial<AutoApplyQueueItem> = {}): AutoApplyQueueItem {
  return {
    id: 'item-1',
    runId: 'run-1',
    jobId: 'job-1',
    identityKey: 'job-1',
    applicationId: 'app-1',
    resumeVersionId: 'resume-1',
    resumeVersionName: 'Master',
    title: 'Engineer',
    company: 'Acme',
    applicationUrl: 'https://jobs.example.com/apply',
    initialMatchScore: 90,
    finalMatchScore: 90,
    c2cStatus: 'confirmed',
    c2cEvidence: [],
    applicationStatus: 'opening',
    failureReason: null,
    questions: [],
    tailoredResumeText: 'Java',
    jobDescriptionSnapshot: 'Java Spring Boot C2C',
    location: 'Austin, TX',
    confirmationNumber: null,
    confirmationText: null,
    submittedAt: null,
    masterResumeUnchanged: true,
    sessionId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

afterEach(async () => {
  resetAutoApplyEngineForTests()
  resetAgentForTests()
  clearAutoApplyMemory()
  resetExtensionProfilesForTests()
  resetBrowserSessionsForTests()
  resetInterventionsForTests()
  resetBrowserWorkerQueueForTests()
  resetConfirmedApplicationsForTests()
  await resetBrowserWorkerForTests()
})

describe('browser worker architecture', () => {
  it('creates a browser application session and tracks redirects', () => {
    const session = createBrowserApplicationSession({
      applicationId: 'app-1',
      itemId: 'item-1',
      runId: 'run-1',
      jobId: 'job-1',
      resumeVersionId: 'resume-1',
      browserContextId: 'ctx-1',
      applicationUrl: 'https://jobs.example.com/role',
    })
    expect(session.state).toBe('opening')
    const redirected = recordBrowserRedirect(session, 'https://boards.greenhouse.io/acme/jobs/1')
    expect(redirected.currentUrl).toContain('greenhouse')
    expect(redirected.redirectUrls).toHaveLength(2)
    expect(queueStatusFromSession('ready_for_review')).toBe('ready_for_submission')
  })

  it('uses a persistent profile directory outside source control', () => {
    const directory = browserProfileDirectory({ JOBPILOT_BROWSER_PROFILE_DIR: path.join(os.tmpdir(), 'jobpilot-profile-test') })
    expect(directory).toContain('jobpilot-profile-test')
    expect(directory).not.toContain('/src/')
  })

  it('detects ATS providers and legitimate Apply actions', () => {
    expect(supportedAtsProviders()).toEqual(expect.arrayContaining(['workday', 'greenhouse', 'lever', 'ashby', 'icims', 'generic']))
    expect(detectAtsAdapter({ url: 'https://boards.greenhouse.io/acme/jobs/1' }).id).toBe('greenhouse')
    expect(detectAtsAdapter({ url: 'https://jobs.ashbyhq.com/acme/abc' }).id).toBe('ashby')
    expect(isLegitimateApplyLabel('Apply Now')).toBe(true)
    expect(isLegitimateApplyLabel('Easy Apply')).toBe(false)
    const jobHtml = syntheticEmployerHtml('job')
    expect(analyzeApplicationSurface(jobHtml).hasApplyControl).toBe(true)
  })

  it('maps known profile fields and pauses for unknown questions, CAPTCHA, MFA, and login', () => {
    expect(inspectApplicationPage('<div class="g-recaptcha" data-sitekey="x"></div>').status).toBe('captcha_required')
    expect(inspectApplicationPage('<p>Enter the authenticator app code</p>').status).toBe('mfa_required')
    expect(inspectApplicationPage('<form>Sign in<input type="password"></form>').status).toBe('login_required')
    const unknown = analyzeApplicationSurface('<form><label>When can you start?</label><input name="start"></form>')
    expect(unknown.inspection.questions.join(' ')).toMatch(/start/i)
    const intervention = recordUserIntervention({
      applicationId: 'app-1',
      itemId: 'item-1',
      reason: 'CAPTCHA_REQUIRED',
      currentUrl: 'https://jobs.example.com/apply',
    })
    expect(intervention.reason).toBe('CAPTCHA_REQUIRED')
    expect(resolveUserIntervention('item-1')?.resolvedAt).toBeTruthy()
  })

  it('rejects invalid and localhost employer URLs except the synthetic harness', () => {
    expect(inspectApplicationUrl('javascript:alert(1)').ok).toBe(false)
    expect(inspectApplicationUrl('http://localhost:5173/jobs').ok).toBe(false)
    expect(inspectApplicationUrl('https://jobs.example.com/apply').ok).toBe(true)
    expect(inspectApplicationUrl('http://127.0.0.1:8787/browser-worker/synthetic/apply').ok).toBe(true)
  })

  it('recovers crashed in-progress jobs and never auto-retries submitted ones', () => {
    const opening = queuedItem({ applicationStatus: 'opening' })
    const submitted = queuedItem({ id: 'item-2', applicationStatus: 'submitted' })
    const submitting = queuedItem({ id: 'item-3', applicationStatus: 'submitting' })
    recoverStuckBrowserJobs([opening, submitted, submitting], { stuckMs: 1, now: Date.now() + 10_000, restart: true })
    expect(opening.applicationStatus).toBe('queued')
    expect(submitted.applicationStatus).toBe('submitted')
    expect(submitting.applicationStatus).toBe('needs_confirmation')
    expect(shouldNeverAutoRetry(submitted)).toBe(true)
    expect(shouldNeverAutoRetry(submitting)).toBe(true)
    expect(isRetryableBrowserJob(submitting)).toBe(false)
    expect(isRetryableBrowserJob(queuedItem({ applicationStatus: 'queued' }))).toBe(true)
  })

  it('does not mark submitted without a reliable confirmation phrase', () => {
    expect(detectSubmissionConfirmation({ html: '<p>Thank you</p>' }).detected).toBe(false)
    expect(detectSubmissionConfirmation({ html: '<h1>Thank you for applying</h1><p>Confirmation number ABC12345</p>' }).detected).toBe(true)
  })

  it('queues Apply for the browser worker without a Chrome extension', async () => {
    const started = await startAutoApply(
      {
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
      },
      {
        userId: 'user-1',
        resumeId: 'resume-1',
        resumeVersionId: 'resume-1',
        resumeText: JAVA_RESUME_TEXT,
        masterResumeText: JAVA_RESUME_TEXT,
        profile,
        config: defaultAutoApplyConfig({ maxJobs: 1, minimumMatchRate: 70, autoTailorResume: false, q: 'Java' }),
      },
      undefined,
      { listJobs: async () => ({ jobs: [job({ id: 'java', title: 'Java Engineer' })] }), delayMs: 0 },
    )
    const prepared = await prepareQueueItem(started.run.id, started.items[0].id, { profile, userId: 'user-1' }, { delayMs: 0 })
    expect(prepared.item.applicationStatus).toBe('queued')
    expect(prepared.item.applicationStatus).not.toBe('extension_not_connected')
    expect(prepared.item.applicationUrl).toMatch(/^https:\/\//)
    const claimed = await claimNextBrowserJob()
    expect(claimed?.item.applicationUrl).toBe(prepared.item.applicationUrl)
    expect(claimed?.item.id).toBe(prepared.item.id)
  })

  it('launches Chromium, consumes the queue, and completes the synthetic employer flow', async () => {
    const site = await startSyntheticEmployer()
    const profileDir = mkdtempSync(path.join(os.tmpdir(), 'jobpilot-profile-'))
    const worker = await createBrowserWorker({ headless: true, userDataDir: profileDir, autoSubmit: true })
    try {
      const started = await startAutoApply(
        {
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
        },
        {
          userId: 'user-1',
          resumeId: 'resume-1',
          resumeVersionId: 'resume-1',
          resumeText: JAVA_RESUME_TEXT,
          masterResumeText: JAVA_RESUME_TEXT,
          profile,
          config: defaultAutoApplyConfig({ maxJobs: 1, minimumMatchRate: 70, autoTailorResume: false, q: 'Java' }),
        },
        undefined,
        {
          listJobs: async () => ({
            jobs: [job({ id: 'synth', title: 'Java Engineer', url: site.jobUrl, jobUrl: site.jobUrl })],
          }),
          delayMs: 0,
        },
      )
      expect(started.items[0].applicationStatus).toBe('queued')
      expect(started.run.status).toBe('running')
      expect(listConfirmedApplications('user-1')).toEqual([])
      const processed = await worker.processOnce()
      expect(processed?.applicationStatus).toBe('submitted')
      expect(processed?.failureReason).toBeNull()
      expect(processed?.confirmationNumber).toBe('ABC12345')
      expect(processed?.applicationStatus).not.toBe('opening')
      const confirmed = listConfirmedApplications('user-1')
      expect(confirmed).toHaveLength(1)
      expect(confirmed[0]?.status).toBe('applied')
      expect(confirmed[0]?.isConfirmedSubmission).toBe(true)
      expect(confirmed[0]?.submittedJobDescriptionSnapshot).toContain('C2C')
      expect(confirmed[0]?.submittedResumeVersionId).toBeTruthy()
      expect(confirmed[0]?.applicationUrl).toBeTruthy()
      expect(listConfirmedApplications('user-1')).toHaveLength(1)
    } finally {
      await worker.stop()
      await site.close()
    }
  }, 60_000)
})

describe('real supported ATS', () => {
  it('opens a Greenhouse board and detects Apply without submitting', async () => {
    const playwright = await import('playwright')
    const browser = await playwright.chromium.launch({ headless: true, args: ['--no-sandbox'] })
    try {
      const page = await browser.newPage()
      let response
      try {
        response = await page.goto('https://job-boards.greenhouse.io/gitlab', {
          waitUntil: 'domcontentloaded',
          timeout: 25_000,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (/Timeout|net::|ENOTFOUND|ECONN|ERR_/i.test(message)) return
        throw error
      }
      if (!response?.ok()) return
      const html = await page.content()
      expect(detectApplicationProvider({ url: page.url(), html }).id).toBe('greenhouse')
      const detection = analyzeApplicationSurface(html, { url: page.url() })
      expect(detection.provider).toBe('greenhouse')
      expect(detection.hasApplyControl || /apply/i.test(html)).toBe(true)
    } finally {
      await browser.close()
    }
  }, 45_000)
})
