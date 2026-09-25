import { agentIntervalMs } from './policy'
import { listActiveCampaigns } from './state'
import { tickCampaign } from './agent'
import { markAgentStopped, touchAgentHeartbeat } from '../automation/heartbeat'

let timer: ReturnType<typeof setInterval> | null = null
let ticking = false
let running = false
let heartbeatTimer: ReturnType<typeof setInterval> | null = null

function beat() {
  const campaigns = listActiveCampaigns()
  const current = campaigns[0] ?? null
  const intervalMs = agentIntervalMs()
  touchAgentHeartbeat({
    currentCampaignId: current?.runId ?? null,
    lastDiscoveryAt: current?.lastTickAt ? new Date(current.lastTickAt).toISOString() : null,
    nextDiscoveryAt: current?.lastTickAt ? new Date(current.lastTickAt + intervalMs).toISOString() : null,
  })
}

export function resetAgentSchedulerForTests() {
  if (timer) clearInterval(timer)
  if (heartbeatTimer) clearInterval(heartbeatTimer)
  timer = null
  heartbeatTimer = null
  ticking = false
  running = false
}

export function schedulerRunning(): boolean {
  return running
}

export function startAgentScheduler(options: { intervalMs?: number } = {}) {
  if (running && timer) {
    beat()
    return
  }
  running = true
  const intervalMs = options.intervalMs ?? agentIntervalMs()
  timer = setInterval(() => {
    void tickActiveCampaigns()
  }, intervalMs)
  if (!heartbeatTimer) heartbeatTimer = setInterval(beat, 2_000)
  beat()
}

export function stopAgentScheduler() {
  if (timer) clearInterval(timer)
  if (heartbeatTimer) clearInterval(heartbeatTimer)
  timer = null
  heartbeatTimer = null
  running = false
  markAgentStopped()
}

export async function tickActiveCampaigns() {
  if (ticking) return
  ticking = true
  try {
    for (const campaign of listActiveCampaigns()) {
      await tickCampaign(campaign.runId)
    }
  } finally {
    ticking = false
  }
}
