import { afterEach, describe, expect, it } from 'vitest'
import {
  applicationProviderRegistry,
  detectRegisteredProvider,
  isApplicationProviderRegistryPopulated,
  REQUIRED_ADAPTER_METHODS,
  workflowSupportedProviderIds,
} from './registry'
import { getApplicationCapability } from '../capability'
import { canEnterAutonomousApply } from '../../apply/capability'
import { startAutoApply, resetAutoApplyEngineForTests, defaultAutoApplyConfig } from '../../apply/engine'
import { clearAutoApplyMemory } from '../../apply/store'
import { claimNextBrowserJob, resetBrowserWorkerQueueForTests } from '../../browser-worker/queue'
import { JAVA_RESUME_TEXT } from '../../tailor/fixtures'
import { classifyC2c } from '../../jobs/c2c'
import { emptyLiveMatch } from '../../jobs/score'
import { detectSubmissionConfirmation } from '../../apply/confirm'
import type { AutoApplyProfile, ListedAutoApplyJob } from '../../apply/types'
import type { ServerConfig } from '../../config'
import { listLiveJobs } from '../../jobs/list'

const greenhouseForm = `
  <form id="application-form">
    <label>First Name</label><input name="first_name" autocomplete="given-name">
    <label>Email</label><input type="email" name="email" autocomplete="email">
    <label>Upload Resume</label><input type="file" name="resume">
    <button type="submit">Submit Application</button>
  </form>
`

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

function job(partial: Partial<ListedAutoApplyJob> & { id: string; url: string }): ListedAutoApplyJob {
  const description = partial.description ?? 'Java Spring Boot C2C corp to corp'
  const c2c = classifyC2c({ title: partial.title ?? 'Java Engineer', description })
  return {
    title: partial.title ?? 'Java Engineer',
    company: partial.company ?? 'Acme',
    description,
    jobUrl: partial.jobUrl ?? partial.url,
    identityKey: partial.identityKey ?? `job:${partial.id}`,
    provider: partial.provider ?? 'job-opportunities',
    providerJobId: partial.id,
    location: 'Austin, TX',
    employmentType: 'Contract',
    postedAt: '2026-09-17T00:00:00.000Z',
    fetchedAt: '2026-09-17T00:00:00.000Z',
    c2cStatus: partial.c2cStatus ?? c2c.status,
    c2cEvidence: partial.c2cEvidence ?? c2c.evidence,
    match: partial.match ?? { ...emptyLiveMatch('resume-1'), score: 90, matchedSkills: ['Java'], missingSkills: [] },
    matchScore: partial.matchScore ?? 90,
    ...partial,
  }
}

describe('application provider registry', () => {
  it('is populated with built-in adapters and does not require site configuration', () => {
    const registry = applicationProviderRegistry()
    expect(registry.length).toBeGreaterThan(0)
    expect(isApplicationProviderRegistryPopulated()).toBe(true)
    expect(workflowSupportedProviderIds()).toEqual(expect.arrayContaining(['workday', 'greenhouse', 'lever', 'ashby', 'icims']))
    for (const id of workflowSupportedProviderIds()) {
      const entry = registry.find((item) => item.id === id)
      expect(entry?.adapter).toBeTruthy()
      for (const method of REQUIRED_ADAPTER_METHODS) {
        expect(typeof (entry?.adapter as unknown as Record<string, unknown>)[method]).toBe('function')
      }
    }
  })

  it('detects supported, unsupported, and unknown providers with confidence', () => {
    const greenhouse = detectRegisteredProvider({ url: 'https://boards.greenhouse.io/acme/jobs/1' })
    expect(greenhouse.provider).toBe('greenhouse')
    expect(greenhouse.supported).toBe(true)
    expect(greenhouse.confidence).toBe('medium')
    expect(greenhouse.evidence.join(' ')).toMatch(/not company name/i)

    const smart = detectRegisteredProvider({ url: 'https://jobs.smartrecruiters.com/acme/1' })
    expect(smart.provider).toBe('smartrecruiters')
    expect(smart.supported).toBe(false)

    const workable = detectRegisteredProvider({ url: 'https://apply.workable.com/acme/j/1' })
    expect(workable.provider).toBe('workable')
    expect(workable.supported).toBe(false)

    const unknown = detectRegisteredProvider({ url: 'https://careers.unknown-corp.example/role' })
    expect(unknown.provider).toBe('unknown')
    expect(unknown.supported).toBe(false)
  })

  it('does not treat provider detection as auto_apply_supported without preflight', () => {
    const host = getApplicationCapability({ url: 'https://boards.greenhouse.io/acme/jobs/1' })
    expect(host.provider).toBe('greenhouse')
    expect(host.capability).toBe('unknown')
    expect(canEnterAutonomousApply(host.capability)).toBe(false)
    const ready = getApplicationCapability({
      url: 'https://boards.greenhouse.io/acme/jobs/1',
      html: greenhouseForm,
    })
    expect(ready.capability).toBe('auto_apply_supported')
    const unsupported = getApplicationCapability({
      url: 'https://jobs.smartrecruiters.com/acme/1',
      html: greenhouseForm,
    })
    expect(unsupported.capability).not.toBe('auto_apply_supported')
  })

  it('does not infer a provider from company name alone', () => {
    const byName = detectRegisteredProvider({
      url: 'https://careers.unknown-corp.example/role',
      html: '<h1>Greenhouse is hiring at Acme</h1><p>Workday and Lever are not this employer.</p>',
    })
    expect(byName.provider).toBe('unknown')
    expect(byName.supported).toBe(false)
  })

  it('does not treat generic as auto_apply_supported without a passing workflow preflight', () => {
    const host = getApplicationCapability({ url: 'https://careers.unknown-corp.example/apply' })
    expect(host.provider).toBe('unknown')
    expect(host.capability).not.toBe('auto_apply_supported')
    const ready = getApplicationCapability({
      url: 'https://careers.unknown-corp.example/apply',
      html: greenhouseForm,
    })
    expect(ready.provider).toBe('generic')
    if (ready.capability === 'auto_apply_supported') {
      expect(ready.applicationDetected).toBe(true)
      expect(ready.hasResumeUpload).toBe(true)
    } else {
      expect(canEnterAutonomousApply(ready.capability)).toBe(false)
    }
  })

  it('never reports auto_apply_supported for a named provider the registry does not support', () => {
    for (const url of [
      'https://jobs.smartrecruiters.com/acme/1',
      'https://apply.workable.com/acme/j/1',
      'https://acme.fa.oraclecloud.com/hcmUI/CandidateExperience',
    ]) {
      const detected = detectRegisteredProvider({ url, html: greenhouseForm })
      const capability = getApplicationCapability({ url, html: greenhouseForm })
      expect(detected.supported).toBe(false)
      expect(capability.capability).not.toBe('auto_apply_supported')
      expect(canEnterAutonomousApply(capability.capability)).toBe(false)
    }
  })

  it('does not emit a no-sites-configured failure when built-in application providers exist', async () => {
    const listed = await listLiveJobs(
      {
        ...config,
        jobOpportunitiesEnabled: true,
        leverEnabled: true,
        leverSites: [],
        ashbyEnabled: true,
        ashbyBoards: [],
        greenhouseEnabled: true,
        greenhouseBoardTokens: [],
      },
      {
        q: 'Java',
        country: 'US',
        state: '',
        remote: 'any',
        employmentType: 'any',
        seniority: '',
        page: 1,
        limit: 5,
      },
      async () =>
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    )
    expect(isApplicationProviderRegistryPopulated()).toBe(true)
    expect(listed.warning?.message ?? '').not.toMatch(/sites are configured|boards are configured|board tokens are configured/i)
  })
})

