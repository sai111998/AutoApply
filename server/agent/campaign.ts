import { randomUUID } from 'node:crypto'
import { cancelRun, defaultAutoApplyConfig } from '../apply/engine'
import { emptyCounts, recount, syncRunStatus } from '../apply/counts'
import { memoryStore, persistRun } from '../apply/store'
import { saveCandidateProfile } from '../application/candidate-store'
import { hydrateCandidateStoreFromSupabase } from '../application/candidate-profile'
import { rememberAutoApplyProfile, rememberQueueResume } from '../extension/profile-store'
import { touchAgentHeartbeat } from '../automation/heartbeat'
import type { AutoApplyQueueItem, AutoApplyRun, AutoApplyStartInput } from '../apply/types'
import type { ServerConfig } from '../config'
import { evaluateSyntheticJobEligibility } from './eligibility'
import { persistCampaignQueue, wakeApplicationWorker } from './queue'
import { createCampaignRecord, getCampaign, listActiveCampaigns, patchCampaign, persistExecutionState } from './state'
import { AgentError } from './errors'
import { isAutoApplySmokeTestEnabled, startSmokeTestCampaign } from './smoke-test'

export {
  startCampaign,
  tickCampaign,
  pauseCampaign,
  resumeCampaign,
  cancelCampaign,
  resumeIntervention,
  getCampaignRecord,
  listAgentCampaigns,
} from './agent'

export const SYNTHETIC_SLICE_JOB_ID = 'synthetic-job-1'
export const SYNTHETIC_SLICE_TITLE = 'Senior Java Full Stack Developer'
export const SYNTHETIC_SLICE_COMPANY = 'Test Employer'
export const SYNTHETIC_SLICE_CONFIRMATION = 'TEST-12345'

export function syntheticSliceJobUrl(port = 8787) {
  return `http://127.0.0.1:${port}/test-employer/job/1`
}

export function logExecution(event: string) {
  console.info(`[AutoApply] ${event}`)
}

function isLocalTestEmployerUrl(url: string | null | undefined): boolean {
  try {
    const parsed = new URL(url ?? '')
    const loopback = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname.toLowerCase())
    return loopback && (parsed.pathname.startsWith('/test-employer') || parsed.pathname.startsWith('/browser-worker/synthetic'))
  } catch {
    return false
  }
}

export function isLegacySyntheticRun(stored: { items: AutoApplyQueueItem[] }): boolean {
  return stored.items.some(
    (item) =>
      item.identityKey?.startsWith('synthetic:') ||
      item.discoverySource === 'synthetic' ||
      item.applicationSource === 'synthetic' ||
      isLocalTestEmployerUrl(item.applicationUrl),
  )
}

export async function retireLegacySyntheticRuns(serverConfig?: ServerConfig): Promise<number> {
  const runs = memoryStore.listAll ? await memoryStore.listAll() : []
  let retired = 0
  for (const stored of runs) {
    if (!['running', 'needs_attention', 'paused'].includes(stored.run.status)) continue
    if (!isLegacySyntheticRun(stored)) continue
    await cancelRun(stored.run.id, {}, serverConfig)
    patchCampaign(stored.run.id, { status: 'cancelled' })
    retired += 1
  }
  for (const campaign of listActiveCampaigns()) {
    const stored = await memoryStore.get(campaign.runId)
    if (!stored || stored.run.status === 'cancelled') patchCampaign(campaign.runId, { status: 'cancelled' })
  }
  return retired
}

function createQueuedItem(run: AutoApplyRun, input: AutoApplyStartInput, port: number): AutoApplyQueueItem {
  const now = new Date().toISOString()
  const url = syntheticSliceJobUrl(port)
  return {
    id: randomUUID(),
    runId: run.id,
    jobId: SYNTHETIC_SLICE_JOB_ID,
    identityKey: 'synthetic:senior java full stack developer',
    applicationId: randomUUID(),
    resumeVersionId: input.resumeVersionId,
    resumeVersionName: 'Master',
    sourceResumeId: input.resumeId,
    title: SYNTHETIC_SLICE_TITLE,
    company: SYNTHETIC_SLICE_COMPANY,
    applicationUrl: url,
    initialMatchScore: 100,
    finalMatchScore: 100,
    c2cStatus: 'unknown',
    c2cEvidence: [],
    applicationStatus: 'queued',
    failureReason: null,
    questions: [],
    tailoredResumeText: input.resumeText ?? input.masterResumeText,
    jobDescriptionSnapshot:
      'Senior Java Full Stack Developer role for the local Test Employer. Java, Spring Boot, React, and software engineering.',
    location: 'Austin, TX',
    confirmationNumber: null,
    confirmationText: null,
    submittedAt: null,
    masterResumeUnchanged: true,
    sessionId: null,
    createdAt: now,
    updatedAt: now,
    applicationCapability: 'auto_apply_supported',
    discoverySource: 'synthetic',
    applicationSource: 'synthetic',
    applicationProvider: 'synthetic',
    initialUrl: url,
    redirectUrls: [],
    finalApplicationUrl: url,
  }
}

