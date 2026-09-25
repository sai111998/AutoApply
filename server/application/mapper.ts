import { lookupApprovedAnswer } from './answers'
import { verifiedSkillYears, type CandidateApplicationProfile } from './profile'
import type { AutoApplyQuestion } from '../apply/types'

export interface MappedApplicationQuestion {
  question: string
  field: string | null
  answer: string | null
  source: AutoApplyQuestion['source']
  needsUserInput: boolean
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function authorizationAnswer(value: string | null): string | null {
  if (value === 'us_citizen' || value === 'us_permanent_resident' || value === 'work_visa') return 'Yes'
  if (value === 'needs_sponsorship') return 'No'
  return null
}

const YEAR_QUESTION_STOP = new Set(['do', 'have', 'experience', 'work', 'your', 'the', 'a', 'an', 'of', 'in', 'with'])

function skillMentionedInYearsQuestion(text: string, profile: CandidateApplicationProfile): string | null {
  if (!/years/.test(text)) return null
  const items = [
    ...profile.skills.languages,
    ...profile.skills.frameworks,
    ...profile.skills.cloud,
    ...profile.skills.databases,
    ...profile.skills.tools,
  ]
  const known = items
    .map((item) => item.name.trim().toLowerCase())
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)
  const mentioned = known.find((name) => text.includes(name))
  if (mentioned) return mentioned
  const captured = text.match(/how many years(?: of)?(?: experience)?(?: with| in| of)? ([a-z0-9.+#]+)/i)?.[1]
  if (!captured || YEAR_QUESTION_STOP.has(captured)) return null
  return captured
}

export function applicationQuestionMapper(
  question: string,
  profile: CandidateApplicationProfile,
  userId?: string,
): MappedApplicationQuestion {
  const text = normalize(question)
  const empty = (field: string | null, needsUserInput = true): MappedApplicationQuestion => ({
    question,
    field,
    answer: null,
    source: 'user',
    needsUserInput,
  })

  if (userId) {
    const stored = lookupApprovedAnswer(userId, question)
    if (stored?.answer) {
      return {
        question,
        field: stored.normalizedQuestion,
        answer: stored.answer,
        source: 'library',
        needsUserInput: false,
      }
    }
  }

  if (/authoriz|work in the united states|legally authorized|eligible to work/.test(text)) {
    const answer = authorizationAnswer(profile.employment.workAuthorization)
    if (!answer) return empty('workAuthorization')
    return { question, field: 'workAuthorization', answer, source: 'profile', needsUserInput: false }
  }
  if (/sponsorship|sponsor/.test(text)) {
    return {
      question,
      field: 'sponsorship',
      answer: profile.employment.sponsorshipRequired ? 'Yes' : 'No',
      source: 'profile',
      needsUserInput: false,
    }
  }
  if (/relocat/.test(text)) return empty('relocation')
  if (/travel/.test(text)) return empty('travel')
  if (/availability|start date|when can you start/.test(text)) return empty('availability')
  if (/desired hourly rate|desired salary|compensation|pay rate|salary/.test(text)) {
    if (profile.preferences.salaryMin == null && profile.preferences.salaryMax == null) return empty('salary')
    const answer = [profile.preferences.salaryMin, profile.preferences.salaryMax].filter((item) => item != null).join('-')
    return { question, field: 'salary', answer, source: 'profile', needsUserInput: false }
  }
  const skillName = skillMentionedInYearsQuestion(text, profile)
  if (skillName) {
    const years = verifiedSkillYears(profile, skillName)
    if (years == null) return empty('skillYears')
    return { question, field: 'skillYears', answer: String(years), source: 'profile', needsUserInput: false }
  }
  if (/years of experience|how many years/.test(text) && !skillName) {
    if (profile.employment.yearsOfExperience == null) return empty('yearsExperience')
    return {
      question,
      field: 'yearsExperience',
      answer: String(profile.employment.yearsOfExperience),
      source: 'profile',
      needsUserInput: false,
    }
  }
  if (/first name|given name/.test(text) && profile.identity.firstName) {
    return { question, field: 'firstName', answer: profile.identity.firstName, source: 'profile', needsUserInput: false }
  }
  if (/last name|family name|surname/.test(text) && profile.identity.lastName) {
    return { question, field: 'lastName', answer: profile.identity.lastName, source: 'profile', needsUserInput: false }
  }
  if (/full name|legal name/.test(text) && profile.identity.fullName) {
    return { question, field: 'fullName', answer: profile.identity.fullName, source: 'profile', needsUserInput: false }
  }
  if (/\bemail\b/.test(text) && profile.contact.email) {
    return { question, field: 'email', answer: profile.contact.email, source: 'profile', needsUserInput: false }
  }
  if (/\bphone\b|\bmobile\b/.test(text) && profile.contact.phone) {
    return { question, field: 'phone', answer: profile.contact.phone, source: 'profile', needsUserInput: false }
  }
  if (/linkedin/.test(text) && profile.professional.linkedin) {
    return { question, field: 'linkedin', answer: profile.professional.linkedin, source: 'profile', needsUserInput: false }
  }
  if (/github/.test(text) && profile.professional.github) {
    return { question, field: 'github', answer: profile.professional.github, source: 'profile', needsUserInput: false }
  }
  if (/location|city|where do you live/.test(text) && (profile.location.city || profile.location.raw)) {
    return {
      question,
      field: 'city',
      answer: profile.location.city || profile.location.raw,
      source: 'profile',
      needsUserInput: false,
    }
  }
  if (/onsite|on site|work onsite|hybrid|remote/.test(text) && profile.preferences.remotePreference) {
    return {
      question,
      field: 'remotePreference',
      answer: profile.preferences.remotePreference,
      source: 'profile',
      needsUserInput: false,
    }
  }
  return empty(null)
}

export function mapApplicationQuestions(
  questions: string[],
  profile: CandidateApplicationProfile,
  userId?: string,
): { answered: AutoApplyQuestion[]; unknown: AutoApplyQuestion[]; mappings: MappedApplicationQuestion[] } {
  const mappings = questions.map((question) => applicationQuestionMapper(question, profile, userId))
  const answered: AutoApplyQuestion[] = []
  const unknown: AutoApplyQuestion[] = []
  for (const mapped of mappings) {
    const item: AutoApplyQuestion = {
      id: mapped.field || mapped.question,
      prompt: mapped.question,
      answer: mapped.answer,
      source: mapped.source,
    }
    if (mapped.answer) answered.push(item)
    else unknown.push(item)
  }
  return { answered, unknown, mappings }
}
