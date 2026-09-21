import { describe, expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { getServerConfig } from '../config'
import { listLiveJobs } from '../jobs/list'
import { JAVA_RESUME_TEXT } from '../tailor/fixtures'
import { defaultAutoApplyConfig } from './engine'
import { evaluateJobEligibility } from '../agent/pipeline'
import { getApplicationCapability } from '../application/capability'
import { detectRegisteredProvider } from '../application/providers/registry'
import { liveCapabilityPreflight, type LiveCapabilityPage } from './live-capability'
import type { AutoApplyProfile, ListedAutoApplyJob } from './types'

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

export interface CapabilityDiagnosticRow {
  title: string
  company: string
  applicationUrl: string | null
  provider: string
  capability: string
  confidence: string
  reason: string | null
}

const runLive = process.env.AUTO_APPLY_LIVE_DIAGNOSTIC === '1'

describe.skipIf(!runLive)('live eligible job capability diagnostic', () => {
  it('preflights current eligible jobs without submitting', async () => {
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
    if (!listed.jobs.length) {
      writeFileSync(
        '/tmp/auto-apply-capability-diagnostic.json',
        JSON.stringify({ found: 0, eligible: 0, rows: [], warning: listed.warning ?? null }, null, 2),
      )
      expect(listed.warning?.message ?? '').not.toMatch(/sites are configured/i)
      return
    }

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
      const evaluated = evaluateJobEligibility(job, { startInput })
      if (evaluated.ok) eligible.push(job)
    }
    const sample = eligible.slice(0, 14)
    const rows: CapabilityDiagnosticRow[] = []
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
            // Keep the URL-based decision. Diagnostic must not submit or mutate queue state.
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

    writeFileSync(
      '/tmp/auto-apply-capability-diagnostic.json',
      JSON.stringify({ found: listed.jobs.length, eligible: eligible.length, rows }, null, 2),
    )
    console.info('[AutoApply] capability diagnostic')
    for (const row of rows) {
      console.info(`${row.title} | ${row.company} | ${row.provider} | ${row.capability} | ${row.reason ?? ''}`)
    }
    expect(rows.every((row) => row.capability !== 'submitted')).toBe(true)
    expect(listed.warning?.message ?? '').not.toMatch(/sites are configured/i)
  }, 240_000)
})