export async function startSyntheticSliceCampaign(serverConfig: ServerConfig, input: AutoApplyStartInput) {
  if (isAutoApplySmokeTestEnabled()) {
    return startSmokeTestCampaign(serverConfig, input)
  }
  const createdAt = new Date().toISOString()
  const run: AutoApplyRun = {
    id: randomUUID(),
    userId: input.userId,
    status: 'running',
    config: {
      ...defaultAutoApplyConfig(input.config),
      maxJobs: 1,
      minimumMatchRate: input.config.minimumMatchRate || 70,
      autoTailorResume: false,
      jobType: 'all',
      remotePreference: 'any',
      keywords: [],
      concurrency: 1,
      includeSynthetic: true,
    },
    counts: emptyCounts(),
    createdAt,
    updatedAt: createdAt,
  }
  await persistRun(memoryStore, run, [], serverConfig)
  createCampaignRecord({
    runId: run.id,
    userId: input.userId,
    status: 'running',
    startInput: { ...input, config: run.config },
    serverConfig,
    counters: run.counts,
  })
  saveCandidateProfile({
    userId: input.userId,
    profile: input.profile,
    resumeText: input.resumeText ?? input.masterResumeText,
    resumeVersionId: input.resumeVersionId,
  })
  await hydrateCandidateStoreFromSupabase(input.userId, serverConfig)
  rememberAutoApplyProfile(input.userId, input.profile)
  touchAgentHeartbeat({ currentCampaignId: run.id, lastDiscoveryAt: createdAt })
  logExecution('AGENT_STARTED')
  void processExecutionCampaign(run.id).catch((error) => {
    console.error('[AutoApply] EXECUTION_FAILED', error instanceof Error ? error.message : error)
  })
  return { campaignId: run.id, status: 'running' as const, run, items: [] as AutoApplyQueueItem[] }
}

export async function processExecutionCampaign(runId: string) {
  const stored = await memoryStore.get(runId)
  if (!stored) throw new AgentError('CAMPAIGN_NOT_FOUND', 'Auto Apply campaign was not found.')
  const campaign = getCampaign(runId)
  const resolvedPort = campaign?.serverConfig.port || Number(process.env.API_PORT) || 8787
  logExecution('JOB_SELECTED')
  const evaluated = evaluateSyntheticJobEligibility({
    job: {
      title: SYNTHETIC_SLICE_TITLE,
      company: SYNTHETIC_SLICE_COMPANY,
      matchScore: 100,
      c2cStatus: 'unknown',
    },
    minimumMatchRate: stored.run.config.minimumMatchRate,
    c2cOnly: false,
    jobType: stored.run.config.jobType,
  })
  if (!evaluated.ok) {
    stored.run.status = 'completed'
    stored.run.counts.found = 1
    stored.run.counts.eligible = 0
    await persistCampaignQueue(stored)
    return stored
  }
  logExecution('JOB_ELIGIBLE')
  if (!campaign) throw new AgentError('CAMPAIGN_NOT_FOUND', 'Auto Apply campaign was not found.')
  const item = createQueuedItem(stored.run, campaign.input, resolvedPort)
  stored.items.push(item)
  stored.run.counts = {
    ...recount(stored.items),
    found: 1,
    eligible: 1,
    autoApplyCapable: 1,
    queued: 1,
  }
  syncRunStatus(stored.run, stored.items)
  rememberQueueResume(stored.run.userId, item)
  persistExecutionState(item.id, 'queued')
  await persistCampaignQueue(stored)
  logExecution('APPLICATION_QUEUED')
  wakeApplicationWorker()
  return stored
}
