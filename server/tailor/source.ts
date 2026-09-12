import { allResumeSkills } from '../match/ground'
import { findLexiconTerms } from '../match/lexicon'
import { normalizeSkill, textContainsTerm } from '../match/normalize'
import type { ResumeProfile } from '../match/types'
import type { SourceFacts, SourceRole, TailoredEducation, TailoredResume } from './types'

const DATE_RE = /\b(?:19|20)\d{2}\b|\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b|\bpresent\b|\bcurrent\b/gi
const NUMBER_RE = /\d+(?:\.\d+)?%|\$\d[\d,]*(?:\.\d+)?|\b\d+\+?\s*(?:years?|engineers?|people|customers?|users?|teams?)\b|\b(?:19|20)\d{2}\b/gi
const MONTH = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'
const YEAR = '(?:19|20)\\d{2}'
const DATE_START = `(?:${MONTH}\\s+${YEAR}|${YEAR}|(?:0?[1-9]|1[0-2])\\/${YEAR})`
const DATE_END = `(?:present|current|${MONTH}\\s+${YEAR}|${YEAR})`
const DATE_RANGE_RE = new RegExp(`${DATE_START}\\s*(?:[-–—]|to)\\s*${DATE_END}`, 'i')
const SECTION_NEXT =
  'professional\\s+summary|summary|objective|profile|technical\\s+skills|core\\s+competencies|skills|work\\s+experience|professional\\s+experience|employment(?:\\s+history)?|work\\s+history|experience|education|academic\\s+background|certifications?|licenses|projects|awards'
const SECTION_HEADING_RE = new RegExp(`^(?:${SECTION_NEXT})\\s*:?$`, 'i')
const JOB_TITLE_RE =
  /\b(engineer|developer|manager|analyst|intern|consultant|architect|specialist|scientist|designer|administrator|director|officer|associate|programmer|sre|devops|coordinator|technician|principal|staff|founder|owner|fellow|lead|head of|vice president|\bvp\b|ceo|cto|cfo)\b/i
const COMPANY_RE =
  /\b(inc\.?|llc|ltd\.?|corp\.?|corporation|university|college|labs?|systems|technologies|solutions|group|services|gmbh|plc|company|studios?)\b/i
const KNOWN_COMPANY_RE =
  /^(amazon|aws|google|microsoft|meta|facebook|apple|ibm|oracle|salesforce|netflix|uber|airbnb|tesla|nvidia|intel|adobe|jpmorgan|jp morgan|capital one|goldman|deloitte|accenture)\b/i
const EDUCATION_LINE_RE =
  /\b(bachelor|master|b\.s\.?|m\.s\.?|b\.a\.?|m\.a\.?|ph\.?d|mba|associate'?s|high school|gpa|cum laude|university|college)\b/i
const ACTION_LINE_RE =
  /^(developed|designed|implemented|built|integrated|automated|deployed|optimized|tested|migrated|configured|maintained|owned|created|shipped|supported|reduced|used|led|managed|collaborated|wrote|improved|delivered|engineered|architected|investigated|performed|provided|ensured|participated|worked)\b/i

export function extractDates(text: string): string[] {
  return [...new Set((text.match(DATE_RE) ?? []).map((item) => item.toLowerCase()))]
}

export function extractNumbers(text: string): string[] {
  return [...new Set((text.match(NUMBER_RE) ?? []).map((item) => item.toLowerCase()))]
}

export function isSectionHeading(line: string): boolean {
  return line.length < 48 && SECTION_HEADING_RE.test(line.trim())
}

export function isLocationLine(line: string): boolean {
  const value = line.trim()
  if (!value || value.includes('@') || value.length > 60) return false
  if (/^remote\b/i.test(value)) return true
  return /^[A-Za-z .'-]+,\s*[A-Z]{2}(?:\s+\d{5}(?:-\d{4})?)?$/.test(value)
}

function looksLikeJobTitle(line: string): boolean {
  return JOB_TITLE_RE.test(line) && line.length < 90
}

function looksLikeCompany(line: string): boolean {
  return (COMPANY_RE.test(line) || KNOWN_COMPANY_RE.test(line)) && line.length < 90
}

function looksLikeEducationLine(line: string): boolean {
  return EDUCATION_LINE_RE.test(line) && !looksLikeJobTitle(line)
}

function containsDateRange(line: string): boolean {
  return DATE_RANGE_RE.test(line) || /\((?:19|20)\d{2}\s*[-–—]\s*(?:present|current|(?:19|20)\d{2})\)/i.test(line)
}

function extractDateRange(line: string): string {
  return (
    line.match(DATE_RANGE_RE)?.[0] ??
    line.match(/\((?:19|20)\d{2}\s*[-–—]\s*(?:present|current|(?:19|20)\d{2})\)/i)?.[0] ??
    ''
  )
}

function isBullet(line: string): boolean {
  return /^[-•*●◦▪–—]\s+/.test(line) || /^\d+[.)]\s+/.test(line)
}

function bulletText(line: string): string {
  return line.replace(/^[-•*●◦▪–—]\s+/, '').replace(/^\d+[.)]\s+/, '').trim()
}

