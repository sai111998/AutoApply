export const AGENT_ERROR_CODES = [
  'CAMPAIGN_NOT_FOUND',
  'CAMPAIGN_PAUSED',
  'CAMPAIGN_STOPPED',
  'SEARCH_RATE_LIMITED',
  'AGENT_TIMEOUT',
  'BROWSER_UNAVAILABLE',
  'WORKER_UNAVAILABLE',
  'INVALID_URL',
  'MISSING_RESUME',
  'MISSING_PROFILE_FIELD',
  'UNKNOWN_REQUIRED_QUESTION',
  'NAVIGATION_TIMEOUT',
  'FORM_NOT_FOUND',
  'SUBMIT_NOT_FOUND',
  'CONFIRMATION_MISSING',
] as const

export type AgentErrorCode = (typeof AGENT_ERROR_CODES)[number]

export class AgentError extends Error {
  code: AgentErrorCode

  constructor(code: AgentErrorCode, message: string) {
    super(message)
    this.name = 'AgentError'
    this.code = code
  }
}

export function isAgentError(error: unknown): error is AgentError {
  return error instanceof AgentError
}
