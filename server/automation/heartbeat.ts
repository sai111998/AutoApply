import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const STALE_MS = 15_000

export interface ProcessHeartbeat {
  running: boolean
  lastHeartbeat: string | null
}

export interface AgentHeartbeat extends ProcessHeartbeat {
  lastDiscoveryAt: string | null
  nextDiscoveryAt: string | null
  currentCampaignId: string | null
}

export interface AutomationHeartbeatState {
  agent: AgentHeartbeat
  worker: ProcessHeartbeat
}

function emptyAgent(): AgentHeartbeat {
  return {
    running: false,
    lastHeartbeat: null,
    lastDiscoveryAt: null,
    nextDiscoveryAt: null,
    currentCampaignId: null,
  }
}

function emptyWorker(): ProcessHeartbeat {
  return { running: false, lastHeartbeat: null }
}

function emptyState(): AutomationHeartbeatState {
  return { agent: emptyAgent(), worker: emptyWorker() }
}

let memory = emptyState()

function runtimeDir(): string {
  const configured = process.env.JOBPILOT_RUNTIME_DIR?.trim()
  if (configured) return path.resolve(configured)
  return path.join(os.tmpdir(), 'jobpilot-automation')
}

function heartbeatPath(): string {
  return path.join(runtimeDir(), 'heartbeat.json')
}

function useFiles(): boolean {
  return process.env.VITEST !== 'true'
}

function readDisk(): AutomationHeartbeatState {
  if (!useFiles()) return memory
  try {
    const file = heartbeatPath()
    if (!existsSync(file)) return emptyState()
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<AutomationHeartbeatState>
    return {
      agent: { ...emptyAgent(), ...parsed.agent },
      worker: { ...emptyWorker(), ...parsed.worker },
    }
  } catch {
    return emptyState()
  }
}

function writeDisk(state: AutomationHeartbeatState) {
  memory = state
  if (!useFiles()) return
  const directory = runtimeDir()
  mkdirSync(directory, { recursive: true })
  const file = heartbeatPath()
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(state))
  renameSync(tmp, file)
}

function fresh(iso: string | null | undefined, now: number): boolean {
  if (!iso) return false
  const at = Date.parse(iso)
  return Number.isFinite(at) && now - at <= STALE_MS
}

export function resetAutomationHeartbeatsForTests() {
  memory = emptyState()
}

export function touchAgentHeartbeat(
  extras: Partial<Pick<AgentHeartbeat, 'lastDiscoveryAt' | 'nextDiscoveryAt' | 'currentCampaignId'>> = {},
  now = Date.now(),
): AgentHeartbeat {
  const current = readDisk()
  const next: AutomationHeartbeatState = {
    ...current,
    agent: {
      running: true,
      lastHeartbeat: new Date(now).toISOString(),
      lastDiscoveryAt: extras.lastDiscoveryAt ?? current.agent.lastDiscoveryAt,
      nextDiscoveryAt: extras.nextDiscoveryAt ?? current.agent.nextDiscoveryAt,
      currentCampaignId: extras.currentCampaignId ?? current.agent.currentCampaignId,
    },
  }
  writeDisk(next)
  return next.agent
}

export function touchWorkerHeartbeat(now = Date.now()): ProcessHeartbeat {
  const current = readDisk()
  const next: AutomationHeartbeatState = {
    ...current,
    worker: { running: true, lastHeartbeat: new Date(now).toISOString() },
  }
  writeDisk(next)
  return next.worker
}

export function markAgentStopped() {
  const current = readDisk()
  writeDisk({
    ...current,
    agent: { ...current.agent, running: false },
  })
}

export function markWorkerStopped() {
  const current = readDisk()
  writeDisk({
    ...current,
    worker: { running: false, lastHeartbeat: current.worker.lastHeartbeat },
  })
}

export function readAutomationHeartbeats(now = Date.now()): AutomationHeartbeatState {
  const state = readDisk()
  return {
    agent: {
      ...state.agent,
      running: Boolean(state.agent.running) && fresh(state.agent.lastHeartbeat, now),
    },
    worker: {
      ...state.worker,
      running: Boolean(state.worker.running) && fresh(state.worker.lastHeartbeat, now),
    },
  }
}

export { STALE_MS as HEARTBEAT_STALE_MS }
