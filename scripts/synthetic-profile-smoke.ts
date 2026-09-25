import { getServerConfig } from '../server/config'
import { parseAutoApplyStart } from '../server/apply/parse'
import { startExecutionCampaign } from '../server/agent/campaign'
import { memoryStore } from '../server/apply/store'
import { createBrowserWorker } from '../server/browser-worker/worker'
import { startSyntheticEmployer } from '../server/browser-worker/synthetic'
import { getCandidateApplicationProfile } from '../server/application/candidate-profile'
import { listConfirmedApplications } from '../server/apply/confirmed'
import { JAVA_RESUME_TEXT } from '../server/tailor/fixtures'

const TERMINAL = new Set([
  'submitted',
  'submission_uncertain',
  'submission_failed',
  'failed',
  'skipped',
  'cancelled',
  'captcha_required',
  'login_required',
  'mfa_required',
  'needs_user_input',
  'needs_user_confirmation',
  'needs_confirmation',
])

async function main() {
  const site = await startSyntheticEmployer()
  const config = { ...getServerConfig(), port: site.port }
  const userId = `profile-synthetic-${Date.now()}`

  const parsed = parseAutoApplyStart({
    userId,
    resumeId: 'resume-1',
    resumeVersionId: 'resume-1',
    resumeText: JAVA_RESUME_TEXT,
    masterResumeText: JAVA_RESUME_TEXT,
    profile: {
      fullName: 'Alex Rivera',
      email: 'alex.rivera@example.com',
      location: 'Austin, TX',
      yearsOfExperience: 6,
      workAuthorization: 'us_citizen',
      sponsorshipRequired: false,
      preferredWorkArrangement: 'hybrid',
      targetSalaryMin: null,
      targetSalaryMax: null,
      phone: '5125550100',
      linkedin: 'https://linkedin.com/in/alexrivera',
    },
    config: {
      maxJobs: 1,
      minimumMatchRate: 70,
      autoTailorResume: false,
      jobType: 'all',
      remotePreference: 'any',
      keywords: [],
    },
  })
  console.info('[ProfileSmoke] parser preserved phone:', parsed.profile.phone ? 'yes' : 'no')

  const started = await startExecutionCampaign(config, parsed)
  const canonical = getCandidateApplicationProfile(userId)
  console.info(
    '[ProfileSmoke] canonical profile:',
    JSON.stringify({
      firstName: canonical?.firstName ? 'available' : 'missing',
      lastName: canonical?.lastName ? 'available' : 'missing',
      email: canonical?.email ? 'available' : 'missing',
      phone: canonical?.phone ? 'available' : 'missing',
    }),
  )

  const worker = await createBrowserWorker({ headless: true, pollMs: 250 })
  await worker.start()
  try {
    const deadline = Date.now() + 90_000
    let item = null
    while (Date.now() < deadline) {
      const stored = await memoryStore.get(started.campaignId)
      item = stored?.items[0] ?? null
      if (item && TERMINAL.has(item.applicationStatus)) break
      await new Promise<void>((resolve) => setTimeout(resolve, 500))
    }
    const applications = listConfirmedApplications(userId)
    console.info(
      '[ProfileSmoke] result:',
      JSON.stringify(
        {
          items: (await memoryStore.get(started.campaignId))?.items.length ?? 0,
          status: item?.applicationStatus ?? 'none',
          failureReason: item?.failureReason ?? null,
          confirmationNumber: item?.confirmationNumber ?? null,
          finalUrl: item?.finalApplicationUrl ?? null,
          applications: applications.length,
        },
        null,
        2,
      ),
    )
    process.exitCode = item?.applicationStatus === 'submitted' ? 0 : 1
  } finally {
    await worker.stop()
    await site.close()
  }
}

void main().catch((error) => {
  console.error('[ProfileSmoke] FAILED', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
