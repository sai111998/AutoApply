import { describe, expect, it } from 'vitest'
import { getServerConfig } from '../config'
import { discoverJobs } from './discover'

const config = getServerConfig()
const canRun = Boolean(config.joobleApiKey || (config.usajobsApiKey && config.usajobsUserAgentEmail))

describe.skipIf(!canRun)('live job discovery providers', () => {
  it('retrieves currently posted Java Software Engineer roles in the United States', async () => {
    const result = await discoverJobs(config, {
      roles: ['Java Software Engineer'],
      location: 'United States',
      remote: 'any',
      employmentType: 'any',
      experienceLevel: 'any',
      keywords: [],
      datePostedDays: 30,
      page: 1,
      pageSize: 10,
      minMatchScore: null,
      providers: [],
      persist: false,
    })

    expect(result.demo).toBe(false)
    expect(result.jobs.length).toBeGreaterThan(0)
    expect(result.jobs.every((job) => job.title && job.jobUrl)).toBe(true)
    expect(result.jobs.some((job) => /jooble|usajobs/i.test(job.provider))).toBe(true)
    const urls = new Set(result.jobs.map((job) => job.jobUrl))
    expect(urls.size).toBe(result.jobs.length)
  }, 30_000)
})
