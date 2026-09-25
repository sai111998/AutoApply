import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
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
let hydrated = false

function campaignFile(): string {
  const directory = process.env.JOBPILOT_RUNTIME_DIR?.trim()
    ? path.resolve(process.env.JOBPILOT_RUNTIME_DIR)
    : path.join(os.tmpdir(), 'jobpilot-automation')
  return path.join(directory, 'campaigns.json')
}

function persistCampaignsEnabled(): boolean {
  return process.env.VITEST !== 'true'
}

function hydrateCampaigns() {
  if (hydrated || !persistCampaignsEnabled()) {
    hydrated = true
    return
  }
  hydrated = true
  try {
    const file = campaignFile()
    if (!existsSync(file)) return
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Array<Omit<CampaignRecord, 'fetchImpl' | 'deps'>>
    for (const entry of parsed) {
      campaigns.set(entry.runId, { ...entry, deps: {}, fetchImpl: undefined })
    }
  } catch {
    // Keep empty campaign state if the runtime file cannot be read.
  }
}

function flushCampaigns() {
  if (!persistCampaignsEnabled()) return
  const directory = path.dirname(campaignFile())
  mkdirSync(directory, { recursive: true })
  const file = campaignFile()
  const tmp = `${file}.${process.pid}.tmp`
  const serializable = [...campaigns.values()].map(({ fetchImpl: _fetch, deps: _deps, ...rest }) => rest)
  writeFileSync(tmp, JSON.stringify(serializable))
  renameSync(tmp, file)
}

export function resetAgentStateForTests() {
  campaigns.clear()
  hydrated = true
}

export function getCampaign(runId: string): CampaignRecord | null {
  hydrateCampaigns()
  return campaigns.get(runId) ?? null
}

export function listCampaigns(): CampaignRecord[] {
  hydrateCampaigns()
  return [...campaigns.values()]
}

export function listActiveCampaigns(): CampaignRecord[] {
  return listCampaigns().filter((campaign) => campaign.status === 'running' || campaign.status === 'needs_attention')
}

export function saveCampaign(campaign: CampaignRecord): CampaignRecord {
  hydrateCampaigns()
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

export function patchCampaign(
  runId: string,
  patch: Partial<Pick<CampaignRecord, 'status' | 'counters' | 'lastTickAt' | 'ticks'>>,
): CampaignRecord | null {
  hydrateCampaigns()
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