function expandResumeLines(resumeText: string): string[] {
  const raw = resumeText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const lines: string[] = []
  for (const line of raw) {
    if (line.length < 140) {
      lines.push(line)
      continue
    }
    const pieces = line
      .split(
        /(?=\s[-•*●◦▪]\s)|(?=\b(?:professional summary|technical skills|core competencies|work experience|professional experience|education|certifications|projects)\b)/i,
      )
      .map((item) => item.trim())
      .filter(Boolean)
    if (pieces.length > 1) lines.push(...pieces)
    else lines.push(line)
  }
  return lines
}

function parseInlineRole(line: string): SourceRole | null {
  if (line.includes('|')) {
    const parts = line.split('|').map((part) => part.trim()).filter(Boolean)
    if (parts.length >= 2 && (containsDateRange(line) || parts.some((part) => containsDateRange(part)))) {
      const datePart = parts.find((part) => containsDateRange(part)) ?? extractDateRange(line)
      const others = parts.filter((part) => part !== datePart)
      let title = others[0] ?? ''
      let company = others[1] ?? ''
      if (others.length >= 2 && looksLikeCompany(others[0]) && looksLikeJobTitle(others[1])) {
        company = others[0]
        title = others[1]
      }
      return { title, company, dates: datePart || extractDateRange(line), bullets: [] }
    }
  }

  const header = line.match(/^(.+?)(?:,\s+|\s+[—–-]\s+|\s+at\s+)(.+?)(?:\s+[—–-]\s+|\s+\(|,\s+)(.+?)\s*\)?$/i)
  if (header && /(?:19|20)\d{2}|present|current/i.test(line)) {
    return {
      title: header[1].trim(),
      company: header[2].trim(),
      dates: header[3].trim(),
      bullets: [],
    }
  }

  const at = line.match(/^(.+?)\s+at\s+(.+)$/i)
  if (at && containsDateRange(line)) {
    const dates = extractDateRange(line)
    return {
      title: at[1].trim(),
      company: at[2].replace(dates, '').replace(/[|—–-]/g, ' ').trim(),
      dates,
      bullets: [],
    }
  }

  return null
}

function assignTitleCompany(lines: string[]): { title: string; company: string } {
  if (lines.length === 1) {
    if (looksLikeJobTitle(lines[0]) || !looksLikeCompany(lines[0])) return { title: lines[0], company: '' }
    return { title: '', company: lines[0] }
  }
  const first = lines[lines.length - 2]
  const second = lines[lines.length - 1]
  if (looksLikeJobTitle(first) && !looksLikeJobTitle(second)) return { title: first, company: second }
  if (looksLikeJobTitle(second) && !looksLikeJobTitle(first)) return { title: second, company: first }
  if (looksLikeCompany(first) && !looksLikeCompany(second)) return { title: second, company: first }
  if (looksLikeCompany(second) && !looksLikeCompany(first)) return { title: first, company: second }
  return { title: second, company: first }
}

