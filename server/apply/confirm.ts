import { inspectApplicationPage } from './detect'
import type { AutoApplyQueueStatus } from './types'

export interface ExternalSubmissionResult {
  success: boolean
  confirmationDetected: boolean
  confirmationNumber?: string
  resultingUrl?: string
  pageTitle?: string
  confirmationText?: string
  finalActionCompleted: boolean
  reason?: string
}

export interface BrowserSubmitContext {
  jobId?: string | null
  applicationId?: string | null
  identityKey?: string | null
  applicationUrl?: string | null
}

const CONFIRMATION_PHRASES = [
  /application (has been )?submitted/i,
  /application (has been )?received/i,
  /thank you for applying/i,
  /thanks for applying/i,
  /your application was submitted/i,
  /we (have )?received your application/i,
  /successfully submitted your application/i,
  /application confirmation/i,
  /you have successfully applied/i,
]

const WEAK_TEXT = /^(thank you!?|thanks!?|next|continue|review|your information has been saved\.?)$/i

const CONFIRMATION_NUMBER_RE =
  /(?:confirmation|application|reference|req(?:uisition)?)\s*(?:#|number|id|no\.?)[:\s-]*([A-Z0-9][A-Z0-9-]{4,})/i

const FINAL_SUBMIT_LABEL =
  /^(submit( my)? application|send application|complete application|submit)$/i

const REJECT_SUBMIT_LABEL = /^(next|continue|review|save|save and continue|back|cancel)$/i

export function visiblePageText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function isWeakConfirmationText(text: string): boolean {
  return WEAK_TEXT.test(text.trim())
}

export function isFinalSubmitLabel(text: string): boolean {
  const value = text.replace(/\s+/g, ' ').trim()
  if (!value || REJECT_SUBMIT_LABEL.test(value)) return false
  return FINAL_SUBMIT_LABEL.test(value)
}

export function extractConfirmationNumber(text: string): string | undefined {
  const match = text.match(CONFIRMATION_NUMBER_RE)
  return match?.[1]
}

export function detectSubmissionConfirmation(input: {
  html: string
  url?: string | null
  title?: string | null
}): { detected: boolean; confirmationNumber?: string; confirmationText?: string } {
  const text = visiblePageText(input.html)
  const title = (input.title ?? '').trim()
  const haystack = `${title} ${text}`
  if (isWeakConfirmationText(text) || isWeakConfirmationText(title)) {
    return { detected: false }
  }
  const phrase = CONFIRMATION_PHRASES.find((pattern) => pattern.test(haystack))
  const confirmationNumber = extractConfirmationNumber(haystack)
  if (!phrase && !confirmationNumber) {
    return { detected: false }
  }
  const confirmationText = phrase
    ? haystack.match(phrase)?.[0]
    : confirmationNumber
      ? `Confirmation ${confirmationNumber}`
      : undefined
  return {
    detected: true,
    confirmationNumber,
    confirmationText,
  }
}

export function submissionStatusFromResult(
  result: ExternalSubmissionResult,
  blocked?: Extract<
    AutoApplyQueueStatus,
    'captcha_required' | 'mfa_required' | 'login_required' | 'blocked' | 'automation_blocked' | 'needs_user_input' | 'failed'
  > | null,
): AutoApplyQueueStatus {
  if (blocked) return blocked
  if (result.success && result.confirmationDetected && result.finalActionCompleted) return 'submitted'
  if (result.finalActionCompleted && !result.confirmationDetected) return 'needs_user_confirmation'
  if (result.reason?.toLowerCase().includes('could not')) return 'failed'
  return 'needs_user_confirmation'
}

export function inspectPostSubmitPage(html: string): {
  status: Extract<
    AutoApplyQueueStatus,
    'captcha_required' | 'mfa_required' | 'login_required' | 'blocked' | 'automation_blocked'
  >
  failureReason: string | null
} | null {
  const inspection = inspectApplicationPage(html)
  if (
    inspection.status === 'captcha_required' ||
    inspection.status === 'mfa_required' ||
    inspection.status === 'login_required' ||
    inspection.status === 'blocked' ||
    inspection.status === 'automation_blocked'
  ) {
    return { status: inspection.status, failureReason: inspection.failureReason }
  }
  return null
}

export function safeEmployerHost(url: string | null | undefined): string | null {
  try {
    return url ? new URL(url).hostname : null
  } catch {
    return null
  }
}

export function isDevAutoApplyLog(): boolean {
  return process.env.NODE_ENV !== 'production'
}

export function logExternalSubmit(message: string) {
  if (!isDevAutoApplyLog()) return
  console.info(`[AutoApply] ${message}`)
}
