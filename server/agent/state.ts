import { readRuntimeJson, writeRuntimeJson } from '../automation/runtime-io'
import type { AutoApplyStartInput } from '../apply/types'
import type { AutoApplyEngineDeps } from '../apply/engine'
import type { ServerConfig } from '../config'
import type { FetchLike } from '../jobs/http'
import { emptyCounts } from '../apply/counts'
import type { AutoApplyCounts, AutoApplyRunStatus } from '../apply/types'

export type CampaignStatus = Extract<
  AutoApplyRunStatus,
  'stopped' | 'running' | 'paused' | 'needs_attention' | 'completed' | 'failed' | 'cancelled'
>

export interface CampaignRecord {
  runId: string
  userId: string
  status: CampaignStatus
  input: AutoApplyStartInput
  serverConfig: ServerConfig
  fetchImpl?: FetchLike
  deps: AutoApplyEngineDeps
  createdAt: string
  updatedAt: string
  lastTickAt: number | null
  ticks: number
  counters: AutoApplyCounts
}

const CAMPAIGN_FILE = 'campaigns.json'
const campaigns = new Map<string, CampaignRecord>()

function reloadCampaigns() {
  const parsed = readRuntimeJson<Array<Omit<CampaignRecord, 'fetchImpl' | 'deps'>>>(CAMPAIGN_FILE)
  if (!parsed) return
  for (const entry of parsed) {
    if (!entry?.runId) continue
    const current = campaigns.get(entry.runId)
    if (!current || Date.parse(entry.updatedAt) >= Date.parse(current.updatedAt)) {
      campaigns.set(entry.runId, { ...entry, deps: current?.deps ?? {}, fetchImpl: current?.fetchImpl })
    }
  }
}

function flushCampaigns() {
  const serializable = [...campaigns.values()].map(({ fetchImpl: _fetch, deps: _deps, ...rest }) => rest)
  writeRuntimeJson(CAMPAIGN_FILE, serializable)
}

export function resetAgentStateForTests() {
  campaigns.clear()
  executions.clear()
}

export function getCampaign(runId: string): CampaignRecord | null {
  reloadCampaigns()
  return campaigns.get(runId) ?? null
}

export function listCampaigns(): CampaignRecord[] {
  reloadCampaigns()
  return [...campaigns.values()]
}

export function listActiveCampaigns(): CampaignRecord[] {
  return listCampaigns().filter((campaign) => campaign.status === 'running' || campaign.status === 'needs_attention')
}

export function saveCampaign(campaign: CampaignRecord): CampaignRecord {
  reloadCampaigns()
  campaigns.set(campaign.runId, campaign)
  flushCampaigns()
  return campaign
}

export function createCampaignRecord(input: {
  runId: string
  userId: string
  status: CampaignStatus
  startInput: AutoApplyStartInput
  serverConfig: ServerConfig
  fetchImpl?: FetchLike
  deps?: AutoApplyEngineDeps
  counters?: AutoApplyCounts
}): CampaignRecord {
  const now = new Date().toISOString()
  const campaign: CampaignRecord = {
    runId: input.runId,
    userId: input.userId,
    status: input.status,
    input: input.startInput,
    serverConfig: input.serverConfig,
    fetchImpl: input.fetchImpl,
    deps: input.deps ?? {},
    createdAt: now,
    updatedAt: now,
    lastTickAt: null,
    ticks: 0,
    counters: input.counters ?? emptyCounts(),
  }
  return saveCampaign(campaign)
}

export const EXECUTION_STATES = [
  'queued',
  'opening',
  'job_page',
  'application_page',
  'filling',
  'uploading_resume',
  'next_step',
  'review',
  'submitting',
  'submitted',
  'failed',
  'needs_user_input',
  'submission_uncertain',
  'submission_failed',
  'captcha_required',
  'login_required',
  'mfa_required',
] as const

export type ExecutionState = (typeof EXECUTION_STATES)[number]

export interface ExecutionRecord {
  applicationId: string
  state: ExecutionState
  reason: string | null
  updatedAt: string
}

const EXECUTION_FILE = 'execution-state.json'
const executions = new Map<string, ExecutionRecord>()

function reloadExecutions() {
  const parsed = readRuntimeJson<ExecutionRecord[]>(EXECUTION_FILE)
  if (!parsed) return
  for (const entry of parsed) {
    if (entry?.applicationId) executions.set(entry.applicationId, entry)
  }
}

function flushExecutions() {
  writeRuntimeJson(EXECUTION_FILE, [...executions.values()])
}

export function persistExecutionState(
  applicationId: string,
  state: ExecutionState,
  reason: string | null = null,
): ExecutionRecord {
  reloadExecutions()
  const record: ExecutionRecord = {
    applicationId,
    state,
    reason,
    updatedAt: new Date().toISOString(),
  }
  executions.set(applicationId, record)
  flushExecutions()
  return record
}

export function getExecutionState(applicationId: string): ExecutionRecord | null {
  reloadExecutions()
  return executions.get(applicationId) ?? null
}

export function resetExecutionStateForTests() {
  executions.clear()
}

export function patchCampaign(
  runId: string,
  patch: Partial<Pick<CampaignRecord, 'status' | 'counters' | 'lastTickAt' | 'ticks'>>,
): CampaignRecord | null {
  reloadCampaigns()
  const current = campaigns.get(runId)
  if (!current) return null
  const next: CampaignRecord = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  }
  campaigns.set(runId, next)
  flushCampaigns()
  return next
}
