import { afterEach, describe, expect, it } from 'vitest'
import { resetAgentForTests } from '../agent'
import { startAgentScheduler, stopAgentScheduler, schedulerRunning } from '../agent/scheduler'
import {
  HEARTBEAT_STALE_MS,
  readAutomationHeartbeats,
  resetAutomationHeartbeatsForTests,
  startWorkerHeartbeatLoop,
  stopWorkerHeartbeatLoop,
  touchAgentHeartbeat,
  touchWorkerHeartbeat,
} from './heartbeat'
import { buildAutomationHealthPayload } from './status'

afterEach(() => {
  resetAgentForTests()
  resetAutomationHeartbeatsForTests()
})

describe('automation heartbeats', () => {
  it('starts the agent scheduler and records a heartbeat', () => {
    expect(schedulerRunning()).toBe(false)
    startAgentScheduler({ intervalMs: 30_000 })
    expect(schedulerRunning()).toBe(true)
    const beats = readAutomationHeartbeats()
    expect(beats.agent.running).toBe(true)
    expect(beats.agent.lastHeartbeat).toBeTruthy()
    stopAgentScheduler()
    expect(schedulerRunning()).toBe(false)
  })

  it('keeps the worker heartbeat fresh while the process loop is running', async () => {
    startWorkerHeartbeatLoop(40)
    const first = Date.parse(readAutomationHeartbeats().worker.lastHeartbeat ?? '')
    expect(readAutomationHeartbeats().worker.running).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 180))
    const second = readAutomationHeartbeats().worker
    expect(second.running).toBe(true)
    expect(Date.parse(second.lastHeartbeat ?? '')).toBeGreaterThan(first)
    stopWorkerHeartbeatLoop()
    expect(readAutomationHeartbeats().worker.running).toBe(false)
  })

  it('treats a stale heartbeat as not running', () => {
    touchAgentHeartbeat({}, Date.now() - HEARTBEAT_STALE_MS - 1_000)
    touchWorkerHeartbeat(Date.now() - HEARTBEAT_STALE_MS - 1_000)
    const beats = readAutomationHeartbeats()
    expect(beats.agent.running).toBe(false)
    expect(beats.worker.running).toBe(false)
  })

  it('builds a health payload without secrets or filesystem paths', async () => {
    const payload = await buildAutomationHealthPayload({ probe: false })
    expect(payload.agent).toMatchObject({ running: expect.any(Boolean) })
    expect(payload.worker).toMatchObject({ running: expect.any(Boolean) })
    expect(payload.browser).toEqual({ available: expect.any(Boolean) })
    expect(payload.queue).toEqual({ queued: expect.any(Number), processing: expect.any(Number) })
    expect(JSON.stringify(payload)).not.toMatch(/\/home\/|\/tmp\/|SECRET|bearer|service.role/i)
  })
})
