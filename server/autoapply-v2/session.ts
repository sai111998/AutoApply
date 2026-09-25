import { readRuntimeJson, writeRuntimeJson } from '../automation/runtime-io'
import type { V2Session } from './types'

const V2_SESSION_FILE = 'autoapply-v2-sessions.json'

const sessions = new Map<string, V2Session>()

function reloadSessions() {
  const parsed = readRuntimeJson<V2Session[]>(V2_SESSION_FILE)
  if (!parsed) return
  for (const entry of parsed) {
    if (entry?.runId) sessions.set(entry.runId, entry)
  }
}

function flushSessions() {
  writeRuntimeJson(V2_SESSION_FILE, [...sessions.values()].slice(-50))
}

export function resetV2SessionsForTests() {
  sessions.clear()
}

export function createV2Session(input: {
  runId: string
  jobId: string
  userId: string
  resumeVersionId: string
}): V2Session {
  reloadSessions()
  const session: V2Session = {
    runId: input.runId,
    jobId: input.jobId,
    userId: input.userId,
    resumeVersionId: input.resumeVersionId,
    currentUrl: null,
    provider: null,
    state: 'queued',
    step: 0,
    updatedAt: new Date().toISOString(),
  }
  sessions.set(session.runId, session)
  flushSessions()
  return session
}

export function updateV2Session(
  runId: string,
  patch: Partial<Pick<V2Session, 'currentUrl' | 'provider' | 'state' | 'step'>>,
): V2Session | null {
  reloadSessions()
  const current = sessions.get(runId)
  if (!current) return null
  const next: V2Session = { ...current, ...patch, updatedAt: new Date().toISOString() }
  sessions.set(runId, next)
  flushSessions()
  return next
}

export function getV2Session(runId: string): V2Session | null {
  reloadSessions()
  return sessions.get(runId) ?? null
}
