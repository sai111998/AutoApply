import type { DetectedButton, DetectedField, DetectedFieldId } from '../shared/types'

const CONTROL = '<(input|textarea|select)[^>]*'

const FIELD_PATTERNS: Array<[DetectedFieldId, string, RegExp]> = [
  ['email', 'Email', new RegExp(`${CONTROL}(type=['"]email['"]|autocomplete=['"]email['"]|name=['"][^'"]*email|id=['"][^'"]*email|aria-label=['"][^'"]*email|placeholder=['"][^'"]*email)|<label[^>]*>\\s*email`, 'i')],
  ['firstName', 'First Name', new RegExp(`${CONTROL}(name=['"][^'"]*(first[-_]?name|given)|autocomplete=['"]given-name['"]|aria-label=['"][^'"]*first name|placeholder=['"][^'"]*first name)|<label[^>]*>\\s*first name`, 'i')],
  ['lastName', 'Last Name', new RegExp(`${CONTROL}(name=['"][^'"]*(last[-_]?name|family|surname)|autocomplete=['"]family-name['"]|aria-label=['"][^'"]*last name|placeholder=['"][^'"]*last name)|<label[^>]*>\\s*last name`, 'i')],
  ['phone', 'Phone', new RegExp(`${CONTROL}(type=['"]tel['"]|autocomplete=['"]tel['"]|name=['"][^'"]*(phone|mobile)|aria-label=['"][^'"]*phone|placeholder=['"][^'"]*phone)|<label[^>]*>\\s*(phone|mobile)`, 'i')],
  ['address', 'Address', new RegExp(`${CONTROL}(autocomplete=['"]street-address['"]|name=['"][^'"]*address|aria-label=['"][^'"]*address)|<label[^>]*>\\s*address`, 'i')],
  ['linkedin', 'LinkedIn', new RegExp(`${CONTROL}(name|id|aria-label|placeholder)=['"][^'"]*linkedin|<label[^>]*>\\s*linkedin`, 'i')],
  ['github', 'GitHub', new RegExp(`${CONTROL}(name|id|aria-label|placeholder)=['"][^'"]*github|<label[^>]*>\\s*github`, 'i')],
  ['resume', 'Resume', /type=['"]file['"]|<label[^>]*>\s*(upload )?(your )?(resume|cv)|aria-label=['"][^'"]*(resume|cv|upload resume)/i],
  ['coverLetter', 'Cover Letter', new RegExp(`${CONTROL}(name|id|aria-label|placeholder)=['"][^'"]*cover|label[^>]*>\\s*cover[-_ ]letter`, 'i')],
  ['workAuthorization', 'Work Authorization', /<label[^>]*>[\s\S]*?(work authorization|authorized to work|legally authorized)|name=['"][^'"]*(work[-_]?auth|authorization|sponsorship)/i],
]

const BUTTON_PATTERNS: Array<[DetectedButton['kind'], RegExp]> = [
  ['apply', /^\s*(apply now|apply to (this )?job|start (your )?application|begin application|apply manually|apply)\s*$/i],
  ['next', /^\s*(next|save and continue)\s*$/i],
  ['continue', /^\s*continue\s*$/i],
  ['submit', /^\s*(submit application|send application|submit)\s*$/i],
]

function decode(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
}

export function pageVisibleText(html: string): string {
  return decode(html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function detectFields(html: string): DetectedField[] {
  return FIELD_PATTERNS.filter(([, , pattern]) => pattern.test(html)).map(([id, label]) => ({ id, label }))
}

function buttonLabels(html: string): string[] {
  const fromControls = [...html.matchAll(/<(button|a)[^>]*>([\s\S]*?)<\/(button|a)>/gi)].map((match) =>
    match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
  )
  const fromAria = [...html.matchAll(/aria-label=['"]([^'"]+)['"]/gi)].map((match) => match[1].trim())
  const fromValue = [...html.matchAll(/<(input)[^>]*(type=['"](submit|button)['"])[^>]*value=['"]([^'"]+)['"]/gi)].map(
    (match) => match[4].trim(),
  )
  return [...fromControls, ...fromAria, ...fromValue].filter(Boolean)
}

export function detectButtons(html: string): DetectedButton[] {
  const seen = new Set<string>()
  const buttons: DetectedButton[] = []
  for (const label of buttonLabels(html)) {
    for (const [kind, pattern] of BUTTON_PATTERNS) {
      if (!pattern.test(label)) continue
      const key = `${kind}:${label}`
      if (seen.has(key)) continue
      seen.add(key)
      buttons.push({ kind, label })
    }
  }
  return buttons
}

export function detectApplyActions(html: string, text = pageVisibleText(html)): string[] {
  const labels = detectButtons(html)
    .filter((button) => button.kind === 'apply')
    .map((button) => button.label)
  if (labels.length) return [...new Set(labels)]
  const copy = [...text.matchAll(/\b(apply now|apply to (this )?job|start (your )?application|begin application|apply manually)\b/gi)].map(
    (match) => match[0],
  )
  return [...new Set(copy)]
}
