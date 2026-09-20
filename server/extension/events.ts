import type { AutoApplyQueueItem, AutoApplyQueueStatus } from '../apply/types'
import type { AutomationEvent } from '../../extension/src/shared/queue'
import { detectSubmissionConfirmation } from '../apply/confirm'

export const EVENT_STATUS: Record<AutomationEvent['type'], AutoApplyQueueStatus> = {
  opening: 'opening',
  application_detected: 'filling',
  provider_detected: 'filling',
  filling: 'filling',
  needs_user_input: 'needs_user_input',
  captcha_required: 'captcha_required',
  login_required: 'login_required',
  mfa_required: 'mfa_required',
  ready_for_review: 'ready_for_submission',
  submitting: 'submitting',
  submitted: 'submitted',
  failed: 'failed',
  cancelled: 'cancelled',
  needs_confirmation: 'needs_user_confirmation',
}

export function queueStatusFromEvent(event: AutomationEvent): AutoApplyQueueStatus {
  return EVENT_STATUS[event.type]
}

export function sanitizeSubmittedEvent(event: AutomationEvent, html?: string, title?: string): AutomationEvent {
  if (event.type !== 'submitted') return event
  const confirmation = html
    ? detectSubmissionConfirmation({ html, title: title ?? '', url: event.currentUrl })
    : { detected: Boolean(event.confirmationText || event.confirmationNumber), confirmationText: event.confirmationText, confirmationNumber: event.confirmationNumber }
  if (!confirmation.detected) {
    return {
      ...event,
      type: 'needs_confirmation',
      reason: 'Submission could not be confirmed on the employer site.',
    }
  }
  return event
}

export function failureReasonForStatus(status: AutoApplyQueueStatus, reason?: string | null): string | null {
  if (reason) return reason
  if (status === 'captcha_required') return 'CAPTCHA was detected. JobPilot will not bypass it.'
  if (status === 'mfa_required') return 'Multi-factor authentication was detected. JobPilot will not bypass it.'
  if (status === 'login_required') return 'The employer site requires login. JobPilot does not store employer passwords or bypass authentication.'
  if (status === 'needs_user_input') return 'This application has a question JobPilot cannot answer from your profile.'
  if (status === 'failed') return 'The employer application could not be completed automatically.'
  return null
}

const HELD_BROWSER_STATUSES = new Set<AutoApplyQueueStatus>([
  'opening',
  'filling',
  'preparing',
  'captcha_required',
  'mfa_required',
  'login_required',
  'needs_user_input',
  'ready_for_submission',
  'submitting',
])

export function claimedItemStillActive(item: AutoApplyQueueItem): boolean {
  return HELD_BROWSER_STATUSES.has(item.applicationStatus)
}