function parseRoleLines(
  lines: string[],
  options: { initialSection?: string; respectSections?: boolean } = {},
): SourceRole[] {
  const roles: SourceRole[] = []
  let current: SourceRole | null = null
  let pending: string[] = []
  let section = options.initialSection ?? ''
  const respectSections = options.respectSections !== false

  const startRole = (role: SourceRole): SourceRole => {
    roles.push(role)
    pending = []
    return role
  }

  const flushPending = (dates: string): SourceRole | null => {
    const useful = pending.filter((line) => !isLocationLine(line) && !isSectionHeading(line) && !looksLikeEducationLine(line))
    pending = []
    if (!useful.length) return null
    const { title, company } = assignTitleCompany(useful)
    if (!title && !company) return null
    return startRole({ title, company, dates, bullets: [] })
  }

  for (const line of lines) {
    if (isSectionHeading(line)) {
      const key = line.toLowerCase()
      if (/experience|employment|work history/.test(key)) {
        section = 'experience'
        current = null
        pending = []
        continue
      }
      section = key
      current = null
      pending = []
      continue
    }

    if (respectSections && section && !/experience|employment|work history/.test(section)) continue

    if (isBullet(line)) {
      const text = bulletText(line)
      if (!current && (pending.length || section === 'experience')) {
        current = flushPending('') ?? startRole({ title: '', company: '', dates: '', bullets: [] })
      }
      if (current && text) current.bullets.push(text)
      continue
    }

    const inline = parseInlineRole(line)
    if (inline) {
      current = startRole(inline)
      continue
    }

    if (containsDateRange(line) && !looksLikeEducationLine(line)) {
      const dates = extractDateRange(line) || line
      const remainder = line.replace(dates, '').replace(/[|—–-]/g, ' ').replace(/\s+/g, ' ').trim()
      if (remainder && remainder.length < 90 && !isLocationLine(remainder)) pending.push(remainder)
      const useful = pending.filter((item) => !looksLikeEducationLine(item) && !isLocationLine(item))
      if (!useful.length) {
        pending = []
        continue
      }
      pending = useful
      current = flushPending(dates)
      continue
    }

    if (isLocationLine(line) || looksLikeEducationLine(line)) continue

    if (current && ACTION_LINE_RE.test(line) && line.length > 28) {
      current.bullets.push(line)
      continue
    }

    if (line.length < 90) {
      pending.push(line)
      if (pending.length > 4) pending = pending.slice(-4)
    }
  }

  return roles.filter((role) => role.title || role.company || role.bullets.length)
}

export function parseSourceRoles(resumeText: string): SourceRole[] {
  const experienceBody = sectionBody(resumeText, 'experience')
  if (experienceBody) {
    const scoped = parseRoleLines(expandResumeLines(experienceBody), { initialSection: 'experience' })
    if (scoped.length) return scoped
  }
  const whole = parseRoleLines(expandResumeLines(resumeText), { respectSections: true })
  if (whole.length) return whole
  return parseRoleLines(expandResumeLines(resumeText), { respectSections: false })
}

