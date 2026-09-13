import { categoryForNormalized, displayNameFor, findLexiconTerms, type SkillCategory } from '../match/lexicon'
import { normalizeSkill, textContainsTerm } from '../match/normalize'
import type { JobProfile } from '../match/types'

export type JdBucket =
  | 'technicalSkills'
  | 'languages'
  | 'frameworks'
  | 'cloud'
  | 'databases'
  | 'devops'
  | 'security'
  | 'tools'
  | 'architecture'
  | 'methodologies'
  | 'responsibilities'
  | 'domainKnowledge'
  | 'experienceRequirements'
  | 'education'
  | 'certifications'

export type RequirementKind = 'required' | 'preferred'
export type RequirementFamily = 'skill' | 'responsibility' | 'education' | 'certification' | 'experience' | 'phrase' | 'domain'

export interface JdRequirement {
  name: string
  type: RequirementKind
  category: JdBucket | 'phrase'
  family: RequirementFamily
}

export interface JdCategoryMap {
  technicalSkills: string[]
  languages: string[]
  frameworks: string[]
  cloud: string[]
  databases: string[]
  devops: string[]
  security: string[]
  tools: string[]
  architecture: string[]
  methodologies: string[]
  responsibilities: string[]
  domainKnowledge: string[]
  experienceRequirements: string[]
  education: string[]
  certifications: string[]
}

export interface JdIntelligence {
  required: JdCategoryMap
  preferred: JdCategoryMap
  recruiterPhrases: string[]
  requirements: JdRequirement[]
  targetRole: string
}

const EMPTY_MAP = (): JdCategoryMap => ({
  technicalSkills: [],
  languages: [],
  frameworks: [],
  cloud: [],
  databases: [],
  devops: [],
  security: [],
  tools: [],
  architecture: [],
  methodologies: [],
  responsibilities: [],
  domainKnowledge: [],
  experienceRequirements: [],
  education: [],
  certifications: [],
})

const PREFERRED_RE = /\b(preferred|nice to have|nice-to-have|a plus|plus|bonus|optional|desired)\b/i
const REQUIRED_HEADING = /^(required|minimum qualifications|must have|responsibilities|qualifications|also required)\b/i
const PREFERRED_HEADING = /^(preferred|nice to have|nice-to-have|bonus|optional)\b/i

const PHRASE_PATTERNS = [
  /\bdesign(?:ing)? scalable microservices\b/i,
  /\bdevelop(?:ing)? REST(?:ful)? APIs?\b/i,
  /\bbuild(?:ing)? and maintain(?:ing)? REST(?:ful)? APIs?\b/i,
  /\bCI\/CD(?: pipelines?)?\b/i,
  /\bcloud-native(?: applications?)?\b/i,
  /\bproduction troubleshooting\b/i,
  /\bscalable (?:Java\/)?Spring Boot(?: backend)? services\b/i,
  /\bcontainerize(?:d| applications?)?\b/i,
  /\bpayment(?:s)? (?:APIs?|platforms?)\b/i,
  /\brelational databases?\b/i,
]

const DOMAIN_TERMS = [
  'payments',
  'payment',
  'billing',
  'fintech',
  'healthcare',
  'e-commerce',
  'ecommerce',
  'security operations',
  'observability',
]

function unique(values: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed) continue
    const key = normalizeSkill(trimmed)
    if (!key || seen.has(key)) continue
    seen.add(key)
    result.push(displayNameFor(trimmed) === trimmed ? trimmed : displayNameFor(trimmed) || trimmed)
  }
  return result
}

function bucketForCategory(category: SkillCategory | null): keyof JdCategoryMap {
  if (category === 'language') return 'languages'
  if (category === 'framework' || category === 'library') return 'frameworks'
  if (category === 'cloud') return 'cloud'
  if (category === 'database') return 'databases'
  if (category === 'devops') return 'devops'
  if (category === 'security') return 'security'
  if (category === 'architecture') return 'architecture'
  if (category === 'methodology') return 'methodologies'
  if (category === 'testing' || category === 'tools') return 'tools'
  if (category === 'domain') return 'domainKnowledge'
  if (category === 'frontend') return 'frameworks'
  return 'technicalSkills'
}

function splitSentences(text: string): string[] {
  return text
    .split(/\n+|(?<=[.!?])\s+/)
    .map((item) => item.replace(/^[-•*]\s*/, '').trim())
    .filter((item) => item.length > 0)
}

function headingMode(sentence: string): RequirementKind | null {
  if (PREFERRED_HEADING.test(sentence)) return 'preferred'
  if (REQUIRED_HEADING.test(sentence)) return 'required'
  return null
}

function pushUnique(list: string[], value: string) {
  const name = displayNameFor(value) || value.trim()
  if (!name) return
  if (!list.some((item) => normalizeSkill(item) === normalizeSkill(name))) list.push(name)
}

