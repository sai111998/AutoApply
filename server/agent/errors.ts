export const AGENT_ERROR_CODES = [
  'CAMPAIGN_NOT_FOUND',
  'CAMPAIGN_PAUSED',
  'CAMPAIGN_STOPPED',
  'SEARCH_RATE_LIMITED',
  'AGENT_TIMEOUT',
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
