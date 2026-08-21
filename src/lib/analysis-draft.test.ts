import { afterEach, describe, expect, it } from 'vitest'
import {
  analysisDraftKey,
  clearAnalysisDraft,
  emptyAnalysisDraft,
  loadAnalysisDraft,
  readAnalysisDraft,
  writeAnalysisDraft,
  type AnalysisDraft,
} from './analysis-draft'

const memory = new Map<string, string>()

const localStorageMock: Storage = {
  get length() {
    return memory.size
  },
  clear() {
    memory.clear()
  },
  getItem(key: string) {
    return memory.get(key) ?? null
  },
  key(index: number) {
    return [...memory.keys()][index] ?? null
  },
  removeItem(key: string) {
    memory.delete(key)
  },
  setItem(key: string, value: string) {
    memory.set(key, value)
  },
}

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: localStorageMock,
})

function typedDraft(overrides: Partial<AnalysisDraft> = {}): AnalysisDraft {
  return {
    ...emptyAnalysisDraft(),
    title: 'Staff Engineer',
    company: 'Northwind',
    description: 'Build the dashboard and own the design system.',
    ...overrides,
  }
}

describe('Job Analysis unsaved draft', () => {
  afterEach(() => {
    memory.clear()
  })

  it('keys drafts to the authenticated user', () => {
    expect(analysisDraftKey('user-123')).toBe('jobpilot.analysis-draft:user-123')
    writeAnalysisDraft('user-a', typedDraft({ description: 'A only' }))
    writeAnalysisDraft('user-b', typedDraft({ description: 'B only' }))
    expect(readAnalysisDraft('user-a')?.description).toBe('A only')
    expect(readAnalysisDraft('user-b')?.description).toBe('B only')
  })

  it('saves a typed job description and restores it after navigating away', () => {
    const userId = 'user-nav'
    writeAnalysisDraft(
      userId,
      typedDraft({
        title: 'Frontend Engineer',
        company: 'Acme',
        location: 'Remote',
        jobUrl: 'https://example.com/jobs/1',
        description: 'Looking for a React engineer.',
        resumeId: 'resume-1',
        resumeText: 'React, TypeScript, 6 years.',
      }),
    )

    // Unmount / navigate away: in-memory form state is discarded.
    const restored = loadAnalysisDraft(userId, { resumeId: 'master', resumeText: 'MASTER RESUME' })
    expect(restored.restored).toBe(true)
    expect(restored.draft.title).toBe('Frontend Engineer')
    expect(restored.draft.company).toBe('Acme')
    expect(restored.draft.location).toBe('Remote')
    expect(restored.draft.jobUrl).toBe('https://example.com/jobs/1')
    expect(restored.draft.description).toBe('Looking for a React engineer.')
    expect(restored.draft.resumeId).toBe('resume-1')
    expect(restored.draft.resumeText).toBe('React, TypeScript, 6 years.')
  })

  it('keeps the newest meaningful draft when an empty write is attempted', () => {
    const userId = 'user-keep'
    writeAnalysisDraft(userId, typedDraft({ description: 'Newest posting notes.' }))
    writeAnalysisDraft(userId, emptyAnalysisDraft())
    expect(readAnalysisDraft(userId)?.description).toBe('Newest posting notes.')
  })

  it('does not overwrite a stored draft with empty defaults during initialization', () => {
    const userId = 'user-init'
    writeAnalysisDraft(userId, typedDraft({ description: 'Keep this posting.' }))

    const firstPaint = loadAnalysisDraft(userId, { resumeId: 'custom', resumeText: '' })
    expect(firstPaint.restored).toBe(true)
    expect(firstPaint.draft.description).toBe('Keep this posting.')
    expect(readAnalysisDraft(userId)?.description).toBe('Keep this posting.')
  })

  it('clears the draft after a completed analysis while leaving other users alone', () => {
    writeAnalysisDraft('user-done', typedDraft({ description: 'Should clear after save.' }))
    writeAnalysisDraft('user-other', typedDraft({ description: 'Should remain.' }))

    clearAnalysisDraft('user-done')

    expect(readAnalysisDraft('user-done')).toBeNull()
    expect(readAnalysisDraft('user-other')?.description).toBe('Should remain.')
  })

  it('does not treat an empty stored payload as a restored draft', () => {
    const userId = 'user-empty-payload'
    memory.set(analysisDraftKey(userId), JSON.stringify(emptyAnalysisDraft()))

    const loaded = loadAnalysisDraft(userId, {
      resumeId: 'master-id',
      resumeText: 'Master resume text',
    })

    expect(loaded.restored).toBe(false)
    expect(loaded.draft.resumeId).toBe('master-id')
    expect(loaded.draft.resumeText).toBe('Master resume text')
  })

  it('Clear draft removes the saved draft so the next visit uses fallbacks', () => {
    const userId = 'user-clear'
    writeAnalysisDraft(userId, typedDraft({ description: 'Temporary notes.' }))
    expect(readAnalysisDraft(userId)).not.toBeNull()

    clearAnalysisDraft(userId)

    const nextVisit = loadAnalysisDraft(userId, {
      resumeId: 'master-id',
      resumeText: 'Master resume text',
    })
    expect(nextVisit.restored).toBe(false)
    expect(nextVisit.draft.description).toBe('')
    expect(nextVisit.draft.resumeId).toBe('master-id')
    expect(nextVisit.draft.resumeText).toBe('Master resume text')
  })
})
