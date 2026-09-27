import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app'
import { listConfirmedApplications, resetConfirmedApplicationsForTests } from '../apply/confirmed'
import { useAutomationRuntimeForTests } from '../automation/runtime-io'
import { getServerConfig } from '../config'
import { rememberLiveJobs, resetLiveJobStoreForTests } from '../jobs/live-store'
import type { LiveJob } from '../jobs/list'
import { emptyLiveMatch } from '../jobs/score'
import {
  FAKE_ANON_KEY,
  fakeSessionToken,
  installFakeSupabase,
  uninstallFakeSupabase,
  type FakeSupabaseData,
} from '../testing/fake-supabase'
import { detectV2VisibleCaptcha } from './agent'
import { launchV2Browser } from './browser'
import { resetV2RunInputsForTests } from './inputs'
import { getV2Run, resetV2QueueForTests } from './queue'
import { resetV2SessionsForTests } from './session'
import { startV2SyntheticEmployer, type V2SyntheticEmployer } from './synthetic'
import { V2_STAGES } from './types'
import { processV2QueueOnce, resetV2WorkerForTests } from './worker'

const USER_ID = '66666666-6666-4666-8666-666666666666'
const RESUME_ID = '77777777-7777-4777-8777-777777777777'
const RESUME_PATH = `${USER_ID}/${RESUME_ID}/Master_Resume.pdf`
const RESUME_TEXT = 'Ada Lovelace resume text for the V2 synthetic test'

let employer: V2SyntheticEmployer | null = null

beforeEach(() => {
  useAutomationRuntimeForTests(mkdtempSync(join(tmpdir(), 'jobpilot-v2e2e-')))
  resetLiveJobStoreForTests()
  resetConfirmedApplicationsForTests()
  resetV2QueueForTests()
  resetV2SessionsForTests()
  resetV2WorkerForTests()
  resetV2RunInputsForTests()
})

afterEach(async () => {
  uninstallFakeSupabase()
  if (employer) {
    await employer.close()
    employer = null
  }
})

function syntheticLiveJob(id: string, jobUrl: string, title = 'Senior Engineer'): LiveJob {
  const now = new Date().toISOString()
  return {
    id,
    title,
    company: 'V2 Test Employer',
    location: 'Remote',
    remote: true,
    employmentType: 'Full-time',
    seniority: null,
    description: `${title} synthetic job description snapshot. Build reliable automation.`,
    url: jobUrl,
    source: 'synthetic',
    sourceJobId: null,
    postedAt: null,
    fetchedAt: now,
    provider: 'synthetic',
    providerJobId: null,
    jobUrl,
    workArrangement: 'Remote',
    discoveredAt: now,
    lastVerifiedAt: now,
    identityKey: `live:${id}`,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    rawMetadata: {},
    match: emptyLiveMatch(),
    matchScore: null,
    matchedSkills: [],
    missingSkills: [],
    c2cStatus: 'unknown',
    c2cEvidence: [],
  }
}

function seedSyntheticAccount(options: { serviceRoleKey?: string | null; failures?: FakeSupabaseData['failures'] } = {}) {
  return installFakeSupabase(
    {
      users: [{ id: USER_ID }],
      profiles: [
        {
          id: USER_ID,
          full_name: 'Ada Lovelace',
          first_name: 'Ada',
          last_name: 'Lovelace',
          email: 'ada@example.com',
          phone: '555-0100',
          location: 'Austin, TX',
          work_authorization: 'us_citizen',
          sponsorship_required: false,
        },
      ],
      resumes: [
        {
          id: RESUME_ID,
          user_id: USER_ID,
          file_name: 'Master_Resume.pdf',
          file_type: 'application/pdf',
          version_label: 'Master',
          is_master: true,
          storage_path: RESUME_PATH,
          parsed_text: RESUME_TEXT,
          created_at: '2026-09-01T00:00:00.000Z',
        },
      ],
      files: { [`resumes/${RESUME_PATH}`]: { body: Buffer.from('%PDF-1.4 synthetic resume'), contentType: 'application/pdf' } },
      failures: options.failures,
    },
    { serviceRoleKey: options.serviceRoleKey },
  )
}

function applyNowApp() {
  return createApp({ config: getServerConfig(), allowSyntheticEmployer: true })
}