export function rolesFromResumeProfile(profile: ResumeProfile | null, resumeText = ''): SourceRole[] {
  if (!profile) return []
  const titles = profile.jobTitles.map((item) => item.trim()).filter(Boolean)
  const employers = profile.employers.map((item) => item.trim()).filter(Boolean)
  const bullets = profile.responsibilities
    .map((item) => (item.name || item.evidence || '').trim())
    .filter((item) => item.length > 8)
  if (!titles.length && !employers.length) return []
  const count = Math.max(titles.length, employers.length)
  return Array.from({ length: count }, (_, index) => ({
    title: titles[index] ?? titles[titles.length - 1] ?? '',
    company: employers[index] ?? employers[employers.length - 1] ?? '',
    dates: '',
    bullets: index === 0 ? bullets : [],
  })).filter(
    (role) =>
      (!role.title || !resumeText || textContainsTerm(resumeText, role.title)) &&
      (!role.company || !resumeText || textContainsTerm(resumeText, role.company)),
  )
}

export function withSourceExperience(tailored: TailoredResume, source: SourceFacts): TailoredResume {
  if (tailored.experience.length || !source.roles.length) return tailored
  return {
    ...tailored,
    experience: source.roles.map((role) => ({
      company: role.company,
      title: role.title,
      dates: role.dates,
      bullets: [...role.bullets],
    })),
  }
}

function normalizeSectionName(line: string): string {
  const value = line.trim().toLowerCase().replace(/:$/, '')
  if (/(?:professional\s+)?summary|objective|profile/.test(value) && !/experience/.test(value)) return 'summary'
  if (/skill|competenc/.test(value)) return 'skills'
  if (/experience|employment|work history/.test(value)) return 'experience'
  if (/education|academic/.test(value)) return 'education'
  if (/certification|license/.test(value)) return 'certifications'
  if (/project/.test(value)) return 'projects'
  return value
}

function sectionBody(resumeText: string, name: string): string {
  const body: string[] = []
  let inSection = false
  for (const line of resumeText.split(/\r?\n/)) {
    if (isSectionHeading(line)) {
      if (inSection) break
      inSection = normalizeSectionName(line) === name
      continue
    }
    if (inSection) body.push(line)
  }
  return body.join('\n').trim()
}

export function extractSummary(resumeText: string): string {
  const body = sectionBody(resumeText, 'summary')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !isSectionHeading(line))
    .join('\n')
    .trim()
  if (body) return body
  const contact = extractContact(resumeText)
  for (const line of expandResumeLines(resumeText)) {
    if (isSectionHeading(line)) break
    if (
      line.length > 40 &&
      !line.includes('@') &&
      !isLocationLine(line) &&
      line !== contact.name &&
      line !== contact.location
    ) {
      return line
    }
  }
  return ''
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
  const parsedRoles = roles.length ? roles : rolesFromResumeProfile(profile, resumeText)
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
  for (const role of parsedRoles) {
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

  for (const term of findLexiconTerms(resumeText)) {
    if (term.name.trim()) skillSet.add(term.name)
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
      ...parsedRoles.map((role) => role.company),
    ]).filter((item) => textContainsTerm(resumeText, item)),
    titles: unique([
      ...(profile?.jobTitles ?? []),
      ...parsedRoles.map((role) => role.title),
    ]).filter((item) => textContainsTerm(resumeText, item)),
    certifications,
    projects,
    education,
    roles: parsedRoles,
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
  const lines = expandResumeLines(resumeText)
  const email = resumeText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? ''
  const name = lines[0] && !lines[0].includes('@') && lines[0].length < 80 ? lines[0] : ''
  const location = lines.find((line) => line !== name && line !== email && isLocationLine(line)) ?? ''
  return { name, email, location }
}

const HIDDEN_SUPPORT: Record<string, RegExp> = {
  'rest apis': /\bHTTP[- ]based services?\b|\bHTTP services\b|\bHTTP APIs?\b/i,
}

export function supportedInSource(term: string, source: SourceFacts): boolean {
  if (!term.trim()) return false
  if (textContainsTerm(source.text, term)) return true
  if (source.skills.some((skill) => textContainsTerm(skill, term) || textContainsTerm(term, skill))) return true
  const hidden = HIDDEN_SUPPORT[normalizeSkill(term)]
  return Boolean(hidden && hidden.test(source.text))
}
