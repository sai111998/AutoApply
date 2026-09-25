import type { AgentProfileValues } from '../shared/queue'

const FIELD_SELECTORS: Array<[keyof AgentProfileValues, string[]]> = [
  ['email', ['input[type="email"]', 'input[name="email"]', 'input[autocomplete="email"]', 'input[id*="email" i]']],
  ['firstName', ['input[name="first_name"]', 'input[name="firstName"]', 'input[autocomplete="given-name"]', 'input[id="first-name"]']],
  ['lastName', ['input[name="last_name"]', 'input[name="lastName"]', 'input[autocomplete="family-name"]', 'input[id="last-name"]']],
  ['phone', ['input[type="tel"]', 'input[name="phone"]', 'input[autocomplete="tel"]']],
  ['address', ['input[autocomplete="street-address"]', 'input[name="address"]']],
  ['city', ['input[name="city"]', 'input[autocomplete="address-level2"]']],
  ['state', ['input[name="state"]', 'input[autocomplete="address-level1"]']],
  ['zip', ['input[name="zip"]', 'input[autocomplete="postal-code"]']],
  ['linkedin', ['input[name="linkedin"]', 'input[id="linkedin"]']],
  ['github', ['input[name="github"]']],
  ['workAuthorization', ['select[name="work_authorization"]', 'select[id="work-auth"]', 'input[name="work_authorization"]']],
  ['sponsorship', ['select[name="sponsorship"]', 'input[name="sponsorship"]']],
  ['yearsExperience', ['input[name="years_experience"]', 'input[name="experience"]']],
]

export function fillSelectorsFor(values: Partial<AgentProfileValues>): Array<{ selector: string; value: string }> {
  const plan: Array<{ selector: string; value: string }> = []
  for (const [field, selectors] of FIELD_SELECTORS) {
    const value = values[field]?.trim()
    if (!value) continue
    for (const selector of selectors) plan.push({ selector, value })
  }
  return plan
}

export function isLegitimateApplyText(label: string): boolean {
  const text = label.replace(/\s+/g, ' ').trim()
  if (!text || /linkedin|indeed|easy apply|glassdoor|sign in|log in/i.test(text)) return false
  return /^(apply now|apply to (this )?job|start (your )?application|begin application|apply manually|apply)$/i.test(text)
}

export function isLegitimateNextText(label: string): boolean {
  const text = label.replace(/\s+/g, ' ').trim()
  if (!text || /submit/i.test(text)) return false
  return /^(next|continue|save and continue)$/i.test(text)
}

export function isFinalSubmitText(label: string): boolean {
  const text = label.replace(/\s+/g, ' ').trim()
  return /^(submit( my)? application|send application|submit)$/i.test(text)
}
