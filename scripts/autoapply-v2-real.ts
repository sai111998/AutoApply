/* Dev-only: run exactly ONE real live job through Auto Apply V2. No filters, no retry. */
import { saveCandidateProfile } from '../server/application/candidate-store'
import { listConfirmedApplications } from '../server/apply/confirmed'
import { startV2AutoApply } from '../server/autoapply-v2/agent'
import { firstValidV2Job, resolveV2ApplicationUrl } from '../server/autoapply-v2/application'
import { getV2Run } from '../server/autoapply-v2/queue'
import { processV2QueueOnce } from '../server/autoapply-v2/worker'
import { getServerConfig } from '../server/config'
import { rememberLiveJobs } from '../server/jobs/live-store'
import { listLiveJobs } from '../server/jobs/list'
import { parseLiveJobsRequest } from '../server/jobs/parse'

const USER_ID = 'v2-real-user'

async function main() {
  saveCandidateProfile({
    userId: USER_ID,
    profile: {
      fullName: 'Ada Lovelace',
      email: 'ada@example.com',
      location: 'Austin, TX',
      yearsOfExperience: 8,
      workAuthorization: 'US Citizen',
      sponsorshipRequired: false,
      preferredWorkArrangement: 'Remote',
      targetSalaryMin: null,
      targetSalaryMax: null,
      phone: '555-0100',
      linkedin: 'https://linkedin.com/in/ada',
      github: 'https://github.com/ada',
    },
    resumeText: 'Ada Lovelace resume text for Auto Apply V2 real-job test',
    resumeVersionId: 'resume-v1',
  })

  const config = getServerConfig()
  const request = parseLiveJobsRequest({ q: 'software engineer', country: 'US', limit: 25 })
  const result = await listLiveJobs(config, request)
  console.log(`[V2-REAL] live jobs returned: ${result.jobs.length} source=${result.source}`)
  rememberLiveJobs(result.jobs)

  const picked = firstValidV2Job(
    USER_ID,
    result.jobs
      .map((job) => ({
        id: job.id,
        title: job.title,
        company: job.company,
        location: job.location,
        description: job.description,
        applicationUrl: resolveV2ApplicationUrl(job) ?? '',
      }))
      .filter((job) => job.applicationUrl),
  )
  if (!picked) {
    console.log('[V2-REAL] no valid unapplied live job found')
    process.exit(2)
  }
  console.log(`[V2-REAL] picked jobId=${picked.id} title=${picked.title} company=${picked.company}`)
  console.log(`[V2-REAL] initialUrl=${picked.applicationUrl}`)

  const started = await startV2AutoApply({ userId: USER_ID, jobId: picked.id })
  console.log(`[V2-REAL] runId=${started.runId} status=${started.status}`)
  const finished = await processV2QueueOnce()
  const run = finished ?? getV2Run(started.runId)
  const applications = listConfirmedApplications(USER_ID)
  console.log(
    JSON.stringify(
      {
        title: picked.title,
        company: picked.company,
        initialUrl: picked.applicationUrl,
        finalUrl: run?.finalUrl ?? null,
        provider: run?.provider ?? null,
        pageState: run?.pageState ?? null,
        status: run?.status ?? null,
        failureReason: run?.failureReason ?? null,
        fieldsDetected: run?.fieldsDetected ?? [],
        fieldsFilled: run?.fieldsFilled ?? [],
        resumeUploaded: run?.resumeUploaded ?? false,
        submitClicked: run?.submitClicked ?? false,
        confirmationNumber: run?.confirmationNumber ?? null,
        confirmationText: run?.confirmationText ?? null,
        applications: applications.length,
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error('[V2-REAL] fatal', error)
  process.exit(1)
})
