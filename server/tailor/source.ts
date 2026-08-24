import { allResumeSkills } from '../match/ground'
import { textContainsTerm } from '../match/normalize'
import type { ResumeProfile } from '../match/types'
import type { SourceFacts, SourceRole, TailoredEducation } from './types'

const DATE_RE = /\b(?:19|20)\d{2}\b|\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b|\bpresent\b|\bcurrent\b/gi
const NUMBER_RE = /\d+(?:\.\d+)?%|\$\d[\d,]*(?:\.\d+)?|\b\d+\+?\s*(?:years?|engineers?|people|customers?|users?|teams?)\b|\b(?:19|20)\d{2}\b/gi

export function extractDates(text: string): string[] {
  return [...new Set((text.match(DATE_RE) ?? []).map((item) => item.toLowerCase()))]
}

export function extractNumbers(text: string): string[] {
  return [...new Set((text.match(NUMBER_RE) ?? []).map((item) => item.toLowerCase()))]
}

export function parseSourceRoles(resumeText: string): SourceRole[] {
  const lines = resumeText.split(/\r?\n/).map((line) => line.trim())
  const roles: SourceRole[] = []
  let current: SourceRole | null = null

  const header = /^(.+?)(?:,\s+|\s+[—–-]\s+|\s+at\s+)(.+?)(?:\s+[—–-]\s+|\s+\(|,\s+)(.+?)\s*\)?$/i

  for (const line of lines) {
    if (!line) continue
    if (/^(summary|skills|education|certifications|projects|experience)\b/i.test(line) && line.length < 40) {
      current = null
      continue
    }
    if (/^[-•*]/.test(line) && current) {
      current.bullets.push(line.replace(/^[-•*]\s*/, '').trim())
      continue
    }
    const match = line.match(header)
    if (match && /(?:19|20)\d{2}|present|current/i.test(line)) {
      current = {
        title: match[1].trim(),
        company: match[2].trim(),
        dates: match[3].trim(),
        bullets: [],
      }
      roles.push(current)
    }
  }
  return roles
}

function sectionBody(resumeText: string, name: string): string {
  const pattern = new RegExp(
    `^${name}\\s*\\n([\\s\\S]*?)(?=\\n(?:summary|skills|education|certifications|projects|experience)\\b|$)`,
    'im',
  )
  return resumeText.match(pattern)?.[1]?.trim() ?? ''
}

function educationFromText(resumeText: string): TailoredEducation[] {
  const body = sectionBody(resumeText, 'education')
  if (!body) return []
  return body
    .split(/\n+/)
    .map((line) => line.replace(/^[-•*]\s*/, '').trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(',').map((part) => part.trim()).filter(Boolean)
      return {
        degree: parts[0] ?? line,
        field: parts[1] ?? '',
        details: line,
      }
    })
}

function namedLines(resumeText: string, name: string): string[] {
  return sectionBody(resumeText, name)
    .split(/[\n,;]/)
    .map((line) => line.replace(/^[-•*]\s*/, '').trim())
    .filter((line) => line && line.length < 80)
}

export function collectSourceFacts(resumeText: string, profile: ResumeProfile | null): SourceFacts {
  const roles = parseSourceRoles(resumeText)
  const skillSet = new Set<string>()
  for (const item of profile ? allResumeSkills(profile) : []) {
    if (item.name.trim()) skillSet.add(item.name.trim())
  }
  const skillsBlock = sectionBody(resumeText, 'skills') || resumeText.match(/skills\n([\s\S]*?)(?:\n\n|education|certifications|projects|$)/i)?.[1]
  if (skillsBlock) {
    for (const part of skillsBlock.split(/[,;\n]/)) {
      const name = part.replace(/^[-•*]\s*/, '').trim()
      if (name && name.length < 48) skillSet.add(name)
    }
  }
  for (const role of roles) {
    for (const bullet of role.bullets) {
      for (const token of bullet.split(/[,/;|]/)) {
        const name = token.replace(/\.$/, '').trim()
        if (
          name &&
          name.length < 28 &&
          name.split(/\s+/).length <= 3 &&
          !/^(developed|built|worked|owned|supported|shipped|reduced|created|implemented)\b/i.test(name) &&
          textContainsTerm(resumeText, name)
        ) {
          skillSet.add(name)
        }
      }
    }
  }

  const education = (profile?.education ?? []).length
    ? (profile?.education ?? []).map((item) => ({
        degree: item.degree,
        field: item.field,
        details: item.evidence || [item.degree, item.field].filter(Boolean).join(', '),
      }))
    : educationFromText(resumeText)

  const certifications = unique([
    ...(profile?.certifications ?? []).map((item) => item.name),
    ...namedLines(resumeText, 'certifications'),
  ]).filter((item) => textContainsTerm(resumeText, item))

  const projects = unique([
    ...(profile?.projects ?? []).map((item) => item.name),
    ...namedLines(resumeText, 'projects'),
  ]).filter((item) => textContainsTerm(resumeText, item))

  return {
    text: resumeText,
    skills: [...skillSet],
    employers: unique([
      ...(profile?.employers ?? []),
      ...roles.map((role) => role.company),
    ]).filter((item) => textContainsTerm(resumeText, item)),
    titles: unique([
      ...(profile?.jobTitles ?? []),
      ...roles.map((role) => role.title),
    ]).filter((item) => textContainsTerm(resumeText, item)),
    certifications,
    projects,
    education,
    roles,
    dates: extractDates(resumeText),
    numbers: extractNumbers(resumeText),
  }
}

function unique(values: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(trimmed)
  }
  return result
}

export function extractContact(resumeText: string): { name: string; email: string; location: string } {
  const lines = resumeText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const email = resumeText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? ''
  const name = lines[0] && !lines[0].includes('@') && lines[0].length < 80 ? lines[0] : ''
  const location = lines.find((line) => line !== name && line !== email && /,\s*[A-Z]{2}\b|remote/i.test(line)) ?? ''
  return { name, email, location }
}

export function supportedInSource(term: string, source: SourceFacts): boolean {
  if (!term.trim()) return false
  if (textContainsTerm(source.text, term)) return true
  return source.skills.some((skill) => textContainsTerm(skill, term) || textContainsTerm(term, skill))
}
