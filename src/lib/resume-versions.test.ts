import { describe, expect, it, vi } from 'vitest'
import { persistResumeVersion } from './resume-versions'
import { emptyTailoredContent } from './tailored-text'
import type { ResumeVersion } from '@/types/domain'

function version(): ResumeVersion {
  const now = '2026-08-24T01:00:00.000Z'
  return {
    id: '11111111-1111-4111-8111-111111111111',
    userId: '11111111-1111-4111-8111-111111111112',
    sourceResumeId: '11111111-1111-4111-8111-111111111113',
    jobId: '11111111-1111-4111-8111-111111111114',
    analysisId: '11111111-1111-4111-8111-111111111115',
    versionName: 'Tailored',
    resumeContent: emptyTailoredContent(),
    tailoringSummary: { skillsToEmphasize: [], relatedSkills: [], missingSkills: [], experienceToEmphasize: [] },
    changes: [],
    warnings: [],
    status: 'kept',
    createdBy: 'ai',
    isSelected: true,
    generationId: 'gen-1',
    comparisonAnalysisId: null,
    originalContent: null,
    createdAt: now,
    updatedAt: now,
  }
}

describe('persistResumeVersion', () => {
  it('does not clear job_id when a foreign key fails', async () => {
    const rows: Record<string, unknown>[] = []
    const client = {
      from: () => ({
        upsert: vi.fn(async (row: Record<string, unknown>) => {
          rows.push(row)
          return { error: { code: '23503', message: 'violates foreign key constraint' } }
        }),
      }),
    }
    await expect(persistResumeVersion(client as never, version())).rejects.toThrow(/linked to the saved job|Could not keep the resume/i)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((row) => row.job_id === '11111111-1111-4111-8111-111111111114')).toBe(true)
  })
})
