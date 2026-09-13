import { describe, expect, it } from 'vitest'
import {
  isUuid,
  persistApplicationSelection,
  deleteApplicationRecords,
  filterAnalysisHistory,
  mergeFetchedMatches,
  removeAnalysisFromSnapshot,
  upsertById,
} from './analysis-persist'
import { matchToRow } from './mappers'
import type { Application, JobMatch } from '@/types/domain'

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

  it('upserts the application selected version and score, falling back if those columns are missing', async () => {
    const rows: Record<string, unknown>[] = []
    const client = {
      from: () => ({
        upsert: async (row: Record<string, unknown>) => {
          rows.push(row)
          if (rows.length === 1) {
            return { error: { code: 'PGRST204', message: "Could not find the 'selected_resume_version_id' column of 'applications'" } }
          }
          return { error: null }
        },
      }),
    }
    await persistApplicationSelection(client as never, {
      id: 'app-1',
      userId: 'user-a',
      jobId: 'job-1',
      matchId: 'match-1',
      resumeId: 'resume-1',
      selectedResumeVersionId: 'ver-1',
      currentMatchId: 'match-2',
      currentMatchScore: 88,
      status: 'ready',
      dateAdded: '2026-08-24',
      dateApplied: null,
      nextAction: 'Ready to apply',
      notes: '',
      updatedAt: '2026-08-24T01:00:00.000Z',
    } satisfies Application)
    expect(rows[0]).toMatchObject({
      selected_resume_version_id: 'ver-1',
      current_match_id: 'match-2',
      current_match_score: 88,
      match_id: 'match-1',
    })
    expect(rows[1]).not.toHaveProperty('selected_resume_version_id')
    expect(rows[1]?.match_id).toBe('match-1')
  })

  it('deletes only the selected applications for the current user and leaves other records', async () => {
    const applications = [
      { id: 'app-1', user_id: 'user-a' },
      { id: 'app-2', user_id: 'user-a' },
      { id: 'app-3', user_id: 'user-a' },
      { id: 'app-other', user_id: 'user-b' },
    ]
    const resumes = [{ id: 'resume-1' }]
    const versions = [{ id: 'ver-1' }]
    const matches = [{ id: 'match-1' }]
    const jobs = [{ id: 'job-1' }]
    const tablesTouched: string[] = []
    let deletedFilter: { ids?: string[]; userId?: string } = {}
    const client = {
      from: (table: string) => {
        tablesTouched.push(table)
        return {
          delete: () => ({
            in: (column: string, ids: string[]) => ({
              eq: async (key: string, userId: string) => {
                if (table !== 'applications' || column !== 'id' || key !== 'user_id') {
                  return { error: { message: 'unexpected delete' } }
                }
                deletedFilter = { ids, userId }
                for (const id of ids) {
                  const index = applications.findIndex((row) => row.id === id && row.user_id === userId)
                  if (index >= 0) applications.splice(index, 1)
                }
                return { error: null }
              },
            }),
          }),
          select: () => ({
            in: (_column: string, ids: string[]) => ({
              eq: async (_key: string, userId: string) => {
                if (table !== 'applications') return { data: [], error: null }
                return {
                  data: applications
                    .filter((row) => ids.includes(row.id) && row.user_id === userId)
                    .map((row) => ({ id: row.id })),
                  error: null,
                }
              },
            }),
          }),
        }
      },
    }

    const result = await deleteApplicationRecords(client as never, 'user-a', ['app-1', 'app-2', 'app-other'])
    expect(deletedFilter).toEqual({ ids: ['app-1', 'app-2'], userId: 'user-a' })
    expect(result.deletedIds).toEqual(['app-1', 'app-2'])
    expect(result.remainingIds).toEqual(['app-other'])
    expect(applications.map((row) => row.id)).toEqual(['app-3', 'app-other'])
    expect(resumes).toEqual([{ id: 'resume-1' }])
    expect(versions).toEqual([{ id: 'ver-1' }])
    expect(matches).toEqual([{ id: 'match-1' }])
    expect(jobs).toEqual([{ id: 'job-1' }])
    expect(tablesTouched.every((table) => table === 'applications')).toBe(true)

    const afterRefresh = await deleteApplicationRecords(client as never, 'user-a', ['app-1', 'app-2'])
    expect(afterRefresh.deletedIds).toEqual([])
    expect(afterRefresh.remainingIds).toEqual(['app-1', 'app-2'])
    expect(applications.map((row) => row.id)).toEqual(['app-3', 'app-other'])
  })

  it('does not pretend deletion succeeded when Supabase returns an error', async () => {
    const client = {
      from: () => ({
        delete: () => ({
          in: () => ({
            eq: async () => ({ error: { message: 'permission denied', code: '42501' } }),
          }),
        }),
        select: () => ({
          in: () => ({
            eq: async () => ({ data: [{ id: 'app-1' }], error: null }),
          }),
        }),
      }),
    }
    await expect(deleteApplicationRecords(client as never, 'user-a', ['app-1'])).rejects.toThrow(
      /own account|permission|delete/i,
    )
  })

  it('refreshes remaining ids so a failed delete is not treated as success', async () => {
    const client = {
      from: () => ({
        delete: () => ({
          in: () => ({
            eq: async () => ({ error: null }),
          }),
        }),
        select: () => ({
          in: () => ({
            eq: async () => ({ data: [{ id: 'app-1' }, { id: 'app-2' }], error: null }),
          }),
        }),
      }),
    }
    const result = await deleteApplicationRecords(client as never, 'user-a', ['app-1', 'app-2'])
    expect(result.deletedIds).toEqual([])
    expect(result.remainingIds).toEqual(['app-1', 'app-2'])
  })

  it('does not treat another user\'s application as deleted when RLS hides it', async () => {
    const result = await deleteApplicationRecords(
      {
        from: () => ({
          delete: () => ({
            in: () => ({
              eq: async () => ({ error: null }),
            }),
          }),
          select: () => ({
            in: () => ({
              eq: async () => ({ data: [], error: null }),
            }),
          }),
        }),
      } as never,
      'user-a',
      ['app-other'],
    )
    expect(result.deletedIds).toEqual([])
    expect(result.remainingIds).toEqual(['app-other'])
  })
})

