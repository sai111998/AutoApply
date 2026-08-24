import { HttpError } from '../types'
import { optionalText, requireNonEmptyText } from './validate'
import type { TailorMatchSignals, TailorRequestBody } from '../tailor/types'

function asStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean)
  return items.length ? items : undefined
}

function asMatchSignals(value: unknown): TailorMatchSignals | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const signals: TailorMatchSignals = {
    matched: asStringList(record.matched),
    partial: asStringList(record.partial),
    missing: asStringList(record.missing),
    strengths: asStringList(record.strengths),
    experienceThemes: asStringList(record.experienceThemes),
  }
  return Object.values(signals).some(Boolean) ? signals : undefined
}

export function parseTailorRequest(body: unknown): TailorRequestBody {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'Request body must be a JSON object')
  }
  const record = body as Record<string, unknown>
  try {
    return {
      resumeText: requireNonEmptyText(record.resumeText, 'resumeText'),
      jobDescription: requireNonEmptyText(record.jobDescription, 'jobDescription'),
      userId: optionalText(record.userId),
      resumeId: optionalText(record.resumeId),
      jobId: optionalText(record.jobId),
      matchId: optionalText(record.matchId),
      candidateName: optionalText(record.candidateName),
      candidateEmail: optionalText(record.candidateEmail),
      candidateLocation: optionalText(record.candidateLocation),
      resumeProfile: record.resumeProfile,
      jobProfile: record.jobProfile,
      matchReport: record.matchReport,
      matchSignals: asMatchSignals(record.matchSignals),
    }
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : 'Invalid request')
  }
}
