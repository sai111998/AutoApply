import { writeFileSync } from 'node:fs'
import { getServerConfig } from '../server/config'
import { listLiveJobs } from '../server/jobs/list'
import { JAVA_RESUME_TEXT } from '../server/tailor/fixtures'
import { defaultAutoApplyConfig } from '../server/apply/engine'
import { evaluateJobEligibility } from '../server/agent/pipeline'
import { getApplicationCapability } from '../server/application/capability'
import { detectRegisteredProvider } from '../server/application/providers/registry'
import { isAutoApplyCandidateHost, classifyApplicationCapability } from '../server/apply/capability'
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

function startInput(jobType: 'c2c' | 'all') {
  return {
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
      jobType,
    }),
  }
}

async function listJava(jobType: 'c2c' | 'all') {
  return listLiveJobs(getServerConfig(), {
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
    jobType,
  })
}

async function main() {
  const c2cListed = await listJava('c2c')
  const allListed = await listJava('all')
  const c2cInput = startInput('c2c')
  const allInput = startInput('all')
  const c2cEligible = c2cListed.jobs.filter((job) => evaluateJobEligibility(job, { startInput: c2cInput }).ok)
  const allEligible = allListed.jobs.filter((job) => evaluateJobEligibility(job, { startInput: allInput }).ok)

  const seen = new Set<string>()
  const sample: ListedAutoApplyJob[] = []
  for (const job of [...c2cEligible, ...allEligible, ...allListed.jobs]) {
    const url = job.jobUrl || job.url || ''
    if (!url || seen.has(url)) continue
    const classified = classifyApplicationCapability({
      url: job.url,
      applicationUrl: url,
      discoveryProvider: job.discoveryProvider || job.provider,
    })
    const ats =
      evaluateJobEligibility(job, { startInput: allInput }).ok ||
      isAutoApplyCandidateHost(classified) ||
      ['workday', 'greenhouse', 'lever', 'ashby', 'icims', 'smartrecruiters', 'oraclecloud'].includes(
        String(classified.provider),
      )
    if (!ats) continue
    seen.add(url)
    sample.push(job)
    if (sample.length >= 14) break
  }

  const rows: Array<{
    title: string
    company: string
    applicationUrl: string | null
    provider: string
    capability: string
    confidence: string
    reason: string | null
    c2cStatus: string
    eligibleC2c: boolean
    eligibleAll: boolean
    matchScore: number | null
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
        c2cStatus: job.c2cStatus,
        eligibleC2c: evaluateJobEligibility(job, { startInput: c2cInput }).ok,
        eligibleAll: evaluateJobEligibility(job, { startInput: allInput }).ok,
        matchScore: job.matchScore,
      })
    }
  } finally {
    await browser?.close().catch(() => undefined)
  }

  const report = {
    foundC2c: c2cListed.jobs.length,
    foundAll: allListed.jobs.length,
    eligibleC2c: c2cEligible.length,
    eligibleAll: allEligible.length,
    warning: allListed.warning ?? c2cListed.warning ?? null,
    autoApplySupported: rows.filter((row) => row.capability === 'auto_apply_supported').length,
    rows,
  }
  writeFileSync('/tmp/auto-apply-capability-diagnostic.json', JSON.stringify(report, null, 2))
  console.log(
    `C2C found ${report.foundC2c} eligible ${report.eligibleC2c} · All found ${report.foundAll} eligible ${report.eligibleAll} · Sample ${rows.length} · auto_apply_supported ${report.autoApplySupported}`,
  )
  console.log('Job | Company | Provider | Capability | Reason')
  for (const row of rows) {
    console.log(`${row.title} | ${row.company} | ${row.provider} | ${row.capability} | ${row.reason ?? ''}`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
