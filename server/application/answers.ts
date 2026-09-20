export type AnswerSource = 'profile' | 'user' | 'library'

export interface StoredApplicationAnswer {
  userId: string
  normalizedQuestion: string
  prompt: string
  answer: string
  answerType: 'text' | 'boolean' | 'choice'
  source: AnswerSource
  userApproved: boolean
  createdAt: string
  updatedAt: string
}

const library = new Map<string, StoredApplicationAnswer>()

function libraryKey(userId: string, normalizedQuestion: string) {
  return `${userId}::${normalizedQuestion}`
}

export function normalizeQuestion(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

export function resetAnswerLibraryForTests() {
  library.clear()
}

export function rememberApprovedAnswer(input: {
  userId: string
  prompt: string
  answer: string
  answerType?: StoredApplicationAnswer['answerType']
  source?: AnswerSource
}): StoredApplicationAnswer | null {
  const userId = input.userId.trim()
  const prompt = input.prompt.trim()
  const answer = input.answer.trim()
  const normalizedQuestion = normalizeQuestion(prompt)
  if (!userId || !prompt || !answer || !normalizedQuestion) return null
  const now = new Date().toISOString()
  const existing = library.get(libraryKey(userId, normalizedQuestion))
  const stored: StoredApplicationAnswer = {
    userId,
    normalizedQuestion,
    prompt,
    answer,
    answerType: input.answerType ?? 'text',
    source: input.source ?? 'user',
    userApproved: true,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  library.set(libraryKey(userId, normalizedQuestion), stored)
  return stored
}

export function lookupApprovedAnswer(userId: string, prompt: string): StoredApplicationAnswer | null {
  const normalizedQuestion = normalizeQuestion(prompt)
  if (!userId.trim() || !normalizedQuestion) return null
  return library.get(libraryKey(userId, normalizedQuestion)) ?? null
}

export function listApprovedAnswers(userId: string): StoredApplicationAnswer[] {
  return [...library.values()].filter((item) => item.userId === userId)
}
