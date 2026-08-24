import { describe, expect, it } from 'vitest'
import { isUuid, upsertById } from './analysis-persist'
import { matchToRow } from './mappers'
import type { JobMatch } from '@/types/domain'

describe('analysis persistence helpers', () => {
  it('accepts version-4 UUIDs and rejects other strings', () => {
    expect(isUuid('3b9f0c2a-7d11-4c3a-9f12-8a1b2c3d4e5f')).toBe(true)
    expect(isUuid('not-a-uuid')).toBe(false)
    expect(isUuid('')).toBe(false)
  })

  it('replaces an existing analysis by id instead of duplicating it', () => {
    const first = { id: 'a', title: 'One' }
    const updated = { id: 'a', title: 'Updated' }
    const second = { id: 'b', title: 'Two' }
    expect(upsertById([first], updated)).toEqual([updated])
    expect(upsertById([first], second)).toEqual([second, first])
  })

  it('maps parent match and resume version ids for comparison analyses', () => {
    const match = {
      id: '3b9f0c2a-7d11-4c3a-9f12-8a1b2c3d4e5f',
      userId: 'user-a',
      jobId: '3b9f0c2a-7d11-4c3a-9f12-8a1b2c3d4e60',
      resumeId: '3b9f0c2a-7d11-4c3a-9f12-8a1b2c3d4e61',
      parentMatchId: '3b9f0c2a-7d11-4c3a-9f12-8a1b2c3d4e62',
      resumeVersionId: '3b9f0c2a-7d11-4c3a-9f12-8a1b2c3d4e63',
      overallScore: 91,
      skillsMatched: [],
      skillsPartial: [],
      skillsMissing: [],
      experienceMatch: null,
      educationMatch: null,
      locationMatch: null,
      workAuthorizationNotes: null,
      strengths: [],
      concerns: [],
      recommendation: 'APPLY',
      analysisStatus: 'complete',
      analysisSource: 'api',
      provider: 'match-engine',
      errorMessage: null,
      summary: null,
      createdAt: '2026-08-24T01:00:00.000Z',
      analyzedAt: '2026-08-24T01:00:00.000Z',
    } as JobMatch
    const row = matchToRow(match)
    expect(row.parent_match_id).toBe(match.parentMatchId)
    expect(row.resume_version_id).toBe(match.resumeVersionId)
    expect(row.id).not.toBe(match.parentMatchId)
  })
})