async function clickApplyNow(app: ReturnType<typeof applyNowApp>, jobId: string, token = fakeSessionToken(USER_ID)) {
  return request(app).post('/api/jobs/apply-one').set('Authorization', `Bearer ${token}`).send({ jobId })
}

async function processAndReadStatus(app: ReturnType<typeof applyNowApp>, runId: string) {
  await processV2QueueOnce()
  return (await request(app).get(`/api/jobs/apply-one/${runId}`)).body
}

describe('V2 CAPTCHA detection (real browser)', () => {
  it(
    'ignores invisible reCAPTCHA badges and hidden challenge frames, and flags a visible checkbox',
    async () => {
      const handle = await launchV2Browser(true)
      const frame = (src: string, size: string) => `<iframe src="data:text/html,${src}" style="${size};border:0"></iframe>`
      try {
        await handle.page.setContent(
          `<form><label>First Name <input name="first_name"></label><input type="file"></form>
           <div class="grecaptcha-badge">${frame('recaptcha/enterprise/anchor?k=site&size=invisible', 'width:256px;height:60px')}</div>
           <div style="visibility:hidden;position:absolute;top:-10000px">${frame('recaptcha/enterprise/bframe?k=site', 'width:400px;height:580px')}</div>`,
          { waitUntil: 'domcontentloaded' },
        )
        expect(await detectV2VisibleCaptcha(handle.page)).toBe(false)
        await handle.page.setContent(`<div class="g-recaptcha">${frame('recaptcha/api2/anchor?k=site&size=normal', 'width:304px;height:78px')}</div>`, {
          waitUntil: 'domcontentloaded',
        })
        expect(await detectV2VisibleCaptcha(handle.page)).toBe(true)
      } finally {
        await handle.close()
      }
    },
    60000,
  )
})

