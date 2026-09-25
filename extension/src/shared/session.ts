import type { AgentMessage } from './messages'
import type { ApplicationDetection, ExtensionSession, ExtensionSessionState } from './types'

const CHALLENGE_STATES: ExtensionSessionState[] = ['captcha_required', 'mfa_required', 'login_required']

export function createExtensionSession(input: {
  applicationSessionId?: string
  userId: string
  jobId?: string | null
  applicationId?: string | null
  resumeVersionId?: string | null
  currentUrl?: string | null
  provider?: ExtensionSession['provider']
}): ExtensionSession {
  const now = new Date().toISOString()
  return {
    applicationSessionId: input.applicationSessionId?.trim() || `ext-${now}`,
    jobId: input.jobId ?? null,
    applicationId: input.applicationId ?? null,
    resumeVersionId: input.resumeVersionId ?? null,
    userId: input.userId,
    provider: input.provider ?? 'unknown',
    currentUrl: input.currentUrl ?? null,
    state: 'idle',
    failureReason: null,
    detection: null,
    createdAt: now,
    updatedAt: now,
  }
}

export function sessionFromDetection(
  session: ExtensionSession,
  detection: ApplicationDetection,
  url?: string | null,
): ExtensionSession {
  const next: ExtensionSession = {
    ...session,
    provider: detection.provider,
    currentUrl: url ?? session.currentUrl,
    detection,
    updatedAt: new Date().toISOString(),
    failureReason: null,
  }
  if (detection.challenges.captcha) return { ...next, state: 'captcha_required' }
  if (detection.challenges.mfa) return { ...next, state: 'mfa_required' }
  if (detection.challenges.login) return { ...next, state: 'login_required' }
  if (detection.isApplicationPage) {
    return {
      ...next,
      state: detection.provider === 'unknown' ? 'application_detected' : 'ready',
    }
  }
  if (detection.isJobDetailsPage) {
    return { ...next, state: 'detecting', failureReason: 'The page is a job listing. An Apply action is required.' }
  }
  return { ...next, state: 'failed', failureReason: 'The employer application form could not be found.' }
}

export function applyAgentMessage(session: ExtensionSession, message: AgentMessage): ExtensionSession {
  const now = new Date().toISOString()
  if (message.type === 'START_APPLICATION') {
    return {
      ...session,
      jobId: message.jobId ?? session.jobId,
      applicationId: message.applicationId ?? session.applicationId,
      resumeVersionId: message.resumeVersionId ?? session.resumeVersionId,
      userId: message.userId || session.userId,
      currentUrl: message.url ?? session.currentUrl,
      state: 'detecting',
      failureReason: null,
      updatedAt: now,
    }
  }
  if (message.type === 'APPLICATION_DETECTED') {
    const detected = sessionFromDetection(session, message.detection, message.url)
    return { ...detected, state: detected.state === 'ready' ? 'application_detected' : detected.state }
  }
  if (message.type === 'PROVIDER_DETECTED') {
    const state: ExtensionSessionState =
      session.state === 'application_detected' || session.state === 'detecting' ? 'provider_detected' : session.state
    return { ...session, provider: message.provider, currentUrl: message.url ?? session.currentUrl, state, updatedAt: now }
  }
  if (message.type === 'CAPTCHA_DETECTED') {
    return { ...session, currentUrl: message.url ?? session.currentUrl, state: 'captcha_required', updatedAt: now }
  }
  if (message.type === 'MFA_DETECTED') {
    return { ...session, currentUrl: message.url ?? session.currentUrl, state: 'mfa_required', updatedAt: now }
  }
  if (message.type === 'LOGIN_REQUIRED') {
    return { ...session, currentUrl: message.url ?? session.currentUrl, state: 'login_required', updatedAt: now }
  }
  if (message.type === 'APPLICATION_READY') {
    const ready = sessionFromDetection(session, message.detection, message.url)
    if (CHALLENGE_STATES.includes(ready.state)) return ready
    return { ...ready, state: 'ready' }
  }
  if (message.type === 'APPLICATION_FAILED') {
    return {
      ...session,
      currentUrl: message.url ?? session.currentUrl,
      state: 'failed',
      failureReason: message.reason,
      updatedAt: now,
    }
  }
  return session
}

export function canMarkCompleted(session: ExtensionSession): boolean {
  return session.state === 'ready'
}

export function markSessionCompleted(session: ExtensionSession): ExtensionSession {
  if (!canMarkCompleted(session)) return session
  return { ...session, state: 'completed', updatedAt: new Date().toISOString() }
}
