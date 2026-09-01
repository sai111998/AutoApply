import { emptyJobProfile, emptyResumeProfile } from './ground'
import {
  ACTION_VERBS,
  type FoundTerm,
  type SkillCategory,
  findLexiconTerms,
} from './lexicon'
import { normalizeSkill } from './normalize'
import type { EvidenceItem, JobProfile, JobSkill, ResumeProfile } from './types'

export interface ResumeEvidenceItem {
  skill?: string
  technology?: string
  responsibility?: string
  action?: string
  context?: string
  source: string
  evidence: string
}

const PREFERRED_RE = /\b(preferred|nice to have|nice-to-have|a plus|plus|bonus|optional|desired)\b/i
const REQUIRED_RE = /\b(required|must have|must-have|mandatory|minimum qualifications|you will|responsibilities)\b/i
const YEARS_RE = /(\d+)\s*\+?\s*years?/i

function uniqueEvidence(items: EvidenceItem[]): EvidenceItem[] {
  const seen = new Set<string>()
  const result: EvidenceItem[] = []
  for (const item of items) {
    const key = normalizeSkill(item.name)
    if (!key || seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }
  return result
}

function uniqueJobSkills(items: JobSkill[]): JobSkill[] {
  const seen = new Set<string>()
  const result: JobSkill[] = []
  for (const item of items) {
    const key = normalizeSkill(item.name)
    if (!key || seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }
  return result
}

function snippetAround(text: string, index: number, matched: string): string {
  const start = Math.max(0, text.lastIndexOf('\n', index))
  const endProbe = text.indexOf('\n', index + matched.length)
  const end = endProbe === -1 ? Math.min(text.length, index + 220) : endProbe
  return text.slice(start, end).replace(/^[-•*\s]+/, '').replace(/\s+/g, ' ').trim().slice(0, 220)
}

function splitSentences(text: string): string[] {
  return text
    .split(/\n+|(?<=[.!?])\s+/)
    .map((item) => item.replace(/^[-•*]\s*/, '').trim())
    .filter((item) => item.length > 0)
}

function headingMode(sentence: string): 'required' | 'preferred' | null {
  if (/^(preferred|nice to have|nice-to-have|bonus|optional)\b/i.test(sentence)) return 'preferred'
  if (/^(required|minimum qualifications|must have|responsibilities|qualifications|also required)\b/i.test(sentence)) {
    return 'required'
  }
  return null
}

function isPreferredSentence(sentence: string): boolean {
  return PREFERRED_RE.test(sentence) && !/\brequired\b/i.test(sentence)
}

function isRequiredSentence(sentence: string): boolean {
  return REQUIRED_RE.test(sentence) && !isPreferredSentence(sentence)
}

function bucketForCategory(category: SkillCategory): keyof Pick<
  ResumeProfile,
  'languages' | 'frameworks' | 'cloud' | 'databases' | 'devops' | 'security' | 'skills'
> {
  if (category === 'language') return 'languages'
  if (category === 'framework' || category === 'library' || category === 'architecture') return 'frameworks'
  if (category === 'cloud') return 'cloud'
  if (category === 'database') return 'databases'
  if (category === 'devops' || category === 'testing' || category === 'tools') return 'devops'
  if (category === 'security') return 'security'
  return 'skills'
}

function jobBucket(category: SkillCategory): keyof Pick<
  JobProfile,
  'languages' | 'frameworks' | 'cloud' | 'databases' | 'tools' | 'security'
> {
  if (category === 'language') return 'languages'
  if (category === 'framework' || category === 'library' || category === 'architecture') return 'frameworks'
  if (category === 'cloud') return 'cloud'
  if (category === 'database') return 'databases'
  if (category === 'security') return 'security'
  return 'tools'
}

function actionFromLine(line: string): string {
  const first = line.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, '') ?? ''
  return ACTION_VERBS.includes(first) ? first : ''
}

export function extractResumeEvidence(resumeText: string): ResumeEvidenceItem[] {
  const items: ResumeEvidenceItem[] = []
  const lines = resumeText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  let section = 'summary'
  let context = ''

  for (const line of lines) {
    if (/^(summary|skills|experience|education|certifications|projects)\b/i.test(line) && line.length < 40) {
      section = line.split(/\s+/)[0].toLowerCase()
      continue
    }
    const header = line.match(/^(.+?)(?:,\s+|\s+[—–-]\s+|\s+at\s+)(.+?)(?:\s+[—–-]\s+|\s+\(|,\s+)(.+?)\s*\)?$/i)
    if (header && /(?:19|20)\d{2}|present|current/i.test(line)) {
      context = header[2].trim()
      section = 'experience'
      continue
    }

    const terms = findLexiconTerms(line)
    const bullet = /^[-•*]/.test(line) || actionFromLine(line.replace(/^[-•*]\s*/, ''))
    const cleaned = line.replace(/^[-•*]\s*/, '')
    if (terms.length) {
      for (const term of terms) {
        items.push({
          skill: term.name,
          technology: term.name,
          responsibility: bullet ? cleaned : undefined,
          action: actionFromLine(cleaned),
          context: context || section,
          source: context || section,
          evidence: cleaned,
        })
      }
    } else if (bullet && cleaned.length > 20) {
      items.push({
        responsibility: cleaned,
        action: actionFromLine(cleaned),
        context: context || section,
        source: context || section,
        evidence: cleaned,
      })
    }
  }
  return items
}

function yearsFromText(text: string): number | null {
  const explicit = text.match(YEARS_RE)
  if (explicit) return Number(explicit[1])
  const years = [...text.matchAll(/\b((?:19|20)\d{2})\b/g)].map((item) => Number(item[1]))
  if (!years.length) return null
  const min = Math.min(...years)
  const now = new Date().getFullYear()
  const max = /\bpresent\b|\bcurrent\b/i.test(text) ? Math.max(...years, now) : Math.max(...years)
  if (max >= min && max - min <= 40) return Math.max(1, max - min)
  return null
}

export function extractResumeLocal(resumeText: string): ResumeProfile {
  const profile = emptyResumeProfile()
  const terms = findLexiconTerms(resumeText)
  const evidence = extractResumeEvidence(resumeText)

  for (const term of terms) {
    const quote = snippetAround(resumeText, term.index, term.matched)
    const item: EvidenceItem = { name: term.name, evidence: quote || term.name, category: term.category }
    const bucket = bucketForCategory(term.category)
    profile[bucket] = [...profile[bucket], item]
    if (bucket !== 'skills') profile.skills = [...profile.skills, item]
  }

  profile.skills = uniqueEvidence(profile.skills)
  profile.languages = uniqueEvidence(profile.languages)
  profile.frameworks = uniqueEvidence(profile.frameworks)
  profile.cloud = uniqueEvidence(profile.cloud)
  profile.databases = uniqueEvidence(profile.databases)
  profile.devops = uniqueEvidence(profile.devops)
  profile.security = uniqueEvidence(profile.security)

  const roles: string[] = []
  const employers: string[] = []
  for (const line of resumeText.split(/\r?\n/)) {
    const header = line.match(/^(.+?)(?:,\s+|\s+[—–-]\s+|\s+at\s+)(.+?)(?:\s+[—–-]\s+|\s+\(|,\s+)(.+?)\s*\)?$/i)
    if (header && /(?:19|20)\d{2}|present|current/i.test(line)) {
      roles.push(header[1].trim())
      employers.push(header[2].trim())
    }
  }
  profile.jobTitles = [...new Set(roles)]
  profile.employers = [...new Set(employers)]
  profile.yearsOfExperience = yearsFromText(resumeText)

  profile.responsibilities = uniqueEvidence(
    evidence
      .filter((item) => item.responsibility)
      .map((item) => ({
        name: item.responsibility || item.evidence,
        evidence: item.evidence,
      })),
  )

  const educationBody = resumeText.match(/^education\s*\n([\s\S]*?)(?=\n(?:summary|skills|certifications|projects|experience)\b|$)/im)?.[1]
  if (educationBody) {
    profile.education = educationBody
      .split(/\n+/)
      .map((line) => line.replace(/^[-•*]\s*/, '').trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split(',').map((part) => part.trim())
        return { degree: parts[0] ?? line, field: parts[1] ?? '', evidence: line }
      })
  }

  const certBody = resumeText.match(/^certifications\s*\n([\s\S]*?)(?=\n(?:summary|skills|education|projects|experience)\b|$)/im)?.[1]
  if (certBody) {
    profile.certifications = uniqueEvidence(
      certBody
        .split(/[\n,;]/)
        .map((line) => line.replace(/^[-•*]\s*/, '').trim())
        .filter((line) => line && line.length < 80)
        .map((name) => ({ name, evidence: name })),
    )
  }

  const projectBody = resumeText.match(/^projects\s*\n([\s\S]*?)(?=\n(?:summary|skills|education|certifications|experience)\b|$)/im)?.[1]
  if (projectBody) {
    profile.projects = uniqueEvidence(
      projectBody
        .split(/\n+/)
        .map((line) => line.replace(/^[-•*]\s*/, '').trim())
        .filter((line) => line && line.length < 80)
        .map((name) => ({ name, evidence: name })),
    )
  }

  const locationLine = resumeText.split(/\n/).find((line) => /,\s*[A-Z]{2}\b|remote/i.test(line) && !line.includes('@'))
  profile.location = locationLine?.trim() ?? ''
  return profile
}

