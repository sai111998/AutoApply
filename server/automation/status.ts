import { getAutomationHealth, publicAutomationHealth } from '../apply/health'
import { memoryStore } from '../apply/store'
import { agentIntervalMs } from '../agent/policy'
import { listActiveCampaigns } from '../agent/state'
import { schedulerRunning } from '../agent/scheduler'
import { getBrowserWorker } from '../browser-worker/worker'
import { readAutomationHeartbeats } from './heartbeat'

export interface AutomationHealthPayload {
  agentRunning?: boolean
  workerRunning?: boolean
  browserAvailable?: boolean
  queueDepth?: number
  lastAgentHeartbeat?: string | null
  lastWorkerHeartbeat?: string | null
  agent: {
    running: boolean
    lastHeartbeat: string | null
    lastDiscoveryAt: string | null
    nextDiscoveryAt: string | null
    currentCampaignId: string | null
  }
  worker: {
    running: boolean
    lastHeartbeat: string | null
  }
  browser: {
    available: boolean
  }
  queue: {
    queued: number
    processing: number
  }
  available: boolean
  playwright: boolean
  runtime: string
  reason?: string
}

export async function buildAutomationHealthPayload(options: {
  probe?: boolean
} = {}): Promise<AutomationHealthPayload> {
  const browserHealth = publicAutomationHealth(await getAutomationHealth({ probe: options.probe !== false }))
  const beats = readAutomationHeartbeats()
  const campaigns = listActiveCampaigns()
  const current = campaigns[0] ?? null
  const intervalMs = agentIntervalMs()
  const lastDiscoveryAt =
    beats.agent.lastDiscoveryAt ??
    (current?.lastTickAt ? new Date(current.lastTickAt).toISOString() : null)
  const nextDiscoveryAt =
    beats.agent.nextDiscoveryAt ??
    (current?.lastTickAt ? new Date(current.lastTickAt + intervalMs).toISOString() : null)
  const runs = memoryStore.listAll ? await memoryStore.listAll() : []
  const items = runs.flatMap((entry) => entry.items)
  const processing = new Set(['opening', 'filling', 'preparing', 'tailoring', 'submitting'])
  const workerRunning = Boolean(getBrowserWorker()?.running()) || beats.worker.running
  const agentRunning = schedulerRunning() || beats.agent.running
  const queueQueued = items.filter((item) => item.applicationStatus === 'queued' || item.applicationStatus === 'ready').length
  const queueProcessing = items.filter((item) => processing.has(item.applicationStatus)).length
  return {
    agentRunning,
    workerRunning,
    browserAvailable: Boolean(browserHealth.available && browserHealth.browser === 'chromium'),
    queueDepth: queueQueued + queueProcessing,
    lastAgentHeartbeat: beats.agent.lastHeartbeat,
    lastWorkerHeartbeat: beats.worker.lastHeartbeat,
    agent: {
      running: agentRunning,
      lastHeartbeat: beats.agent.lastHeartbeat,
      lastDiscoveryAt,
      nextDiscoveryAt,
      currentCampaignId: beats.agent.currentCampaignId ?? current?.runId ?? null,
    },
    worker: {
      running: workerRunning,
      lastHeartbeat: beats.worker.lastHeartbeat,
    },
    browser: {
      available: Boolean(browserHealth.available && browserHealth.browser === 'chromium'),
    },
    queue: {
      queued: queueQueued,
      processing: queueProcessing,
    },
    available: browserHealth.available,
    playwright: browserHealth.playwright,
    runtime: browserHealth.runtime,
    ...(browserHealth.reason ? { reason: browserHealth.reason } : {}),
  }
}
