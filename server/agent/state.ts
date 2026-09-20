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

const campaigns = new Map<string, CampaignRecord>()

export function resetAgentStateForTests() {
  campaigns.clear()
}

export function getCampaign(runId: string): CampaignRecord | null {
  return campaigns.get(runId) ?? null
}

export function listCampaigns(): CampaignRecord[] {
  return [...campaigns.values()]
}

export function listActiveCampaigns(): CampaignRecord[] {
  return listCampaigns().filter((campaign) => campaign.status === 'running' || campaign.status === 'needs_attention')
}

export function saveCampaign(campaign: CampaignRecord): CampaignRecord {
  campaigns.set(campaign.runId, campaign)
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

export function patchCampaign(
  runId: string,
  patch: Partial<Pick<CampaignRecord, 'status' | 'counters' | 'lastTickAt' | 'ticks'>>,
): CampaignRecord | null {
  const current = campaigns.get(runId)
  if (!current) return null
  const next: CampaignRecord = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  }
  campaigns.set(runId, next)
  return next
}