describe('auto apply queue vs provider support', () => {
  afterEach(() => {
    resetAutoApplyEngineForTests()
    clearAutoApplyMemory()
    resetBrowserWorkerQueueForTests()
  })

  it('queues a supported synthetic job and never queues an unsupported provider', async () => {
    const started = await startAutoApply(
      config,
      {
        userId: 'user-1',
        resumeId: 'resume-1',
        resumeVersionId: 'resume-1',
        resumeText: JAVA_RESUME_TEXT,
        masterResumeText: JAVA_RESUME_TEXT,
        profile,
        config: defaultAutoApplyConfig({ maxJobs: 5, minimumMatchRate: 70, autoTailorResume: false, q: 'Java', jobType: 'c2c' }),
      },
      undefined,
      {
        delayMs: 0,
        listJobs: async () => ({
          jobs: [
            job({ id: 'ready', url: 'https://jobs.example.com/ready' }),
            job({ id: 'smart', url: 'https://jobs.smartrecruiters.com/acme/1', jobUrl: 'https://jobs.smartrecruiters.com/acme/1' }),
            job({ id: 'indeed', url: 'https://www.indeed.com/viewjob?jk=1', jobUrl: 'https://www.indeed.com/viewjob?jk=1' }),
          ],
        }),
      },
    )
    expect(started.items.map((item) => item.jobId)).toEqual(['ready'])
    expect(started.items[0]?.applicationCapability).toBe('auto_apply_supported')
    expect(started.run.counts.eligible).toBe(3)
    expect(started.run.counts.autoApplyCapable).toBe(1)
    const claimed = await claimNextBrowserJob()
    expect(claimed?.item.jobId).toBe('ready')
    expect(detectSubmissionConfirmation({ html: '<p>Thank you</p>' }).confirmed).toBe(false)
    expect(
      detectSubmissionConfirmation({
        html: '<h1>Thank you for applying</h1><p>Your application was submitted. Confirmation number AA-1</p>',
        title: 'Application submitted',
        url: 'https://jobs.example.com/ready/confirmation',
      }).confirmed,
    ).toBe(true)
  })

  it('does not queue a duplicate of an already queued supported job', async () => {
    const started = await startAutoApply(
      config,
      {
        userId: 'user-1',
        resumeId: 'resume-1',
        resumeVersionId: 'resume-1',
        resumeText: JAVA_RESUME_TEXT,
        masterResumeText: JAVA_RESUME_TEXT,
        profile,
        config: defaultAutoApplyConfig({ maxJobs: 5, minimumMatchRate: 70, autoTailorResume: false, q: 'Java', jobType: 'c2c' }),
      },
      undefined,
      {
        delayMs: 0,
        listJobs: async () => ({
          jobs: [
            job({ id: 'ready', url: 'https://jobs.example.com/ready' }),
            job({ id: 'ready', url: 'https://jobs.example.com/ready', identityKey: 'job:ready' }),
          ],
        }),
      },
    )
    expect(started.items).toHaveLength(1)
    expect(started.items[0]?.jobId).toBe('ready')
  })
})
