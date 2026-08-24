import { describe, expect, it, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  clearInflightGenerations,
  findActiveVersion,
  getInflightGeneration,
  isStaleGenerating,
  markVersionSelected,
  shouldStartGeneration,
  startTailorGeneration,
  tailorSessionKey,
} from './tailor-session'
import { scoreChange, sanitizeTailoredContent, tailoredResumeToText } from './tailored-text'
import { emptyTailoredContent } from './tailored-text'
import type { ResumeVersion, TailoredResumeContent } from '@/types/domain'

function sampleContent(overrides: Partial<TailoredResumeContent> = {}): TailoredResumeContent {
  return {
    ...emptyTailoredContent(),
    summary: 'Software Engineer with experience developing Java and Spring Boot.',
    skills: ['Java', 'Spring Boot', 'PostgreSQL'],
    experience: [
      {
        company: 'Northwind',
        title: 'Backend Engineer',
        dates: '2021 to present',
        bullets: ['Developed Java and Spring Boot applications for payments APIs.'],
      },
    ],
    contact: { name: 'Jordan Hale', email: 'jordan.hale@example.com', location: 'Austin, TX' },
    ...overrides,
  }
}

function version(overrides: Partial<ResumeVersion> = {}): ResumeVersion {
  const now = '2026-08-24T01:00:00.000Z'
  return {
    id: 'ver-1',
    userId: 'user-a',
    sourceResumeId: 'resume-1',
    jobId: 'job-1',
    analysisId: 'match-1',
    versionName: 'Tailored — Senior Java Software Engineer — Northwind Payments',
    resumeContent: sampleContent(),
    tailoringSummary: { skillsToEmphasize: ['Java'], relatedSkills: [], missingSkills: ['Kubernetes'], experienceToEmphasize: [] },
    changes: [],
    warnings: [],
    status: 'completed',
    createdBy: 'ai',
    isSelected: false,
    generationId: 'gen-1',
    comparisonAnalysisId: null,
    originalContent: sampleContent({ summary: 'Software Engineer with experience in Java development.' }),
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

beforeEach(() => {
  clearInflightGenerations()
})

describe('tailor session persistence', () => {
  it('keeps a single in-flight generation across simulated navigation', async () => {
    const persisted: ResumeVersion[] = []
    const persist = vi.fn(async (item: ResumeVersion) => {
      persisted.push(item)
    })
    let resolveTailor: (value: Record<string, unknown>) => void = () => undefined
    const tailor = vi.fn(
      () =>
        new Promise<Record<string, unknown>>((resolve) => {
          resolveTailor = resolve
        }),
    )

    const first = startTailorGeneration({
      userId: 'user-a',
      sourceResumeId: 'resume-1',
      jobId: 'job-1',
      analysisId: 'match-1',
      versionName: 'Tailored',
      payload: { resumeText: 'Java', jobDescription: 'Java job' },
      persist,
      tailor,
    })
    const afterNavigation = getInflightGeneration(tailorSessionKey('user-a', 'resume-1', 'job-1'))
    expect(afterNavigation?.generationId).toBe(first.generationId)
    const second = startTailorGeneration({
      userId: 'user-a',
      sourceResumeId: 'resume-1',
      jobId: 'job-1',
      analysisId: 'match-1',
      versionName: 'Tailored',
      payload: { resumeText: 'Java', jobDescription: 'Java job' },
      persist,
      tailor,
    })
    expect(second.generationId).toBe(first.generationId)
    await vi.waitFor(() => expect(tailor).toHaveBeenCalledTimes(1))

    resolveTailor({
      status: 'complete',
      tailored: sampleContent(),
      original: sampleContent({ summary: 'Original' }),
      plan: { skillsToEmphasize: ['Java'], relatedSkills: [], missingSkills: [], experienceToEmphasize: [] },
    })
    const completed = await first.promise
    expect(completed.status).toBe('completed')
    expect(persisted.some((item) => item.status === 'generating')).toBe(true)
    expect(persisted.some((item) => item.status === 'completed')).toBe(true)
  })

  it('restores a completed version instead of generating again', () => {
    const existing = version({ status: 'completed' })
    expect(shouldStartGeneration(existing, false)).toBe(false)
    expect(findActiveVersion([existing], 'resume-1', 'job-1')?.id).toBe('ver-1')
  })

  it('auto-starts only when no usable version exists', () => {
    expect(shouldStartGeneration(null, false)).toBe(true)
    expect(shouldStartGeneration(version({ status: 'failed' }), false)).toBe(false)
    expect(shouldStartGeneration(version({ status: 'completed' }), false)).toBe(false)
    expect(shouldStartGeneration(version({ status: 'completed' }), true)).toBe(true)
  })

  it('keeps a resume without replacing the source resume id', () => {
    const sourceIds = ['resume-1']
    const versions = markVersionSelected([version(), version({ id: 'ver-2', isSelected: true })], 'ver-1', 'job-1')
    expect(versions.find((item) => item.id === 'ver-1')?.isSelected).toBe(true)
    expect(versions.find((item) => item.id === 'ver-1')?.status).toBe('kept')
    expect(versions.find((item) => item.id === 'ver-2')?.isSelected).toBe(false)
    expect(sourceIds).toEqual(['resume-1'])
  })

  it('marks an edited version as user-authored', () => {
    const edited = { ...version(), createdBy: 'user' as const, warnings: ['user-edited'] }
    expect(edited.createdBy).toBe('user')
    expect(edited.resumeContent.experience[0].company).toBe('Northwind')
  })

  it('shows the newest completed version after regenerate instead of a previously selected copy', () => {
    const kept = version({
      id: 'ver-kept',
      isSelected: true,
      status: 'kept',
      updatedAt: '2026-08-24T01:00:00.000Z',
    })
    const regenerated = version({
      id: 'ver-new',
      isSelected: false,
      status: 'completed',
      updatedAt: '2026-08-24T01:05:00.000Z',
    })
    expect(findActiveVersion([kept, regenerated], 'resume-1', 'job-1')?.id).toBe('ver-new')
  })

  it('does not start a duplicate generation while one is in flight', () => {
    const persist = vi.fn(async () => undefined)
    const tailor = vi.fn(() => new Promise<Record<string, unknown>>(() => undefined))
    startTailorGeneration({
      userId: 'user-a',
      sourceResumeId: 'resume-1',
      jobId: 'job-1',
      analysisId: 'match-1',
      versionName: 'Tailored',
      payload: {},
      persist,
      tailor,
    })
    expect(shouldStartGeneration(version({ status: 'generating', userId: 'user-a', jobId: 'job-1', sourceResumeId: 'resume-1' }), false)).toBe(false)
  })

  it('does not stay generating when the generating persist throws', async () => {
    const persist = vi.fn(async (item: ResumeVersion) => {
      if (item.status === 'generating') throw new Error('schema cache: could not find the status column')
    })
    const tailor = vi.fn(async () => ({
      status: 'complete',
      tailored: sampleContent(),
      original: sampleContent({ summary: 'Original' }),
      plan: { skillsToEmphasize: ['Java'], relatedSkills: [], missingSkills: [], experienceToEmphasize: [] },
    }))
    const session = startTailorGeneration({
      userId: 'user-a',
      sourceResumeId: 'resume-1',
      jobId: 'job-1',
      analysisId: 'match-1',
      versionName: 'Tailored',
      payload: {},
      persist,
      tailor,
    })
    const result = await session.promise
    expect(result.status).toBe('completed')
    expect(tailor).toHaveBeenCalledTimes(1)
  })

  it('marks failed when the LLM/tailor request throws', async () => {
    const persist = vi.fn(async () => undefined)
    const tailor = vi.fn(async () => {
      throw new Error('LLM API returned 502')
    })
    const result = await startTailorGeneration({
      userId: 'user-a',
      sourceResumeId: 'resume-1',
      jobId: 'job-1',
      analysisId: 'match-1',
      versionName: 'Tailored',
      payload: {},
      persist,
      tailor,
    }).promise
    expect(result.status).toBe('failed')
    expect(result.warnings[0]).toMatch(/502|could not be tailored/i)
    expect(getInflightGeneration(tailorSessionKey('user-a', 'resume-1', 'job-1'))).toBeNull()
  })

  it('marks failed when the tailor request never returns before the timeout', async () => {
    const persist = vi.fn(async () => undefined)
    const tailor = vi.fn(() => new Promise<Record<string, unknown>>(() => undefined))
    const result = await startTailorGeneration({
      userId: 'user-a',
      sourceResumeId: 'resume-1',
      jobId: 'job-1',
      analysisId: 'match-1',
      versionName: 'Tailored',
      payload: {},
      persist,
      tailor,
      timeoutMs: 20,
    }).promise
    expect(result.status).toBe('failed')
    const saved = persist.mock.calls.map((call) => call.at(0) as ResumeVersion | undefined)
    expect(saved.some((item) => item?.status === 'failed')).toBe(true)
  })

  it('keeps a completed resume when saving the version fails', async () => {
    const persist = vi.fn(async (item: ResumeVersion) => {
      if (item.status === 'completed') throw new Error('database down')
    })
    const tailor = vi.fn(async () => ({
      status: 'complete',
      tailored: sampleContent(),
      original: sampleContent(),
      plan: { skillsToEmphasize: ['Java'], relatedSkills: [], missingSkills: [], experienceToEmphasize: [] },
    }))
    const result = await startTailorGeneration({
      userId: 'user-a',
      sourceResumeId: 'resume-1',
      jobId: 'job-1',
      analysisId: 'match-1',
      versionName: 'Tailored',
      payload: {},
      persist,
      tailor,
    }).promise
    expect(result.status).toBe('completed')
    expect(result.warnings.some((item) => /could not be saved/i.test(item))).toBe(true)
    expect(result.resumeContent.skills).toContain('Java')
  })

  it('does not auto-start a stale generating version without an inflight request', () => {
    const stale = version({
      status: 'generating',
      updatedAt: '2026-08-24T00:00:00.000Z',
      createdAt: '2026-08-24T00:00:00.000Z',
    })
    const now = Date.parse('2026-08-24T00:05:00.000Z')
    expect(isStaleGenerating(stale, now)).toBe(true)
    expect(shouldStartGeneration(stale, false, now)).toBe(false)
    expect(findActiveVersion([stale, version({ id: 'ver-done', status: 'completed', updatedAt: '2026-08-24T00:01:00.000Z' })], 'resume-1', 'job-1', now)?.status).toBe('completed')
  })

  it('resumes a fresh generating version after refresh when nothing is in flight', () => {
    const fresh = version({ status: 'generating', updatedAt: new Date().toISOString() })
    expect(shouldStartGeneration(fresh, false)).toBe(true)
  })

  it('treats an invalid LLM payload as failed rather than generating', async () => {
    const persist = vi.fn(async () => undefined)
    const tailor = vi.fn(async () => ({
      status: 'invalid',
      tailored: null,
      message: 'Some generated content could not be verified against your master resume. Please review and regenerate.',
    }))
    const result = await startTailorGeneration({
      userId: 'user-a',
      sourceResumeId: 'resume-1',
      jobId: 'job-1',
      analysisId: 'match-1',
      versionName: 'Tailored',
      payload: {},
      persist,
      tailor,
    }).promise
    expect(result.status).toBe('failed')
    expect(result.resumeContent.summary).toBe('')
  })

  it('starts tailoring even if the generating persist never resolves', async () => {
    const persist = vi.fn((item: ResumeVersion) => {
      if (item.status === 'generating') return new Promise<void>(() => undefined)
      return Promise.resolve()
    })
    const tailor = vi.fn(async () => ({
      status: 'complete',
      tailored: sampleContent(),
      original: sampleContent(),
      plan: { skillsToEmphasize: ['Java'], relatedSkills: [], missingSkills: [], experienceToEmphasize: [] },
    }))
    const result = await startTailorGeneration({
      userId: 'user-a',
      sourceResumeId: 'resume-1',
      jobId: 'job-1',
      analysisId: 'match-1',
      versionName: 'Tailored',
      payload: {},
      persist,
      tailor,
    }).promise
    expect(tailor).toHaveBeenCalledTimes(1)
    expect(result.status).toBe('completed')
  })
})

describe('tailored resume scoring inputs', () => {
  it('includes edited bullets in the text sent to the match engine', () => {
    const text = tailoredResumeToText(
      sampleContent({
        experience: [
          {
            company: 'Northwind',
            title: 'Backend Engineer',
            dates: '2021 to present',
            bullets: ['Owned PostgreSQL schema changes for billing.'],
          },
        ],
      }),
    )
    expect(text).toContain('Owned PostgreSQL schema changes for billing.')
    expect(text).toContain('Northwind')
    expect(text).toContain('2021 to present')
  })

  it('can produce a higher updated score from actual engine inputs', () => {
    expect(scoreChange(82, 91)).toEqual({ previous: 82, updated: 91, delta: 9 })
  })

  it('can produce a lower updated score when the tailored text is weaker', () => {
    const weaker = tailoredResumeToText(
      sampleContent({
        skills: ['Python'],
        summary: 'Generalist.',
        experience: [
          {
            company: 'Northwind',
            title: 'Backend Engineer',
            dates: '2021 to present',
            bullets: ['Worked on internal tools.'],
          },
        ],
      }),
    )
    expect(weaker).not.toMatch(/Spring Boot/)
    expect(scoreChange(91, 70)).toEqual({ previous: 91, updated: 70, delta: -21 })
  })

  it('drops empty bullets and skills before persistence', () => {
    const cleaned = sanitizeTailoredContent(
      sampleContent({
        skills: ['Java', '  ', 'Spring Boot'],
        experience: [
          {
            company: 'Northwind',
            title: 'Backend Engineer',
            dates: '2021 to present',
            bullets: ['Developed Java APIs.', '   ', ''],
          },
        ],
      }),
    )
    expect(cleaned.skills).toEqual(['Java', 'Spring Boot'])
    expect(cleaned.experience[0]?.bullets).toEqual(['Developed Java APIs.'])
    expect(tailoredResumeToText(cleaned)).not.toMatch(/- \n/)
  })
})

describe('resume version isolation', () => {
  it('does not expose another user version through findActiveVersion', () => {
    const mine = version({ userId: 'user-a' })
    const theirs = version({ id: 'ver-b', userId: 'user-b', sourceResumeId: 'resume-b' })
    expect(findActiveVersion([mine, theirs], 'resume-1', 'job-1')?.userId).toBe('user-a')
  })

  it('keeps RLS on resume versions in the status migration', () => {
    const sql = readFileSync(path.resolve(process.cwd(), 'supabase/migrations/004_resume_version_status.sql'), 'utf8')
    expect(sql).toMatch(/enable row level security/)
    expect(sql).toMatch(/auth\.uid\(\) = user_id/)
    expect(sql).toMatch(/status/)
    expect(sql).toMatch(/created_by/)
    expect(sql).toMatch(/is_selected/)
  })
})

describe('resume version persist fallback', () => {
  it('can persist without status columns when the 004 migration is missing', async () => {
    const { resumeVersionCoreRow } = await import('./resume-versions')
    const row = resumeVersionCoreRow(version())
    expect(row).not.toHaveProperty('status')
    expect(row).not.toHaveProperty('created_by')
    expect(row).not.toHaveProperty('is_selected')
    expect(row.resume_content).toBeTruthy()
    expect(row.source_resume_id).toBe('resume-1')
  })
})