describe('One-click Apply synthetic regression (development test)', () => {
  it(
    'applies to the clicked job through the job page, steps, resume upload, submit, confirmation, and Applications',
    async () => {
      employer = await startV2SyntheticEmployer()
      const { writes } = seedSyntheticAccount()
      rememberLiveJobs([syntheticLiveJob('v2-synthetic-job-1', employer.jobUrl)])
      const app = applyNowApp()

      const started = await clickApplyNow(app, 'v2-synthetic-job-1')
      expect(started.status).toBe(200)
      expect(started.body).toEqual({ success: true, runId: expect.any(String), jobId: 'v2-synthetic-job-1', status: 'queued' })
      const runId: string = started.body.runId
      expect(getV2Run(runId)?.status).toBe('queued')

      const status = await processAndReadStatus(app, runId)
      expect(status).toMatchObject({
        runId,
        jobId: 'v2-synthetic-job-1',
        state: 'submitted',
        provider: 'generic',
        currentUrl: expect.stringContaining('/test-employer/job/1/apply?step=done'),
        queueState: 'finished',
        browserState: 'closed',
        submissionAttempted: true,
        submissionConfirmed: true,
        blocker: null,
        firstMissingStage: null,
      })
      const run = getV2Run(runId)
      expect(run?.trace?.map((entry) => entry.stage)).toEqual([...V2_STAGES])
      expect(run?.fieldsFilled).toEqual(expect.arrayContaining(['firstName', 'lastName', 'email', 'phone']))
      expect(run).toMatchObject({ resumeUploaded: true, submitClicked: true, confirmationNumber: 'TEST-12345' })

      const [application] = listConfirmedApplications(USER_ID)
      expect(application).toMatchObject({
        applicationId: status.applicationId,
        status: 'applied',
        jobTitle: 'Senior Engineer',
        company: 'V2 Test Employer',
        confirmationNumber: 'TEST-12345',
        applicationUrl: employer.jobUrl,
        originalMatchScore: null,
      })
      expect(application.finalUrl).toContain('/test-employer/job/1/apply?step=done')
      expect(application.submittedJobDescriptionSnapshot).toContain('Senior Engineer synthetic job description snapshot')
      expect(writes.find((write) => write.table === 'applications')?.body).toMatchObject({
        id: status.applicationId,
        status: 'applied',
        is_confirmed_submission: true,
        application_url: application.finalUrl,
        confirmation_number: 'TEST-12345',
        selected_resume_version_id: application.submittedResumeVersionId,
        submitted_job_description_snapshot: expect.stringContaining('synthetic job description snapshot'),
      })
      expect(writes.find((write) => write.table === 'resume_versions')?.body).toMatchObject({
        id: application.submittedResumeVersionId,
        source_resume_id: RESUME_ID,
        resume_content: expect.objectContaining({ summary: RESUME_TEXT }),
      })

      const again = await clickApplyNow(app, 'v2-synthetic-job-1')
      expect(again.status).toBe(409)
      expect(again.body.code).toBe('ALREADY_APPLIED')
    },
    120000,
  )

  it(
    'handles an application embedded in an iframe with a hidden resume input, saving it with the user session',
    async () => {
      employer = await startV2SyntheticEmployer()
      const { writes } = seedSyntheticAccount({ serviceRoleKey: null })
      rememberLiveJobs([syntheticLiveJob('v2-embedded-job', employer.embeddedJobUrl, 'Platform Engineer')])
      const app = applyNowApp()
      const token = fakeSessionToken(USER_ID)

      const started = await clickApplyNow(app, 'v2-embedded-job', token)
      const status = await processAndReadStatus(app, started.body.runId)
      expect(status).toMatchObject({ state: 'submitted', submissionConfirmed: true, blocker: null, firstMissingStage: null })
      expect(getV2Run(started.body.runId)?.confirmationNumber).toBe(employer.embeddedConfirmationId)
      expect(getV2Run(started.body.runId)?.trace?.map((entry) => entry.stage)).toEqual(
        V2_STAGES.filter((stage) => stage !== 'APPLY_FOUND' && stage !== 'APPLY_CLICKED'),
      )
      expect(employer.submissions).toEqual([
        { job: 'embedded', fullName: 'Ada Lovelace', resumeFileName: 'Master_Resume.pdf', coverLetterFileName: '' },
      ])
      const applicationWrites = writes.filter((write) => write.table === 'applications')
      expect(applicationWrites).toHaveLength(1)
      expect(applicationWrites[0]).toMatchObject({ authorization: `Bearer ${token}`, apikey: FAKE_ANON_KEY })
    },
    120000,
  )

  it(
    'stops safely at login, MFA, CAPTCHA, and required questions it cannot answer',
    async () => {
      employer = await startV2SyntheticEmployer()
      seedSyntheticAccount()
      const blockers = [
        { id: 'blocker-login', path: '/test-employer/job/3', state: 'login_required', code: 'LOGIN_REQUIRED' },
        { id: 'blocker-mfa', path: '/test-employer/job/4', state: 'mfa_required', code: 'MFA_REQUIRED' },
        { id: 'blocker-captcha', path: '/test-employer/job/5', state: 'captcha_required', code: 'CAPTCHA_REQUIRED' },
        { id: 'blocker-question', path: '/test-employer/job/6', state: 'needs_user_input', code: 'UNKNOWN_REQUIRED_FIELD' },
      ]
      rememberLiveJobs(blockers.map((blocker) => syntheticLiveJob(blocker.id, employer!.urlFor(blocker.path))))
      const app = applyNowApp()
      const runIds: Record<string, string> = {}
      for (const blocker of blockers) {
        const started = await clickApplyNow(app, blocker.id)
        expect(started.status).toBe(200)
        runIds[blocker.id] = started.body.runId
        const status = await processAndReadStatus(app, started.body.runId)
        expect(status).toMatchObject({
          state: blocker.state,
          submissionAttempted: false,
          submissionConfirmed: false,
          blocker: { code: blocker.code },
        })
      }
      expect(getV2Run(runIds['blocker-question'])?.failureReason).toMatch(/Years of Rust experience/)
      expect(listConfirmedApplications(USER_ID)).toHaveLength(0)
    },
    120000,
  )

  it(
    'reports APPLICATION_NOT_PERSISTED when Supabase rejects the Applications row',
    async () => {
      employer = await startV2SyntheticEmployer()
      seedSyntheticAccount({ failures: { applicationWrites: true } })
      rememberLiveJobs([syntheticLiveJob('v2-synthetic-job-1', employer.jobUrl)])
      const app = applyNowApp()
      const started = await clickApplyNow(app, 'v2-synthetic-job-1')
      const status = await processAndReadStatus(app, started.body.runId)
      expect(status).toMatchObject({
        state: 'submitted',
        submissionConfirmed: true,
        blocker: { code: 'APPLICATION_NOT_PERSISTED' },
        firstMissingStage: 'APPLICATION_PERSISTED',
      })
    },
    120000,
  )
})
