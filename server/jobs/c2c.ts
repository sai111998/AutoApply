export type C2cStatus = 'confirmed' | 'not_allowed' | 'unknown'
export type C2cConfidence = 'high' | 'medium' | 'low'
export type C2cSourceField = 'title' | 'description' | 'employmentType' | 'company'

export interface C2cEvidence {
  matchedPhrase: string
  sourceField: C2cSourceField
  confidence: C2cConfidence
  detectedAt: string
}

export interface C2cClassification {
  status: C2cStatus
  evidence: C2cEvidence[]
}

export type JobTypeFilter = 'all' | 'c2c' | 'contract' | 'w2'

const POSITIVE_PHRASES: Array<{ phrase: string; confidence: C2cConfidence }> = [
  { phrase: 'corporation to corporation', confidence: 'high' },
  { phrase: 'corp to corporation', confidence: 'high' },
  { phrase: 'corporation to corp', confidence: 'high' },
  { phrase: 'corp to corp', confidence: 'high' },
  { phrase: 'c2c', confidence: 'high' },
]

const NEGATIVE_PHRASES: Array<{ phrase: string; confidence: C2cConfidence }> = [
  { phrase: 'we do not accept c2c', confidence: 'high' },
  { phrase: 'cannot accept c2c', confidence: 'high' },
  { phrase: 'cannot do c2c', confidence: 'high' },
  { phrase: 'not open to c2c', confidence: 'high' },
  { phrase: 'no corp to corp vendors', confidence: 'high' },
  { phrase: 'no third party vendors', confidence: 'high' },
  { phrase: 'no third party', confidence: 'high' },
  { phrase: 'no corp to corp', confidence: 'high' },
  { phrase: 'not c2c', confidence: 'high' },
  { phrase: 'no c2c', confidence: 'high' },
  { phrase: 'w2 only', confidence: 'high' },
  { phrase: 'w 2 only', confidence: 'high' },
]

const W2_PHRASES = ['w2 only', 'w 2 only', 'on w2', 'on w 2', 'w2 employees', 'w 2 employees']

export function normalizeC2cText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[–—−]/g, '-')
    .replace(/c-2-c/g, 'c2c')
    .replace(/w-2/g, 'w2')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function padded(text: string): string {
  return ` ${text} `
}

function findPhrases(
  haystack: string,
  phrases: Array<{ phrase: string; confidence: C2cConfidence }>,
  sourceField: C2cSourceField,
  detectedAt: string,
): Array<C2cEvidence & { start: number; end: number }> {
  const paddedHaystack = padded(haystack)
  const found: Array<C2cEvidence & { start: number; end: number }> = []
  for (const item of phrases) {
    const needle = ` ${normalizeC2cText(item.phrase)} `
    let from = 0
    while (from < paddedHaystack.length) {
      const index = paddedHaystack.indexOf(needle, from)
      if (index === -1) break
      found.push({
        matchedPhrase: item.phrase,
        sourceField,
        confidence: item.confidence,
        detectedAt,
        start: index,
        end: index + needle.length,
      })
      from = index + needle.length
    }
  }
  return found
}

function overlaps(
  left: { start: number; end: number },
  right: { start: number; end: number },
): boolean {
  return left.start < right.end && right.start < left.end
}

export function classifyC2c(input: {
  title?: string | null
  description?: string | null
  employmentType?: string | null
  company?: string | null
  now?: string
}): C2cClassification {
  const detectedAt = input.now ?? new Date().toISOString()
  const fields: Array<[C2cSourceField, string]> = [
    ['title', input.title ?? ''],
    ['description', input.description ?? ''],
    ['employmentType', input.employmentType ?? ''],
    ['company', input.company ?? ''],
  ]

  const evidence: C2cEvidence[] = []
  let positives = 0
  let negatives = 0

  for (const [sourceField, raw] of fields) {
    const normalized = normalizeC2cText(raw)
    if (!normalized) continue
    const negativeHits = findPhrases(normalized, NEGATIVE_PHRASES, sourceField, detectedAt)
    const positiveHits = findPhrases(normalized, POSITIVE_PHRASES, sourceField, detectedAt)
    const remainingPositives = positiveHits.filter(
      (positive) => !negativeHits.some((negative) => overlaps(positive, negative)),
    )
    negatives += negativeHits.length
    positives += remainingPositives.length
    evidence.push(
      ...negativeHits.map(({ start: _start, end: _end, ...item }) => item),
      ...remainingPositives.map(({ start: _start, end: _end, ...item }) => item),
    )
  }

  if (negatives > 0) {
    return { status: 'not_allowed', evidence }
  }
  if (positives > 0) {
    return { status: 'confirmed', evidence }
  }
  return { status: 'unknown', evidence }
}

export function hasW2Evidence(input: {
  title?: string | null
  description?: string | null
  employmentType?: string | null
}): boolean {
  const text = normalizeC2cText(`${input.title ?? ''} ${input.description ?? ''} ${input.employmentType ?? ''}`)
  const paddedText = padded(text)
  return W2_PHRASES.some((phrase) => paddedText.includes(` ${phrase} `)) || /\bw2\b/.test(text)
}

export function matchesJobTypeFilter(
  job: {
    title?: string | null
    description?: string | null
    employmentType?: string | null
  },
  classification: C2cClassification,
  jobType: JobTypeFilter = 'all',
): boolean {
  if (jobType === 'all') return true
  if (jobType === 'c2c') return classification.status === 'confirmed'
  if (jobType === 'contract') {
    const employment = (job.employmentType ?? '').toLowerCase()
    const text = `${job.title ?? ''} ${job.description ?? ''} ${employment}`
    return /\bcontract\b/i.test(text)
  }
  return hasW2Evidence(job) && classification.status !== 'confirmed'
}