function responsibilitiesFromJob(jobText: string): JobProfile['responsibilities'] {
  const lines = jobText.split(/\r?\n/).map((line) => line.replace(/^[-•*]\s*/, '').trim()).filter(Boolean)
  const fromBullets = lines.filter((line) => {
    const verb = actionFromLine(line)
    return verb || /^(build|develop|design|maintain|own|implement|deploy)\b/i.test(line)
  })
  const sentences = splitSentences(jobText).filter((sentence) =>
    /^(build|develop|design|maintain|own|implement|deploy|write|create|manage)\b/i.test(sentence),
  )
  const combined = [...fromBullets, ...sentences]
  const seen = new Set<string>()
  const result: JobProfile['responsibilities'] = []
  for (const text of combined) {
    if (text.length < 12 || text.length > 220) continue
    const key = text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push({ text, required: !isPreferredSentence(text) })
  }
  return result
}

export function extractJobLocal(jobText: string): JobProfile {
  const profile = emptyJobProfile()
  profile.yearsOfExperience = (() => {
    const match = jobText.match(YEARS_RE)
    return match ? Number(match[1]) : null
  })()

  const sentences = splitSentences(jobText)
  const required: JobSkill[] = []
  const preferred: JobSkill[] = []
  let mode: 'required' | 'preferred' = 'required'

  const add = (term: FoundTerm, list: JobSkill[]) => {
    list.push({ name: term.name, category: term.category })
  }

  for (const sentence of sentences) {
    const heading = headingMode(sentence)
    if (heading) mode = heading
    const terms = findLexiconTerms(sentence)
    const preferredSentence = isPreferredSentence(sentence) || (mode === 'preferred' && !isRequiredSentence(sentence))
    for (const term of terms) {
      if (preferredSentence) add(term, preferred)
      else add(term, required)
      const bucket = jobBucket(term.category)
      profile[bucket] = [...profile[bucket], { name: term.name, category: term.category }]
    }
  }

  // Whole-document fallback so isolated keywords are not dropped.
  if (!required.length && !preferred.length) {
    for (const term of findLexiconTerms(jobText)) required.push({ name: term.name, category: term.category })
  }

  profile.requiredSkills = uniqueJobSkills(required)
  profile.preferredSkills = uniqueJobSkills(preferred).filter(
    (item) => !profile.requiredSkills.some((req) => normalizeSkill(req.name) === normalizeSkill(item.name)),
  )
  profile.languages = uniqueJobSkills(profile.languages)
  profile.frameworks = uniqueJobSkills(profile.frameworks)
  profile.cloud = uniqueJobSkills(profile.cloud)
  profile.databases = uniqueJobSkills(profile.databases)
  profile.tools = uniqueJobSkills(profile.tools)
  profile.security = uniqueJobSkills(profile.security)
  profile.responsibilities = responsibilitiesFromJob(jobText)

  if (/\bbachelor|b\.s|b\.a|undergraduate/i.test(jobText)) {
    profile.education = {
      required: /\brequired|must\b/i.test(jobText),
      degree: 'Bachelor',
      field: /computer science/i.test(jobText) ? 'Computer Science' : '',
      details: '',
    }
  } else if (/\bmaster|m\.s|m\.a\b/i.test(jobText)) {
    profile.education = {
      required: /\brequired|must\b/i.test(jobText),
      degree: 'Master',
      field: /computer science/i.test(jobText) ? 'Computer Science' : '',
      details: '',
    }
  }

  return profile
}

