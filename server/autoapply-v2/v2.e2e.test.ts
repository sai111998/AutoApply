import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listConfirmedApplications, resetConfirmedApplicationsForTests } from '../apply/confirmed'
import { useAutomationRuntimeForTests } from '../automation/runtime-io'
import { rememberLiveJobs, resetLiveJobStoreForTests } from '../jobs/live-store'
import type { LiveJob } from '../jobs/list'
import { emptyLiveMatch } from '../jobs/score'
import { installFakeSupabase, uninstallFakeSupabase } from '../testing/fake-supabase'
import { startV2AutoApply, toAutoApplyRunResult } from './campaign'
import { getV2Run, resetV2QueueForTests } from './queue'
import { resetV2SessionsForTests } from './session'
import { startV2SyntheticEmployer, type V2SyntheticEmployer } from './synthetic'
import { processV2QueueOnce, resetV2WorkerForTests } from './worker'

const USER_ID = '66666666-6666-4666-8666-666666666666'
const RESUME_ID = '77777777-7777-4777-8777-777777777777'
const RESUME_PATH = `${USER_ID}/${RESUME_ID}/Master_Resume.pdf`

let employer: V2SyntheticEmployer | null = null

beforeEach(() => {
  useAutomationRuntimeForTests(mkdtempSync(join(tmpdir(), 'jobpilot-v2e2e-')))
  resetLiveJobStoreForTests()
  resetConfirmedApplicationsForTests()
  resetV2QueueForTests()
  resetV2SessionsForTests()
  resetV2WorkerForTests()
})

afterEach(async () => {
  uninstallFakeSupabase()
  if (employer) {
    await employer.close()
    employer = null
  }
})

function syntheticLiveJob(jobUrl: string): LiveJob {
  const now = new Date().toISOString()
  return {
    id: 'v2-synthetic-job-1',
    title: 'Senior Engineer',
    company: 'V2 Test Employer',
    location: 'Remote',
    remote: true,
    employmentType: 'Full-time',
    seniority: null,
    description: 'V2 synthetic job description snapshot. Build reliable automation.',
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
    identityKey: 'live:v2-synthetic-job-1',
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

describe('V2 synthetic end-to-end (development test)', () => {
  it(
    'runs the real browser through apply, fill, upload, submit, confirmation, and persistence',
    async () => {
      employer = await startV2SyntheticEmployer()
      const { writes } = installFakeSupabase({
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
            parsed_text: 'Ada Lovelace resume text for the V2 synthetic test',
            created_at: '2026-09-01T00:00:00.000Z',
          },
        ],
        files: { [`resumes/${RESUME_PATH}`]: { body: Buffer.from('%PDF-1.4 synthetic resume'), contentType: 'application/pdf' } },
      })
      rememberLiveJobs([syntheticLiveJob(employer.jobUrl)])

      const started = await startV2AutoApply({ userId: USER_ID, jobId: 'v2-synthetic-job-1', allowSyntheticEmployer: true })
      expect(started.status).toBe('queued')
      expect(getV2Run(started.runId)?.source).toBe('synthetic-test')

      const finished = await processV2QueueOnce()
      expect(finished?.status).toBe('submitted')
      const run = getV2Run(started.runId)
      expect(run?.pageState).toBe('APPLICATION_PAGE')
      expect(run?.fieldsFilled).toEqual(expect.arrayContaining(['firstName', 'lastName', 'email', 'phone']))
      expect(run?.resumeUploaded).toBe(true)
      expect(run?.submitClicked).toBe(true)
      expect(run?.confirmationNumber).toBe('TEST-12345')
      expect(run?.confirmationText).toMatch(/Application Submitted/i)
      expect(run?.finalUrl).toContain('/test-employer/job/1/apply?step=done')

      const applications = listConfirmedApplications(USER_ID)
      expect(applications).toHaveLength(1)
      expect(applications[0]).toMatchObject({
        status: 'applied',
        jobTitle: 'Senior Engineer',
        confirmationNumber: 'TEST-12345',
        originalMatchScore: null,
        currentMatchScore: null,
      })
      expect(applications[0].submittedJobDescriptionSnapshot).toContain('V2 synthetic job description snapshot')
      expect(applications[0].finalUrl).toContain('/test-employer/job/1/apply?step=done')
      expect(applications[0].applicationUrl).toBe(employer.jobUrl)
      expect(writes.find((write) => write.table === 'applications')?.body).toMatchObject({
        application_url: applications[0].finalUrl,
        is_confirmed_submission: true,
        selected_resume_version_id: applications[0].submittedResumeVersionId,
      })
      expect(toAutoApplyRunResult(run!).items[0].applicationStatus).toBe('submitted')
    },
    120000,
  )
})
