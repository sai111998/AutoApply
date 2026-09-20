import type { AutoApplyProfile, AutoApplyQuestion } from './types'
import { lookupApprovedAnswer, rememberApprovedAnswer } from '../application/answers'

function normalizePrompt(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function authorizationAnswer(value: string | null): string | null {
  if (!value) return null
  if (value === 'us_citizen' || value === 'us_permanent_resident' || value === 'work_visa') {
    return 'Yes'
  }
  if (value === 'needs_sponsorship') return 'No'
  return null
}

export function answerKnownQuestion(
  prompt: string,
  profile: AutoApplyProfile,
  userId?: string,
): AutoApplyQuestion | null {
  const text = normalizePrompt(prompt)
  if (!text) return null

  if (userId) {
    const stored = lookupApprovedAnswer(userId, prompt)
    if (stored?.answer) {
      return { id: stored.normalizedQuestion, prompt, answer: stored.answer, source: 'library' }
    }
  }

  if (/authoriz|work in the united states|legally authorized|eligible to work/.test(text)) {
    const answer = authorizationAnswer(profile.workAuthorization)
    if (!answer) return null
    return { id: 'work-authorization', prompt, answer, source: 'profile' }
  }
  if (/sponsorship|sponsor/.test(text)) {
    return {
      id: 'sponsorship',
      prompt,
      answer: profile.sponsorshipRequired ? 'Yes' : 'No',
      source: 'profile',
    }
  }
  if (/years of experience|how many years/.test(text) && profile.yearsOfExperience != null) {
    return {
      id: 'years-experience',
      prompt,
      answer: String(profile.yearsOfExperience),
      source: 'profile',
    }
  }
  if (/onsite|on site|work onsite|hybrid|remote/.test(text) && profile.preferredWorkArrangement) {
    return {
      id: 'work-arrangement',
      prompt,
      answer: profile.preferredWorkArrangement,
      source: 'profile',
    }
  }
  if (/desired hourly rate|desired salary|compensation|pay rate/.test(text)) {
    if (profile.targetSalaryMin == null && profile.targetSalaryMax == null) return null
    const min = profile.targetSalaryMin
    const max = profile.targetSalaryMax
    const answer = min != null && max != null ? `${min}-${max}` : String(min ?? max)
    return { id: 'compensation', prompt, answer, source: 'profile' }
  }
  if (/availability|start date|when can you start/.test(text)) {
    return null
  }
  if (/full name|legal name/.test(text) && profile.fullName.trim()) {
    return { id: 'full-name', prompt, answer: profile.fullName, source: 'profile' }
  }
  if (/\bemail\b/.test(text) && profile.email.trim()) {
    return { id: 'email', prompt, answer: profile.email, source: 'profile' }
  }
  if (/location|city|where do you live/.test(text) && profile.location.trim()) {
    return { id: 'location', prompt, answer: profile.location, source: 'profile' }
  }
  return null
}

export function resolveApplicationQuestions(
  prompts: string[],
  profile: AutoApplyProfile,
  userId?: string,
): {
  answered: AutoApplyQuestion[]
  unknown: AutoApplyQuestion[]
} {
  const answered: AutoApplyQuestion[] = []
  const unknown: AutoApplyQuestion[] = []
  for (const prompt of prompts) {
    const known = answerKnownQuestion(prompt, profile, userId)
    if (known?.answer) answered.push(known)
    else unknown.push({ id: `unknown-${unknown.length + 1}`, prompt, answer: null, source: 'user' })
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
