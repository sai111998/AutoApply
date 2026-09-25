import { startAgentScheduler, schedulerRunning } from './scheduler'
import { listActiveCampaigns } from './state'
import { agentIntervalMs } from './policy'
import { markAgentStopped, touchAgentHeartbeat } from '../automation/heartbeat'

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

export function startStandaloneAgentProcess() {
  startAgentScheduler()
  beat()
  const timer = setInterval(beat, 2_000)
  const stop = () => {
    clearInterval(timer)
    markAgentStopped()
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  console.log('JobPilot Auto Apply agent is running. Scheduler interval:', agentIntervalMs(), 'ms')
  return { running: () => schedulerRunning(), stop }
}

async function main() {
  startStandaloneAgentProcess()
}

if (process.argv[1] && process.argv[1].includes('agent/process')) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
