import { agentIntervalMs } from './policy'
import { listActiveCampaigns } from './state'
import { tickCampaign } from './agent'

let timer: ReturnType<typeof setInterval> | null = null
let ticking = false
let running = false

export function resetAgentSchedulerForTests() {
  if (timer) clearInterval(timer)
  timer = null
  ticking = false
  running = false
}

export function schedulerRunning(): boolean {
  return running
}

export function startAgentScheduler(options: { intervalMs?: number } = {}) {
  if (running && timer) return
  running = true
  const intervalMs = options.intervalMs ?? agentIntervalMs()
  timer = setInterval(() => {
    void tickActiveCampaigns()
  }, intervalMs)
}

export function stopAgentScheduler() {
  if (timer) clearInterval(timer)
  timer = null
  running = false
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
