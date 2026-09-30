import { emptyNormalizedJob } from './normalize'
import type { NormalizedJob } from './types'

export const SYNTHETIC_TEST_JOB_ID = 'synthetic-test-employer'
export const SYNTHETIC_TEST_COMPANY = 'Test Employer'
export const SYNTHETIC_TEST_TITLE = 'Full Stack Java Developer'

export function shouldIncludeSyntheticListing(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.JOBPILOT_INCLUDE_SYNTHETIC?.trim().toLowerCase()
  if (raw === '0' || raw === 'false' || raw === 'off') return false
  if (raw === '1' || raw === 'true' || raw === 'on') return true
  return env.NODE_ENV === 'development'
}

export function syntheticTestEmployerUrl(port = 8787): string {
  return `http://127.0.0.1:${port}/test-employer`
}

export function createSyntheticTestJob(port = 8787): NormalizedJob {
  const url = syntheticTestEmployerUrl(port)
  return emptyNormalizedJob({
    id: SYNTHETIC_TEST_JOB_ID,
    provider: 'synthetic',
    discoveryProvider: 'synthetic',
    providerJobId: SYNTHETIC_TEST_JOB_ID,
    title: SYNTHETIC_TEST_TITLE,
    company: SYNTHETIC_TEST_COMPANY,
    location: 'Austin, TX',
    remote: false,
    workArrangement: 'hybrid',
    employmentType: 'Full-time',
    seniority: 'Mid',
    description:
      'Full Stack Java Developer role for the local Test Employer. Java, Spring Boot, React, PostgreSQL, REST APIs, and software engineering. This is a controlled JobPilot application page used to prove the Auto Apply pipeline.',
    jobUrl: url,
    applicationUrl: url,
    sourceUrl: url,
    source: 'synthetic',
    applicationCapability: 'auto_apply_supported',
    rawMetadata: { synthetic: true, testEmployer: true },
  })
}
