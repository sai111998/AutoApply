import { describe, expect, it } from 'vitest'
import { isAgentMessage, isWebAppMessage } from './messages'
import { applyAgentMessage, createExtensionSession, markSessionCompleted } from './session'
import { applicationDetector } from '../detection/application-detector'

const detection = applicationDetector({
  html: `
    <form>
      <label>First Name</label><input name="first_name" autocomplete="given-name">
      <label>Email</label><input type="email" name="email">
      <button>Submit Application</button>
    </form>
  `,
  url: 'https://careers.example.com/apply',
})

describe('extension message contracts', () => {
  it('accepts web app and extension messages and rejects unknown types', () => {
    expect(isWebAppMessage({ type: 'START_APPLICATION', userId: 'user-1' })).toBe(true)
    expect(isAgentMessage({ type: 'APPLICATION_DETECTED', detection })).toBe(true)
    expect(isAgentMessage({ type: 'CAPTCHA_DETECTED' })).toBe(true)
    expect(isAgentMessage({ type: 'SUBMITTED' })).toBe(false)
    expect(isAgentMessage({ type: 'AUTO_SUBMIT' })).toBe(false)
  })
})

describe('extension session lifecycle', () => {
  it('moves from idle through detection to ready without submitted', () => {
    let session = createExtensionSession({ userId: 'user-1', jobId: 'job-1', applicationId: 'app-1', resumeVersionId: 'resume-1' })
    expect(session.state).toBe('idle')
    session = applyAgentMessage(session, { type: 'START_APPLICATION', userId: 'user-1', jobId: 'job-1' })
    expect(session.state).toBe('detecting')
    session = applyAgentMessage(session, { type: 'APPLICATION_DETECTED', detection })
    expect(session.state).toBe('application_detected')
    session = applyAgentMessage(session, { type: 'PROVIDER_DETECTED', provider: 'generic' })
    expect(session.state).toBe('provider_detected')
    session = applyAgentMessage(session, { type: 'APPLICATION_READY', detection })
    expect(session.state).toBe('ready')
    expect(session.state).not.toBe('submitted' as typeof session.state)
    session = markSessionCompleted(session)
    expect(session.state).toBe('completed')
  })

  it('pauses for CAPTCHA, MFA, and login', () => {
    const session = createExtensionSession({ userId: 'user-1' })
    expect(applyAgentMessage(session, { type: 'CAPTCHA_DETECTED' }).state).toBe('captcha_required')
    expect(applyAgentMessage(session, { type: 'MFA_DETECTED' }).state).toBe('mfa_required')
    expect(applyAgentMessage(session, { type: 'LOGIN_REQUIRED' }).state).toBe('login_required')
  })

  it('records application failures', () => {
    const session = applyAgentMessage(createExtensionSession({ userId: 'user-1' }), {
      type: 'APPLICATION_FAILED',
      reason: 'The employer application form could not be found.',
    })
    expect(session.state).toBe('failed')
    expect(session.failureReason).toMatch(/form could not be found/i)
  })
})
