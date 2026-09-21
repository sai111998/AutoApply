import type { AutoApplyProfile, AutoApplyQuestion } from './types'
import { applicationQuestionMapper } from '../application/mapper'
import { buildCandidateApplicationProfile } from '../application/profile'
import { rememberApprovedAnswer } from '../application/answers'

export function answerKnownQuestion(
  prompt: string,
  profile: AutoApplyProfile,
  userId?: string,
): AutoApplyQuestion | null {
  const candidate = buildCandidateApplicationProfile({ profile })
  const mapped = applicationQuestionMapper(prompt, candidate, userId)
  if (!mapped.answer) return null
  return {
    id: mapped.field || mapped.question,
    prompt,
    answer: mapped.answer,
    source: mapped.source,
  }
}

export function resolveApplicationQuestions(
  prompts: string[],
  profile: AutoApplyProfile,
  userId?: string,
): {
  answered: AutoApplyQuestion[]
  unknown: AutoApplyQuestion[]
} {
  const candidate = buildCandidateApplicationProfile({ profile })
  const answered: AutoApplyQuestion[] = []
  const unknown: AutoApplyQuestion[] = []
  for (const prompt of prompts) {
    const mapped = applicationQuestionMapper(prompt, candidate, userId)
    const item: AutoApplyQuestion = {
      id: mapped.field || `unknown-${unknown.length + 1}`,
      prompt,
      answer: mapped.answer,
      source: mapped.source,
    }
    if (mapped.answer) answered.push(item)
    else unknown.push({ ...item, id: `unknown-${unknown.length + 1}`, source: 'user' })
  }
  return { answered, unknown }
}

export function rememberUserAnswers(
  userId: string,
  answers: Array<{ prompt?: string; answer?: string | null }>,
) {
  for (const item of answers) {
    if (item.prompt && item.answer) {
      rememberApprovedAnswer({ userId, prompt: item.prompt, answer: item.answer, source: 'user' })
    }
  }
}