describe('analysis history state', () => {
  const jobA = { id: 'job-a' }
  const jobB = { id: 'job-b' }
  const matchA = { id: 'match-a', jobId: 'job-a', analysisStatus: 'complete' as const }
  const matchB = { id: 'match-b', jobId: 'job-b', analysisStatus: 'complete' as const }
  const appA = { id: 'app-a', matchId: 'match-a', jobId: 'job-a' }

  it('removes a deleted history item, its application, and an unused job immediately', () => {
    const next = removeAnalysisFromSnapshot(
      {
        matches: [matchA, matchB],
        jobs: [jobA, jobB],
        applications: [appA],
      },
      'match-a',
    )
    expect(next.matches.map((item) => item.id)).toEqual(['match-b'])
    expect(next.jobs.map((item) => item.id)).toEqual(['job-b'])
    expect(next.applications).toEqual([])
  })

  it('updates history counts and keeps a job that still has another analysis', () => {
    const next = removeAnalysisFromSnapshot(
      {
        matches: [matchA, { ...matchB, jobId: 'job-a' }],
        jobs: [jobA],
        applications: [appA],
      },
      'match-a',
    )
    expect(next.matches).toHaveLength(1)
    expect(next.jobs).toEqual([jobA])
  })

  it('does not change state when the delete target is missing', () => {
    const current = { matches: [matchA], jobs: [jobA], applications: [appA] }
    expect(removeAnalysisFromSnapshot(current, 'missing')).toEqual(current)
  })

  it('does not resurrect a deleted complete analysis when merging a refetch', () => {
    const fetched = [{ id: 'match-b', jobId: 'job-b', analysisStatus: 'complete' as const }]
    const current = [matchA, matchB]
    expect(mergeFetchedMatches(fetched, current).map((item) => item.id)).toEqual(['match-b'])
  })

  it('keeps an in-flight local analysis that the refetch has not stored yet', () => {
    const generating = { id: 'match-local', jobId: 'job-a', analysisStatus: 'pending' as const }
    const merged = mergeFetchedMatches([matchB], [generating, matchA])
    expect(merged.map((item) => item.id)).toEqual(['match-b', 'match-local'])
  })

  it('filters search results and treats an empty query as all rows', () => {
    const rows = [
      { job: { title: 'Java Engineer', company: 'Acme' }, match: { recommendation: 'APPLY' } },
      { job: { title: 'AI Engineer', company: 'Northwind' }, match: { recommendation: 'REVIEW' } },
    ]
    expect(filterAnalysisHistory(rows, 'java')).toHaveLength(1)
    expect(filterAnalysisHistory(rows, 'NORTHWIND')).toHaveLength(1)
    expect(filterAnalysisHistory(rows, '')).toHaveLength(2)
    expect(filterAnalysisHistory(rows, 'missing')).toHaveLength(0)
  })

  it('shows an empty list after the last matching item is removed', () => {
    const afterDelete = removeAnalysisFromSnapshot(
      { matches: [matchA], jobs: [jobA], applications: [appA] },
      'match-a',
    )
    const rows = afterDelete.matches.map((match) => ({
      job: afterDelete.jobs.find((job) => job.id === match.jobId)
        ? { title: 'Java Engineer', company: 'Acme' }
        : undefined,
      match: { recommendation: 'APPLY' },
    }))
    expect(filterAnalysisHistory(rows, '')).toEqual([])
    expect(afterDelete.matches).toHaveLength(0)
  })
})
