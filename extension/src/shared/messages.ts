import type { ApplicationDetection, ExtensionProviderId, ExtensionSession } from './types'

export const WEB_APP_MESSAGE_TYPES = ['START_APPLICATION', 'CONNECT_SESSION'] as const
export const EXTENSION_MESSAGE_TYPES = [
  'APPLICATION_DETECTED',
  'PROVIDER_DETECTED',
  'CAPTCHA_DETECTED',
  'MFA_DETECTED',
  'LOGIN_REQUIRED',
  'APPLICATION_READY',
  'APPLICATION_FAILED',
  'INSPECT_PAGE',
  'PAGE_INSPECTION',
] as const

export type WebAppMessageType = (typeof WEB_APP_MESSAGE_TYPES)[number]
export type ExtensionMessageType = (typeof EXTENSION_MESSAGE_TYPES)[number]
export type AgentMessageType = WebAppMessageType | ExtensionMessageType

export interface StartApplicationMessage {
  type: 'START_APPLICATION'
  applicationSessionId?: string
  jobId?: string | null
  applicationId?: string | null
  resumeVersionId?: string | null
  userId: string
  url?: string | null
}

export interface ConnectSessionMessage {
  type: 'CONNECT_SESSION'
  userId: string
  backendOrigin?: string
}

export interface ApplicationDetectedMessage {
  type: 'APPLICATION_DETECTED'
  applicationSessionId?: string
  detection: ApplicationDetection
  url?: string | null
}

export interface ProviderDetectedMessage {
  type: 'PROVIDER_DETECTED'
  applicationSessionId?: string
  provider: ExtensionProviderId
  url?: string | null
}

export interface ChallengeMessage {
  type: 'CAPTCHA_DETECTED' | 'MFA_DETECTED' | 'LOGIN_REQUIRED'
  applicationSessionId?: string
  url?: string | null
}

export interface ApplicationReadyMessage {
  type: 'APPLICATION_READY'
  applicationSessionId?: string
  detection: ApplicationDetection
  url?: string | null
}

export interface ApplicationFailedMessage {
  type: 'APPLICATION_FAILED'
  applicationSessionId?: string
  reason: string
  url?: string | null
}

export interface InspectPageMessage {
  type: 'INSPECT_PAGE'
}

export interface PageInspectionMessage {
  type: 'PAGE_INSPECTION'
  url: string
  title: string
  hostname?: string
  pageKind?: string | null
  detection: ApplicationDetection
  session: ExtensionSession | null
}

export type AgentMessage =
  | StartApplicationMessage
  | ConnectSessionMessage
  | ApplicationDetectedMessage
  | ProviderDetectedMessage
  | ChallengeMessage
  | ApplicationReadyMessage
  | ApplicationFailedMessage
  | InspectPageMessage
  | PageInspectionMessage

export function isAgentMessage(value: unknown): value is AgentMessage {
  if (!value || typeof value !== 'object') return false
  const type = (value as { type?: unknown }).type
  return (
    typeof type === 'string' &&
    ((WEB_APP_MESSAGE_TYPES as readonly string[]).includes(type) ||
      (EXTENSION_MESSAGE_TYPES as readonly string[]).includes(type))
  )
}

export function isWebAppMessage(value: unknown): value is StartApplicationMessage | ConnectSessionMessage {
  return isAgentMessage(value) && (WEB_APP_MESSAGE_TYPES as readonly string[]).includes(value.type)
}
