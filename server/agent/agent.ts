import {
  cancelRun,
  getAutoApplyRun,
  refreshAutoApplyRun,
  startAutoApply,
  type AutoApplyEngineDeps,
} from '../apply/engine'
import { ApplyError } from '../apply/errors'
import { memoryStore } from '../apply/store'
import type { AutoApplyStartInput } from '../apply/types'
import type { ServerConfig } from '../config'
import type { FetchLike } from '../jobs/http'
import { AgentError } from './errors'
import { recordAgentEvent } from './events'
import { persistCampaignQueue, wakeApplicationWorker, isProcessableCampaign } from './queue'
import {
  createCampaignRecord,
  getCampaign,
  listCampaigns,
  patchCampaign,
  type CampaignRecord,
} from './state'

export interface StartCampaignOptions {
  fetchImpl?: FetchLike
  deps?: AutoApplyEngineDeps
  schedule?: boolean
  intervalMs?: number
}

export async function startCampaign(
  serverConfig: ServerConfig,
  input: AutoApplyStartInput,
  options: StartCampaignOptions = {},
) {
  const started = await startAutoApply(serverConfig, input, options.fetchImpl, options.deps)
  const campaign = createCampaignRecord({
    runId: started.run.id,
    userId: input.userId,
    status: started.run.status === 'completed' ? 'completed' : 'running',
    startInput: input,
    serverConfig,
    fetchImpl: options.fetchImpl,
    deps: options.deps,
    counters: started.run.counts,
  })
  recordAgentEvent('campaign_started', campaign.runId, { queued: started.items.length }, input.userId)
  if (started.items.length) wakeApplicationWorker()
  if (options.schedule === true || (options.schedule !== false && process.env.VITEST !== 'true')) {
    const { startAgentScheduler } = await import('./scheduler')
    startAgentScheduler({ intervalMs: options.intervalMs })
  }
  return { ...started, campaign }
}

export async function tickCampaign(runId: string, now = Date.now()) {
  const campaign = getCampaign(runId)
  if (!campaign) throw new AgentError('CAMPAIGN_NOT_FOUND', 'Auto Apply campaign was not found.')
  if (!isProcessableCampaign(campaign.status) && campaign.status !== 'completed' && campaign.status !== 'failed') {
    if (campaign.status === 'paused') throw new AgentError('CAMPAIGN_PAUSED', 'This Auto Apply campaign is paused.')
    throw new AgentError('CAMPAIGN_STOPPED', 'This Auto Apply campaign is stopped.')
  }
  if (campaign.status === 'completed' || campaign.status === 'failed') {
    const current = await getAutoApplyRun(runId)
    return current ? { run: current.run, items: current.items, added: 0 } : null
  }
  recordAgentEvent('search_tick', runId, { tick: campaign.ticks + 1 }, campaign.userId)
  const refreshed = await refreshAutoApplyRun(runId, campaign.serverConfig, campaign.input, campaign.fetchImpl, campaign.deps)
  if (!refreshed) throw new AgentError('CAMPAIGN_NOT_FOUND', 'Auto Apply campaign was not found.')
  patchCampaign(runId, {
    status: refreshed.run.status,
    counters: refreshed.run.counts,
    lastTickAt: now,
    ticks: campaign.ticks + 1,
  })
  if (refreshed.added > 0) {
    recordAgentEvent('jobs_queued', runId, { added: refreshed.added }, campaign.userId)
    wakeApplicationWorker()
  }
  return refreshed
}

export async function pauseCampaign(runId: string) {
  const current = await getAutoApplyRun(runId)
  if (!current) throw new ApplyError(404, 'APPLICATION_NOT_FOUND')
  current.run.status = 'paused'
  await persistCampaignQueue(current)
  patchCampaign(runId, { status: 'paused' })
  recordAgentEvent('campaign_paused', runId, {}, current.run.userId)
  return current
}

export async function resumeCampaign(runId: string) {
  const current = await getAutoApplyRun(runId)
  if (!current) throw new ApplyError(404, 'APPLICATION_NOT_FOUND')
  current.run.status = 'running'
  await persistCampaignQueue(current)
  patchCampaign(runId, { status: 'running' })
  wakeApplicationWorker()
  recordAgentEvent('campaign_resumed', runId, {}, current.run.userId)
  return current
}

export async function cancelCampaign(runId: string) {
  const cancelled = await cancelRun(runId)
  patchCampaign(runId, { status: 'cancelled' })
  recordAgentEvent('campaign_cancelled', runId, {}, cancelled.run.userId)
  return cancelled
}

export async function resumeIntervention(itemId: string) {
  const { resolveUserIntervention } = await import('../browser-worker/intervention')
  const intervention = resolveUserIntervention(itemId)
  const runs = memoryStore.listAll ? await memoryStore.listAll() : []
  for (const stored of runs) {
    const item = stored.items.find((entry) => entry.id === itemId)
    if (!item) continue
    if (['captcha_required', 'mfa_required', 'login_required', 'needs_user_input'].includes(item.applicationStatus)) {
      item.applicationStatus = 'queued'
      item.failureReason = null
    }
    stored.run.status = stored.run.status === 'paused' ? 'paused' : 'running'
    await persistCampaignQueue(stored)
    wakeApplicationWorker()
    return { stored, item, intervention }
  }
  wakeApplicationWorker()
  return { stored: null, item: null, intervention }
}

export function getCampaignRecord(runId: string): CampaignRecord | null {
  return getCampaign(runId)
}

export function listAgentCampaigns(): CampaignRecord[] {
  return listCampaigns()
}