function mergeEvidenceLists(primary: EvidenceItem[], extra: EvidenceItem[]): EvidenceItem[] {
  const result = [...primary]
  for (const item of extra) {
    const existing = result.find((row) => normalizeSkill(row.name) === normalizeSkill(item.name))
    if (!existing) {
      result.push(item)
      continue
    }
    if ((item.evidence?.length ?? 0) > (existing.evidence?.length ?? 0)) existing.evidence = item.evidence
    if (existing.years == null && item.years != null) existing.years = item.years
    if (!existing.category && item.category) existing.category = item.category
  }
  return uniqueEvidence(result)
}

function mergeJobSkillLists(primary: JobSkill[], extra: JobSkill[]): JobSkill[] {
  return uniqueJobSkills([...primary, ...extra])
}

export function mergeResumeProfiles(primary: ResumeProfile, extra: ResumeProfile): ResumeProfile {
  return {
    ...primary,
    skills: mergeEvidenceLists(primary.skills, extra.skills),
    languages: mergeEvidenceLists(primary.languages, extra.languages),
    frameworks: mergeEvidenceLists(primary.frameworks, extra.frameworks),
    cloud: mergeEvidenceLists(primary.cloud, extra.cloud),
    databases: mergeEvidenceLists(primary.databases, extra.databases),
    devops: mergeEvidenceLists(primary.devops, extra.devops),
    security: mergeEvidenceLists(primary.security, extra.security),
    jobTitles: [...new Set([...primary.jobTitles, ...extra.jobTitles])],
    employers: [...new Set([...primary.employers, ...extra.employers])],
    yearsOfExperience: primary.yearsOfExperience ?? extra.yearsOfExperience,
    education: primary.education.length ? primary.education : extra.education,
    certifications: mergeEvidenceLists(primary.certifications, extra.certifications),
    projects: mergeEvidenceLists(primary.projects, extra.projects),
    responsibilities: mergeEvidenceLists(primary.responsibilities, extra.responsibilities),
    achievements: mergeEvidenceLists(primary.achievements, extra.achievements),
    location: primary.location || extra.location,
    workArrangement: primary.workArrangement || extra.workArrangement,
    workAuthorization: primary.workAuthorization || extra.workAuthorization,
  }
}

