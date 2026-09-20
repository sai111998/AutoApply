import type { AutoApplyProfile, AutoApplyQuestion } from './types'
import { answerKnownQuestion } from './questions'
import type { GreenhouseQuestion } from '../jobs/providers/greenhouse'

export function mapGreenhouseQuestionToLibrary(
  question: GreenhouseQuestion,
  profile: AutoApplyProfile,
  userId?: string,
): AutoApplyQuestion {
  const known = answerKnownQuestion(question.label, profile, userId)
  if (known?.answer) {
    return { ...known, id: question.id, prompt: question.label }
  }
  const field = question.id.toLowerCase()
  if (/(first.?name|given)/.test(field) && profile.fullName.trim()) {
    return { id: question.id, prompt: question.label, answer: profile.fullName.trim().split(/\s+/)[0] || null, source: 'profile' }
  }
  if (/(last.?name|family|surname)/.test(field) && profile.fullName.trim()) {
    return { id: question.id, prompt: question.label, answer: profile.fullName.trim().split(/\s+/).slice(1).join(' ') || null, source: 'profile' }
  }
  if (/email/.test(field) && profile.email.trim()) {
    return { id: question.id, prompt: question.label, answer: profile.email, source: 'profile' }
  }
  if (question.required && !known?.answer) {
    return { id: question.id, prompt: question.label, answer: null, source: 'user' }
  }
  return { id: question.id, prompt: question.label, answer: known?.answer ?? null, source: known?.source ?? 'user' }
}

export function resolveGreenhouseQuestions(
  questions: GreenhouseQuestion[],
  profile: AutoApplyProfile,
  userId?: string,
): { answered: AutoApplyQuestion[]; unknown: AutoApplyQuestion[] } {
  const answered: AutoApplyQuestion[] = []
  const unknown: AutoApplyQuestion[] = []
  for (const question of questions) {
    const mapped = mapGreenhouseQuestionToLibrary(question, profile, userId)
    if (mapped.answer) answered.push(mapped)
    else if (question.required) unknown.push({ ...mapped, answer: null, source: 'user' })
  }
  return { answered, unknown }
}
