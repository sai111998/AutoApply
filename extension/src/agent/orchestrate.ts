import type { ApplicationDetection } from '../shared/types'
import type { AgentProfileValues } from '../shared/queue'

export type AgentAction =
  | { type: 'pause'; status: 'captcha_required' | 'mfa_required' | 'login_required' | 'needs_user_input'; questions?: string[] }
  | { type: 'click_apply' }
  | { type: 'fill_and_advance' }
  | { type: 'ready_for_review' }
  | { type: 'fail'; code: 'APPLICATION_PAGE_NOT_FOUND' | 'APPLICATION_URL_INVALID'; reason: string }

export function extractQuestionPrompts(html: string): string[] {
  const labels = [...html.matchAll(/<label[^>]*>([\s\S]*?)<\/label>/gi)].map((match) =>
    match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
  )
  return labels.filter((item) => item.length > 3 && /\?|authorized|sponsor|experience|onsite|rate|availability/i.test(item))
}

export function unknownQuestionPrompts(html: string, mapped: Array<keyof AgentProfileValues | string>): string[] {
  const known = new Set(mapped.map((item) => String(item).toLowerCase()))
  return extractQuestionPrompts(html).filter((prompt) => {
    const text = prompt.toLowerCase()
    if (/authoriz|sponsor|years of experience|linkedin|github|email|first name|last name|phone/.test(text)) return false
    if (/when can you start|availability|start date/.test(text)) return true
    return !known.has(text)
  })
}

export function nextAgentAction(
  detection: ApplicationDetection,
  html = '',
): AgentAction {
  if (detection.challenges.captcha) return { type: 'pause', status: 'captcha_required' }
  if (detection.challenges.mfa) return { type: 'pause', status: 'mfa_required' }
  if (detection.challenges.login) return { type: 'pause', status: 'login_required' }
  const unknown = unknownQuestionPrompts(html, [])
  if (unknown.length && detection.isApplicationPage) {
    return { type: 'pause', status: 'needs_user_input', questions: unknown }
  }
  if (detection.isJobDetailsPage && detection.applyActions.length) return { type: 'click_apply' }
  if (detection.isApplicationPage) {
    const hasNext = detection.buttons.some((button) => button.kind === 'next' || button.kind === 'continue')
    if (hasNext && !detection.buttons.some((button) => button.kind === 'submit' && /review/i.test(detection.signals.join(' ')))) {
      return { type: 'fill_and_advance' }
    }
    if (hasNext) return { type: 'fill_and_advance' }
    return { type: 'ready_for_review' }
  }
  return {
    type: 'fail',
    code: 'APPLICATION_PAGE_NOT_FOUND',
    reason: 'The employer application form could not be found.',
  }
}

export function confirmationDetected(html: string, title = ''): { detected: boolean; text?: string; number?: string } {
  const haystack = `${title} ${html}`
  if (/application (has been )?(submitted|received)|thank you for applying|your application was submitted/i.test(haystack)) {
    const number = haystack.match(/(?:confirmation|application)\s*(?:#|number|id)[:\s-]*([A-Z0-9-]{5,})/i)?.[1]
    const text = /thank you for applying|application (has been )?(submitted|received)/i.exec(haystack)?.[0]
    return { detected: true, text: text ?? 'Application submitted', number }
  }
  return { detected: false }
}