function extractPhrases(jobText: string): string[] {
  const found: string[] = []
  for (const pattern of PHRASE_PATTERNS) {
    const match = jobText.match(pattern)
    if (match?.[0]) found.push(match[0].replace(/\s+/g, ' ').trim())
  }
  for (const line of splitSentences(jobText)) {
    if (
      /^(develop|design|build|maintain|own|implement|deploy|write|create|manage|containerize)\b/i.test(line) &&
      line.length >= 16 &&
      line.length <= 120 &&
      !/required|preferred|qualifications/i.test(line)
    ) {
      found.push(line.replace(/[.]+$/, ''))
    }
  }
  return unique(found).slice(0, 12)
}

function inferTargetRole(jobText: string, _jobProfile?: JobProfile | null): string {
  const titled = jobText.match(
    /\b((?:senior |staff |principal |lead )?[\w+/]+(?:\s[\w+/]+){0,4}\s(?:engineer|developer|architect|analyst|specialist))\b/i,
  )
  if (titled?.[1]) return titled[1]
  const firstLine = jobText.split(/\n/)[0]?.trim() ?? ''
  if (
    firstLine.length > 8 &&
    firstLine.length < 80 &&
    !/required|preferred|responsib/i.test(firstLine) &&
    /\b(engineer|developer|architect|analyst|specialist)\b/i.test(firstLine)
  ) {
    return firstLine.replace(/[:.]+$/, '')
  }
  return ''
}

export function extractJdIntelligence(jobText: string, jobProfile?: JobProfile | null): JdIntelligence {
  const required = EMPTY_MAP()
  const preferred = EMPTY_MAP()
  const sentences = splitSentences(jobText)
  let mode: RequirementKind = 'required'

  const addTerm = (name: string, kind: RequirementKind, category: SkillCategory | null) => {
    const target = kind === 'preferred' ? preferred : required
    const bucket = bucketForCategory(category)
    pushUnique(target[bucket], name)
    if (bucket !== 'technicalSkills') pushUnique(target.technicalSkills, name)
  }

  for (const sentence of sentences) {
    const heading = headingMode(sentence)
    if (heading) mode = heading
    const preferredSentence = PREFERRED_RE.test(sentence) && !/\brequired\b/i.test(sentence)
    const kind: RequirementKind = preferredSentence || mode === 'preferred' ? 'preferred' : 'required'
    for (const term of findLexiconTerms(sentence)) {
      addTerm(term.name, kind, term.category)
    }
  }

  if (jobProfile) {
    for (const skill of jobProfile.requiredSkills) {
      addTerm(skill.name, 'required', (skill.category as SkillCategory | undefined) ?? categoryForNormalized(normalizeSkill(skill.name)))
    }
    for (const skill of jobProfile.preferredSkills) {
      addTerm(skill.name, 'preferred', (skill.category as SkillCategory | undefined) ?? categoryForNormalized(normalizeSkill(skill.name)))
    }
    for (const item of jobProfile.responsibilities) {
      pushUnique(item.required ? required.responsibilities : preferred.responsibilities, item.text)
    }
    if (jobProfile.yearsOfExperience) {
      pushUnique(required.experienceRequirements, `${jobProfile.yearsOfExperience}+ years of experience`)
    }
    if (jobProfile.education.degree) {
      const label = [jobProfile.education.degree, jobProfile.education.field].filter(Boolean).join(' ')
      pushUnique(jobProfile.education.required ? required.education : preferred.education, label)
    }
    for (const cert of jobProfile.certifications.required) pushUnique(required.certifications, cert)
    for (const cert of jobProfile.certifications.preferred) pushUnique(preferred.certifications, cert)
  }

  const years = jobText.match(/(\d+)\s*\+?\s*years?/i)
  if (years) pushUnique(required.experienceRequirements, `${years[1]}+ years of experience`)
  if (/\bbachelor|b\.s|b\.a|undergraduate/i.test(jobText)) {
    pushUnique(required.education, /computer science/i.test(jobText) ? 'Bachelor Computer Science' : 'Bachelor')
  }
  for (const domain of DOMAIN_TERMS) {
    if (textContainsTerm(jobText, domain)) {
      pushUnique(required.domainKnowledge, domain)
    }
  }

  const recruiterPhrases = extractPhrases(jobText)
  const requirements: JdRequirement[] = []
  const addReq = (name: string, type: RequirementKind, category: JdBucket | 'phrase', family: RequirementFamily) => {
    if (requirements.some((item) => normalizeSkill(item.name) === normalizeSkill(name) && item.family === family)) return
    requirements.push({ name, type, category, family })
  }

  const walk = (map: JdCategoryMap, type: RequirementKind) => {
    for (const [category, values] of Object.entries(map) as Array<[keyof JdCategoryMap, string[]]>) {
      for (const value of values) {
        const family: RequirementFamily =
          category === 'responsibilities'
            ? 'responsibility'
            : category === 'education'
              ? 'education'
              : category === 'certifications'
                ? 'certification'
                : category === 'experienceRequirements'
                  ? 'experience'
                  : category === 'domainKnowledge'
                    ? 'domain'
                    : 'skill'
        addReq(value, type, category, family)
      }
    }
  }
  walk(required, 'required')
  walk(preferred, 'preferred')
  for (const phrase of recruiterPhrases) addReq(phrase, 'required', 'phrase', 'phrase')

  return {
    required,
    preferred,
    recruiterPhrases,
    requirements,
    targetRole: inferTargetRole(jobText, jobProfile),
  }
}
