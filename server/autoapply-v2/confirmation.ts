import type { V2Confirmation } from './types'

const STRONG_CONFIRMATION =
  /application\s+(has\s+been\s+)?(submitted|received|successfully\s+submitted)|successfully\s+(submitted|applied)|you\s+have\s+(successfully\s+)?applied|application\s+confirmation|thank\s+you\s+for\s+applying/i

const APPLIED_CONTEXT = /appl|submit|received|confirm|thank/i

const CONFIRMATION_NUMBER =
  /(confirmation|application|reference|requisition|submission)\s*(number|no\.?|id|code)?\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{3,40})/gi

const CONFIRMATION_NUMBER_TEST =
  /(confirmation|application|reference|requisition|submission)\s*(number|no\.?|id|code)?\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{3,40})/i

function extractV2ConfirmationNumber(haystack: string): string | null {
  CONFIRMATION_NUMBER.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = CONFIRMATION_NUMBER.exec(haystack)) !== null) {
    const candidate = match[3]?.trim() ?? ''
    if (/\d/.test(candidate)) return candidate
  }
  return null
}

export interface V2ConfirmationInput {
  title: string
  bodyText: string
  url: string
}

export function detectV2Confirmation(input: V2ConfirmationInput): V2Confirmation {
  const haystack = `${input.title}\n${input.bodyText}`.slice(0, 20000)
  const evidence: string[] = []
  const confirmationNumber = extractV2ConfirmationNumber(haystack)
  const strong = STRONG_CONFIRMATION.test(haystack)
  const numberWithContext = Boolean(confirmationNumber) && APPLIED_CONTEXT.test(haystack)
  const confirmed = strong || numberWithContext
  if (strong) evidence.push('strong confirmation phrase')
  if (confirmationNumber) evidence.push(`confirmation number ${confirmationNumber}`)
  if (!confirmed) {
    return {
      attempted: false,
      confirmed: false,
      confirmationNumber,
      confirmationText: null,
      finalUrl: input.url,
      evidence,
    }
  }
  const confirmationText = extractV2EvidenceLine(haystack)
  return {
    attempted: true,
    confirmed: true,
    confirmationNumber,
    confirmationText,
    finalUrl: input.url,
    evidence,
  }
}

function extractV2EvidenceLine(haystack: string): string | null {
  const line = haystack
    .split('\n')
    .map((entry) => entry.replace(/\s+/g, ' ').trim())
    .find(
      (entry) => entry.length > 0 && (STRONG_CONFIRMATION.test(entry) || CONFIRMATION_NUMBER_TEST.test(entry)),
    )
  return line?.slice(0, 280) ?? null
}
