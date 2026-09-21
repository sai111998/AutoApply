import { writeFileSync } from 'node:fs'
import { getServerConfig } from '../server/config'
import { listLiveJobs } from '../server/jobs/list'
import { JAVA_RESUME_TEXT } from '../server/tailor/fixtures'
import { defaultAutoApplyConfig } from '../server/apply/engine'
import { evaluateJobEligibility } from '../server/agent/pipeline'
import { getApplicationCapability } from '../server/application/capability'
import { detectRegisteredProvider } from '../server/application/providers/registry'
import { liveCapabilityPreflight, type LiveCapabilityPage } from '../server/apply/live-capability'
import type { AutoApplyProfile, ListedAutoApplyJob } from '../server/apply/types'

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

async function main() {
  const config = getServerConfig()
  const listed = await listLiveJobs(config, {
    q: 'Java',
    country: 'US',
    state: '',
    remote: 'any',
    employmentType: 'any',
    seniority: '',
    page: 1,
    limit: 50,
    resumeText: JAVA_RESUME_TEXT,
    resumeVersionId: 'resume-1',
    sort: 'match',
    jobType: 'c2c',
  })

  const startInput = {
    userId: 'diagnostic',
    resumeId: 'resume-1',
    resumeVersionId: 'resume-1',
    resumeText: JAVA_RESUME_TEXT,
    masterResumeText: JAVA_RESUME_TEXT,
    profile,
    config: defaultAutoApplyConfig({
      maxJobs: 25,
      minimumMatchRate: 70,
      autoTailorResume: true,
      q: 'Java',
      jobType: 'c2c',
    }),
  }

  const eligible: ListedAutoApplyJob[] = []
  for (const job of listed.jobs) {
    if (evaluateJobEligibility(job, { startInput }).ok) eligible.push(job)
  }
  const sample = eligible.slice(0, 14)
  const rows: Array<{
    title: string
    company: string
    applicationUrl: string | null
    provider: string
    capability: string
    confidence: string
    reason: string | null
  }> = []

  let playwright: typeof import('playwright') | null = null
  try {
    playwright = await import('playwright')
  } catch {
    playwright = null
  }
  const browser = playwright
    ? await playwright.chromium.launch({ headless: true, args: ['--no-sandbox'] }).catch(() => null)
    : null

  try {
    for (const job of sample) {
      const url = job.jobUrl || job.url
      const detected = detectRegisteredProvider({ url })
      let decision = getApplicationCapability({
        url: job.url,
        applicationUrl: url,
        discoveryProvider: job.discoveryProvider || job.provider,
      })
      if (browser && url && decision.capability !== 'unsupported' && decision.capability !== 'blocked') {
        const page = await browser.newPage()
        try {
          decision = await liveCapabilityPreflight({
            jobId: job.id,
            title: job.title,
            company: job.company,
            applicationUrl: url,
            page: page as unknown as LiveCapabilityPage,
          })
        } catch {
          // Diagnostic only: never submit, never mutate queue state.
        } finally {
          await page.close().catch(() => undefined)
        }
      }
      rows.push({
        title: job.title,
        company: job.company,
        applicationUrl: url,
        provider: decision.provider || detected.provider,
        capability: decision.capability,
        confidence: decision.confidence,
        reason: decision.reason,
      })
    }
  } finally {
    await browser?.close().catch(() => undefined)
  }

  const report = {
    found: listed.jobs.length,
    eligible: eligible.length,
    warning: listed.warning ?? null,
    autoApplySupported: rows.filter((row) => row.capability === 'auto_apply_supported').length,
    rows,
  }
  writeFileSync('/tmp/auto-apply-capability-diagnostic.json', JSON.stringify(report, null, 2))
  console.log(`Found ${report.found} · Eligible ${report.eligible} · Auto-apply supported ${report.autoApplySupported}`)
  console.log('Job | Company | Provider | Capability | Reason')
  for (const row of rows) {
    console.log(`${row.title} | ${row.company} | ${row.provider} | ${row.capability} | ${row.reason ?? ''}`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
