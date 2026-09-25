import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { useAutomationRuntimeForTests } from '../automation/runtime-io'
import { emptyCounts } from './counts'
import {
  clearAutoApplyMemory,
  dropAutoApplyMemoryCache,
  memoryStore,
} from './store'
import type { AutoApplyQueueItem, AutoApplyRun } from './types'

let tempDir = ''

function run(id: string, updatedAt: string): AutoApplyRun {
  return {
    id,
    userId: 'user-1',
    status: 'running',
    config: {
      maxJobs: 1,
      minimumMatchRate: 70,
      autoTailorResume: false,
      jobType: 'all',
      remotePreference: 'any',
      employmentType: 'any',
      keywords: [],
      jobTitles: [],
      excludedCompanies: [],
      q: '',
      country: 'US',
      state: '',
      location: '',
      concurrency: 1,
    },
    counts: emptyCounts(),
    createdAt: '2026-09-25T00:00:00.000Z',
    updatedAt,
  }
}

function item(status: AutoApplyQueueItem['applicationStatus'], updatedAt: string): AutoApplyQueueItem {
  return {
    id: 'item-1',
    runId: 'run-1',
    jobId: 'job-1',
    identityKey: 'synthetic:test-employer',
    applicationId: 'app-1',
    resumeVersionId: 'resume-1',
    resumeVersionName: 'Master',
    sourceResumeId: 'resume-1',
    title: 'Full Stack Java Developer',
    company: 'Test Employer',
    applicationUrl: 'http://127.0.0.1:8787/test-employer',
    initialMatchScore: 88,
    finalMatchScore: 88,
    c2cStatus: 'unknown',
    c2cEvidence: [],
    applicationStatus: status,
    failureReason: null,
    questions: [],
    tailoredResumeText: 'Java engineer',
    jobDescriptionSnapshot: 'Java Spring Boot',
    location: 'Austin, TX',
    confirmationNumber: null,
    confirmationText: null,
    submittedAt: null,
    masterResumeUnchanged: true,
    sessionId: null,
    createdAt: '2026-09-25T00:00:00.000Z',
    updatedAt,
    applicationCapability: 'auto_apply_supported',
  }
}

afterEach(() => {
  clearAutoApplyMemory()
  useAutomationRuntimeForTests(null)
  if (tempDir) rmSync(tempDir, { recursive: true, force: true })
  tempDir = ''
})

describe('shared auto-apply store', () => {
  it('reloads queue items written by another process', async () => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'jobpilot-store-'))
    useAutomationRuntimeForTests(tempDir)
    await memoryStore.save(run('run-1', '2026-09-25T00:00:01.000Z'), [item('queued', '2026-09-25T00:00:01.000Z')])
    dropAutoApplyMemoryCache()
    const loaded = await memoryStore.listAll?.()
    expect(loaded).toHaveLength(1)
    expect(loaded?.[0]?.items[0]?.applicationStatus).toBe('queued')
  })

  it('keeps a newer worker lock when an older snapshot is saved', async () => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'jobpilot-store-'))
    useAutomationRuntimeForTests(tempDir)
    await memoryStore.save(run('run-1', '2026-09-25T00:00:02.000Z'), [item('opening', '2026-09-25T00:00:02.000Z')])
    await memoryStore.save(run('run-1', '2026-09-25T00:00:01.000Z'), [item('queued', '2026-09-25T00:00:01.000Z')])
    const current = await memoryStore.get('run-1')
    expect(current?.items[0]?.applicationStatus).toBe('opening')
  })
})