export function mergeJobProfiles(primary: JobProfile, extra: JobProfile): JobProfile {
  const required = mergeJobSkillLists(primary.requiredSkills, extra.requiredSkills)
  const preferred = mergeJobSkillLists(primary.preferredSkills, extra.preferredSkills).filter(
    (item) => !required.some((req) => normalizeSkill(req.name) === normalizeSkill(item.name)),
  )
  return {
    ...primary,
    requiredSkills: required,
    preferredSkills: preferred,
    languages: mergeJobSkillLists(primary.languages, extra.languages),
    frameworks: mergeJobSkillLists(primary.frameworks, extra.frameworks),
    cloud: mergeJobSkillLists(primary.cloud, extra.cloud),
    databases: mergeJobSkillLists(primary.databases, extra.databases),
    tools: mergeJobSkillLists(primary.tools, extra.tools),
    security: mergeJobSkillLists(primary.security, extra.security),
    yearsOfExperience: primary.yearsOfExperience ?? extra.yearsOfExperience,
    skillYears: primary.skillYears.length ? primary.skillYears : extra.skillYears,
    education: {
      required: primary.education.required || extra.education.required,
      degree: primary.education.degree || extra.education.degree,
      field: primary.education.field || extra.education.field,
      details: primary.education.details || extra.education.details,
    },
    certifications: {
      required: [...new Set([...primary.certifications.required, ...extra.certifications.required])],
      preferred: [...new Set([...primary.certifications.preferred, ...extra.certifications.preferred])],
    },
    location: primary.location || extra.location,
    workArrangement: primary.workArrangement || extra.workArrangement,
    employmentType: primary.employmentType || extra.employmentType,
    sponsorship: primary.sponsorship || extra.sponsorship,
    responsibilities: primary.responsibilities.length
      ? [
          ...primary.responsibilities,
          ...extra.responsibilities.filter(
            (item) => !primary.responsibilities.some((row) => row.text.toLowerCase() === item.text.toLowerCase()),
          ),
        ]
      : extra.responsibilities,
  }
}

export function enrichResumeWithLocal(profile: ResumeProfile, resumeText: string): ResumeProfile {
  return mergeResumeProfiles(profile, extractResumeLocal(resumeText))
}

export function enrichJobWithLocal(profile: JobProfile, jobText: string): JobProfile {
  return mergeJobProfiles(profile, extractJobLocal(jobText))
}

export function skillNamesInText(text: string): string[] {
  return findLexiconTerms(text).map((item) => item.name)
}
