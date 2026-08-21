export const ANALYSIS_DRAFT_PREFIX = 'jobpilot.analysis-draft:'

export interface AnalysisDraft {
  title: string
  company: string
  location: string
  jobUrl: string
  description: string
  resumeId: string
  resumeText: string
  updatedAt: number
}

export function analysisDraftKey(userId: string): string {
  return `${ANALYSIS_DRAFT_PREFIX}${userId}`
}

export function emptyAnalysisDraft(): AnalysisDraft {
  return {
    title: '',
    company: '',
    location: '',
    jobUrl: '',
    description: '',
    resumeId: 'custom',
    resumeText: '',
    updatedAt: 0,
  }
}

export function isMeaningfulDraft(draft: Pick<AnalysisDraft, keyof Omit<AnalysisDraft, 'updatedAt'>>): boolean {
  return Boolean(
    draft.title.trim() ||
      draft.company.trim() ||
      draft.location.trim() ||
      draft.jobUrl.trim() ||
      draft.description.trim() ||
      draft.resumeText.trim() ||
      (draft.resumeId && draft.resumeId !== 'custom'),
  )
}

function getLocalStorage(): Storage | null {
  try {
    const storage = globalThis.localStorage
    if (!storage) return null
    return storage
  } catch {
    return null
  }
}

function parseDraft(raw: string | null): AnalysisDraft | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Partial<AnalysisDraft>
    if (!value || typeof value !== 'object') return null
    return {
      title: typeof value.title === 'string' ? value.title : '',
      company: typeof value.company === 'string' ? value.company : '',
      location: typeof value.location === 'string' ? value.location : '',
      jobUrl: typeof value.jobUrl === 'string' ? value.jobUrl : '',
      description: typeof value.description === 'string' ? value.description : '',
      resumeId: typeof value.resumeId === 'string' && value.resumeId ? value.resumeId : 'custom',
      resumeText: typeof value.resumeText === 'string' ? value.resumeText : '',
      updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : Date.now(),
    }
  } catch {
    return null
  }
}

export function readAnalysisDraft(userId: string): AnalysisDraft | null {
  if (!userId) return null
  return parseDraft(getLocalStorage()?.getItem(analysisDraftKey(userId)) ?? null)
}

export function writeAnalysisDraft(userId: string, draft: AnalysisDraft): AnalysisDraft | null {
  if (!userId) return null
  const storage = getLocalStorage()
  if (!storage) return null
  const key = analysisDraftKey(userId)
  if (!isMeaningfulDraft(draft)) {
    storage.removeItem(key)
    return null
  }
  const next = { ...draft, updatedAt: Date.now() }
  storage.setItem(key, JSON.stringify(next))
  return next
}

export function clearAnalysisDraft(userId: string): void {
  if (!userId) return
  getLocalStorage()?.removeItem(analysisDraftKey(userId))
}

export function loadAnalysisDraft(
  userId: string,
  fallback: { resumeId: string; resumeText: string },
): { draft: AnalysisDraft; restored: boolean } {
  const stored = readAnalysisDraft(userId)
  if (stored) return { draft: stored, restored: true }
  return {
    draft: {
      ...emptyAnalysisDraft(),
      resumeId: fallback.resumeId || 'custom',
      resumeText: fallback.resumeText,
    },
    restored: false,
  }
}
