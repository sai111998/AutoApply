import { describe, expect, it } from 'vitest'
import { classifyApplicationCapability } from '../apply/capability'
import { JAVA_RESUME_TEXT } from '../tailor/fixtures'
import { listLiveJobs } from './list'
import { queryTokensMatch } from './query-expand'
import {
  createSyntheticTestJob,
  shouldIncludeSyntheticListing,
  SYNTHETIC_TEST_COMPANY,
  SYNTHETIC_TEST_TITLE,
  syntheticTestEmployerUrl,
} from './synthetic-listing'

describe('synthetic test employer listing', () => {
  it('is Auto Apply capable and matches open search filters', () => {
    const job = createSyntheticTestJob(8787)
    expect(job.title).toBe(SYNTHETIC_TEST_TITLE)
    expect(job.company).toBe(SYNTHETIC_TEST_COMPANY)
    expect(job.jobUrl).toBe(syntheticTestEmployerUrl(8787))
    expect(classifyApplicationCapability({ url: job.applicationUrl }).capability).toBe('auto_apply_supported')
    expect(queryTokensMatch(job, '')).toBe(true)
    expect(queryTokensMatch(job, 'Full Stack Java Developer')).toBe(true)
    expect(queryTokensMatch(job, 'Java Software Engineer')).toBe(true)
  })

  it('is included only when explicitly enabled', () => {
    expect(shouldIncludeSyntheticListing({ NODE_ENV: 'test' })).toBe(false)
    expect(shouldIncludeSyntheticListing({ NODE_ENV: 'production' })).toBe(false)
    expect(shouldIncludeSyntheticListing({ NODE_ENV: 'development' })).toBe(true)
    expect(shouldIncludeSyntheticListing({ JOBPILOT_INCLUDE_SYNTHETIC: '1' })).toBe(true)
    expect(shouldIncludeSyntheticListing({ NODE_ENV: 'development', JOBPILOT_INCLUDE_SYNTHETIC: '0' })).toBe(false)
  })

  it('is returned by discovery when includeSynthetic is true even if other providers are off', async () => {
    const listed = await listLiveJobs(
      {
        port: 8787,
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
        greenhouseEnabled: false,
        leverEnabled: false,
        ashbyEnabled: false,
      },
      {
        q: '',
        country: 'US',
        state: '',
        remote: 'any',
        employmentType: 'any',
        seniority: '',
        page: 1,
        limit: 25,
        resumeText: JAVA_RESUME_TEXT,
        jobType: 'all',
        includeSynthetic: true,
      },
    )
    expect(listed.jobs.some((job) => job.company === SYNTHETIC_TEST_COMPANY)).toBe(true)
    expect(listed.diagnostics?.some((item) => item.provider === 'synthetic' && item.raw === 1)).toBe(true)
    const synthetic = listed.jobs.find((job) => job.company === SYNTHETIC_TEST_COMPANY)
    expect((synthetic?.matchScore ?? 0) >= 70).toBe(true)
  })
})
