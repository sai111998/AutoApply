export type AgentEventType =
  | 'campaign_started'
  | 'campaign_paused'
  | 'campaign_resumed'
  | 'campaign_cancelled'
  | 'search_tick'
  | 'jobs_queued'
  | 'jobs_skipped'
  | 'needs_attention'
  | 'campaign_completed'
  | 'campaign_failed'

export interface AgentEvent {
  type: AgentEventType
  runId: string
  userId?: string
  at: string
  details?: Record<string, unknown>
}

const events: AgentEvent[] = []
const MAX_EVENTS = 200

export function resetAgentEventsForTests() {
  events.length = 0
}

export function recordAgentEvent(
  type: AgentEventType,
  runId: string,
  details: Record<string, unknown> = {},
  userId?: string,
): AgentEvent {
  const event: AgentEvent = {
    type,
    runId,
    userId,
    at: new Date().toISOString(),
    details,
  }
  events.push(event)
  if (events.length > MAX_EVENTS) events.shift()
  return event
}

export function listAgentEvents(runId?: string): AgentEvent[] {
  return runId ? events.filter((event) => event.runId === runId) : [...events]
}
