import { readRuntimeJson, writeRuntimeJson } from '../automation/runtime-io'

export type AnswerSource = 'profile' | 'user' | 'library'
export type AnswerType = 'text' | 'boolean' | 'choice'

export interface StoredApplicationAnswer {
  userId: string
  questionFingerprint: string
  questionText: string
  normalizedQuestion: string
  prompt: string
  answer: string
  answerType: AnswerType
  source: AnswerSource
  userApproved: boolean
  createdAt: string
  updatedAt: string
}

const ANSWERS_FILE = 'answers.json'
const library = new Map<string, StoredApplicationAnswer>()

function libraryKey(userId: string, fingerprint: string) {
  return `${userId}::${fingerprint}`
}

function reloadAnswers() {
  const parsed = readRuntimeJson<StoredApplicationAnswer[]>(ANSWERS_FILE)
  if (!parsed) return
  for (const entry of parsed) {
    if (entry?.userId && entry.questionFingerprint) {
      library.set(libraryKey(entry.userId, entry.questionFingerprint), entry)
    }
  }
}

function flushAnswers() {
  writeRuntimeJson(ANSWERS_FILE, [...library.values()])
}

export function normalizeQuestion(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

export function questionFingerprint(value: string): string {
  return normalizeQuestion(value)
}

export function resetAnswerLibraryForTests() {
  library.clear()
}

export function rememberApprovedAnswer(input: {
  userId: string
  prompt: string
  answer: string
  answerType?: AnswerType
  source?: AnswerSource
}): StoredApplicationAnswer | null {
  const userId = input.userId.trim()
  const prompt = input.prompt.trim()
  const answer = input.answer.trim()
  const fingerprint = questionFingerprint(prompt)
  if (!userId || !prompt || !answer || !fingerprint) return null
  reloadAnswers()
  const now = new Date().toISOString()
  const existing = library.get(libraryKey(userId, fingerprint))
  const stored: StoredApplicationAnswer = {
    userId,
    questionFingerprint: fingerprint,
    questionText: prompt,
    normalizedQuestion: fingerprint,
    prompt,
    answer,
    answerType: input.answerType ?? inferAnswerType(answer),
    source: input.source ?? 'user',
    userApproved: true,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  library.set(libraryKey(userId, fingerprint), stored)
  flushAnswers()
  return stored
}

export function lookupApprovedAnswer(userId: string, prompt: string): StoredApplicationAnswer | null {
  reloadAnswers()
  const fingerprint = questionFingerprint(prompt)
  if (!userId.trim() || !fingerprint) return null
  const stored = library.get(libraryKey(userId, fingerprint))
  return stored?.userApproved ? stored : null
}

export function listApprovedAnswers(userId: string): StoredApplicationAnswer[] {
  reloadAnswers()
  return [...library.values()].filter((item) => item.userId === userId && item.userApproved)
}

function inferAnswerType(answer: string): AnswerType {
  if (/^(yes|no)$/i.test(answer.trim())) return 'boolean'
  return 'text'
}
