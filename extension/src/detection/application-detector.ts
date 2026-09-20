import { detectApplicationProvider } from '../providers'
import type { ApplicationDetection, ExtensionProviderId, PageSnapshot } from '../shared/types'
import { detectChallenges } from './challenges'
import { detectApplyActions, detectButtons, detectFields, pageVisibleText } from './fields'

const APPLICATION_SCORE_THRESHOLD = 3

function looksLikeJobDetails(html: string, text: string, fieldCount: number, applyActions: string[]): boolean {
  const jobCopy = /job description|job identification|job requisition|posting date|view more jobs|job category|time left to apply/i.test(
    `${html} ${text}`,
  )
  return applyActions.length > 0 && fieldCount < APPLICATION_SCORE_THRESHOLD && jobCopy
}

export function applicationDetector(input: PageSnapshot | { html: string; url?: string; title?: string }): ApplicationDetection {
  const html = input.html ?? ''
  const url = 'url' in input ? input.url ?? '' : ''
  const text = pageVisibleText(html)
  const fields = detectFields(html)
  const buttons = detectButtons(html)
  const applyActions = detectApplyActions(html, text)
  const challenges = detectChallenges(html)
  const named = detectApplicationProvider({ url, html })
  const signals: string[] = []
  let score = 0

  for (const field of fields) {
    const weight = field.id === 'email' || field.id === 'resume' || field.id === 'firstName' ? 2 : 1
    score += weight
    signals.push(`field:${field.id}`)
  }
  if (/<form\b/i.test(html)) {
    score += 1
    signals.push('form')
  }
  if (buttons.some((button) => button.kind === 'next' || button.kind === 'submit' || button.kind === 'continue')) {
    score += 1
    signals.push('next_or_submit')
  }
  if (/job application form|application form|candidate experience/i.test(`${html} ${text}`)) {
    score += 1
    signals.push('application_copy')
  }
  if (applyActions.length) signals.push('apply_action')
  if (challenges.captcha) signals.push('captcha')
  if (challenges.mfa) signals.push('mfa')
  if (challenges.login) signals.push('login')

  const isApplicationPage = score >= APPLICATION_SCORE_THRESHOLD
  const isJobDetailsPage = !isApplicationPage && looksLikeJobDetails(html, text, fields.length, applyActions)
  let provider: ExtensionProviderId = named.id
  if (!named.known) provider = isApplicationPage ? 'generic' : 'unknown'

  return {
    isApplicationPage,
    isJobDetailsPage,
    confidence: Math.min(1, score / 8),
    signals,
    provider,
    fields,
    buttons,
    challenges,
    applyActions,
  }
}

export function inspectPageSnapshot(snapshot: PageSnapshot): ApplicationDetection {
  return applicationDetector(snapshot)
}
