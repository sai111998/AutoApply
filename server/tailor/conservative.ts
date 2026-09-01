import { ROLE_PRIORITY, categoryForNormalized } from '../match/lexicon'
import { candidateImplements, normalizeSkill, sameSkill, textContainsTerm } from '../match/normalize'
import type { ResumeProfile } from '../match/types'
import type { SourceFacts, TailorChange, TailoredResume, TailoringPlan } from './types'
import { supportedInSource } from './source'

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

export function buildOriginalResume(
  source: SourceFacts,
  contact: TailoredResume['contact'],
): TailoredResume {
  const skillsLine = source.text.match(/skills\n([\s\S]*?)(?:\n\n|education|certifications|projects|$)/i)?.[1]
  const listed = skillsLine
    ? skillsLine.split(/[,;\n]/).map((part) => part.replace(/^[-•*]\s*/, '').trim()).filter(Boolean)
    : source.skills
  return {
    summary:
      source.text.split(/\n\n+/).find((block) => /summary/i.test(block.split('\n')[0] ?? ''))?.replace(/^summary\s*/i, '').trim() ||
      source.text.split('\n').map((line) => line.trim()).find((line) => line.length > 40) ||
      '',
    skills: listed.length ? listed : source.skills,
    experience: source.roles.map((role) => ({ ...role, bullets: [...role.bullets] })),
    projects: source.projects.map((name) => ({ name, bullets: [] })),
    education: source.education,
    certifications: source.certifications,
    changes: [],
    omissions: [],
    warnings: [],
    contact,
  }
}

function originalSummary(source: SourceFacts): string {
  return (
    source.text.split(/\n\n+/).find((block) => /summary/i.test(block.split('\n')[0] ?? ''))?.replace(/^summary\s*/i, '').trim() ||
    source.text.split('\n').map((line) => line.trim()).find((line) => line.length > 40) ||
    ''
  )
}

function yearsFromResume(source: SourceFacts, profile: ResumeProfile | null): number | null {
  if (profile?.yearsOfExperience && profile.yearsOfExperience > 0) return profile.yearsOfExperience
  const explicit = source.text.match(/(\d+)\+?\s+years?/i)
  if (explicit) return Number(explicit[1])
  return null
}

function roleTextOf(role: { title: string; company: string; dates: string; bullets: string[] }): string {
  return [role.title, role.company, role.dates, ...role.bullets].join(' ')
}

const STRONG_VERBS =
  /\b(developed|designed|implemented|built|integrated|automated|deployed|optimized|tested|migrated|configured|maintained|owned|created|shipped|supported|reduced|used)\b/i

function applySafeVerb(bullet: string): string {
  if (/^worked with\b/i.test(bullet)) return bullet.replace(/^worked with/i, 'Used')
  if (/^worked on\b/i.test(bullet)) return bullet.replace(/^worked on/i, 'Developed')
  return bullet
}

function applyJdTerminology(text: string, emphasize: string[], source: SourceFacts): string {
  let next = text
  if (
    emphasize.some((skill) => sameSkill(skill, 'REST APIs')) &&
    supportedInSource('REST APIs', source) &&
    /\bHTTP-based services\b/i.test(next)
  ) {
    next = next.replace(/\bHTTP-based services\b/gi, 'REST APIs')
  }
  if (/\bpayments APIs\b/i.test(next) && /\bpayment/i.test(emphasize.join(' ') + source.text)) {
    next = next.replace(/\bpayments APIs\b/gi, 'payment APIs')
  }
  if (
    emphasize.some((skill) => sameSkill(skill, 'CI/CD')) &&
    textContainsTerm(source.text, 'CI') &&
    /\bin CI\b/i.test(next) &&
    !/\bci\/cd\b/i.test(next)
  ) {
    next = next.replace(/\bin CI\b/gi, 'in CI/CD')
  }
  if (
    emphasize.some((skill) => sameSkill(skill, 'PostgreSQL')) &&
    supportedInSource('PostgreSQL', source) &&
    /\brelational databases?\b/i.test(next)
  ) {
    next = next.replace(/\brelational databases?\b/gi, 'PostgreSQL')
  }
  return next
}

function enrichBullet(
  bullet: string,
  roleText: string,
  emphasize: string[],
  source: SourceFacts,
): { text: string; changed: boolean } {
  let text = applyJdTerminology(applySafeVerb(bullet), emphasize, source)
  const alreadyHasSkill = emphasize.some((skill) => textContainsTerm(text, skill))
  const keepFactual = /^(reduced|increased|improved|saved|cut)\b/i.test(text)
  if (!alreadyHasSkill && !keepFactual) {
    const extras = emphasize
      .filter(
        (skill) =>
          textContainsTerm(roleText, skill) &&
          !textContainsTerm(text, skill) &&
          supportedInSource(skill, source),
      )
      .slice(0, 2)
    if (extras.length && STRONG_VERBS.test(text) && text.length < 160) {
      text = `${text.replace(/\.$/, '')} using ${extras.join(' and ')}.`
    }
  }
  return { text, changed: text.replace(/\.$/, '') !== bullet.replace(/\.$/, '') }
}

function dropParentSkills(skills: string[]): string[] {
  return skills.filter(
    (skill) => !skills.some((other) => other !== skill && candidateImplements(skill, other)),
  )
}

function tokenishOverlap(a: string, b: string): boolean {
  const left = a.toLowerCase()
  return b
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 4)
    .slice(0, 4)
    .some((token) => left.includes(token))
}

function relevance(value: string, emphasize: string[], themes: string[]): number {
  const skillHits = emphasize.filter((skill) => textContainsTerm(value, skill)).length
  const themeHits = themes.filter((theme) => tokenishOverlap(value, theme)).length
  return skillHits * 3 + themeHits
}

const CATEGORY_ORDER = [
  'language',
  'framework',
  'architecture',
  'cloud',
  'database',
  'devops',
  'testing',
  'frontend',
  'security',
  'tools',
  'methodology',
  'domain',
  'library',
]

function orderSkills(skills: string[], plan: TailoringPlan, jobDescription: string): string[] {
  const role = (plan.roleType as keyof typeof ROLE_PRIORITY) || 'general'
  const roleOrder = ROLE_PRIORITY[role] ?? []
  const emphasizeIndex = (name: string) => {
    const idx = plan.skillsToEmphasize.findIndex((item) => sameSkill(item, name))
    return idx === -1 ? 1000 : idx
  }
  const roleIndex = (name: string) => {
    const idx = roleOrder.findIndex((item) => sameSkill(item, name) || normalizeSkill(item) === normalizeSkill(name))
    return idx === -1 ? 1000 : idx
  }
  const categoryIndex = (name: string) => {
    const category = categoryForNormalized(normalizeSkill(name))
    const idx = category ? CATEGORY_ORDER.indexOf(category) : 99
    return idx === -1 ? 99 : idx
  }
  const jdHit = (name: string) => (textContainsTerm(jobDescription, name) ? 0 : 1)

  return [...skills].sort((left, right) => {
    const byEmphasize = emphasizeIndex(left) - emphasizeIndex(right)
    if (byEmphasize !== 0) return byEmphasize
    const byJd = jdHit(left) - jdHit(right)
    if (byJd !== 0) return byJd
    const byRole = roleIndex(left) - roleIndex(right)
    if (byRole !== 0) return byRole
    return categoryIndex(left) - categoryIndex(right)
  })
}

function phraseList(names: string[]): string {
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`
}

function buildSummary(source: SourceFacts, plan: TailoringPlan, profile: ResumeProfile | null): string {
  const years = yearsFromResume(source, profile)
  const title = source.titles[0] || 'Software Engineer'
  const top = dropParentSkills(plan.skillsToEmphasize.filter((item) => supportedInSource(item, source))).slice(0, 6)
  const payment = /\bpayment/i.test(source.text)
  if (!top.length) return originalSummary(source) || `${title}.`
  const head = years ? `${title} with ${years}+ years of experience` : `${title} with experience`
  const focus = payment ? ' for payment platforms' : ''
  return `${head} developing ${phraseList(top)}${focus}.`
}

export function buildConservativeResume(
  source: SourceFacts,
  plan: TailoringPlan,
  profile: ResumeProfile | null,
  contact: TailoredResume['contact'],
  jobDescription = '',
): TailoredResume {
  const remaining = source.skills.filter((skill) => !plan.skillsToEmphasize.some((item) => sameSkill(item, skill)))
  const skills = orderSkills(
    dropParentSkills(
      unique([
        ...plan.skillsToEmphasize.filter((item) => supportedInSource(item, source)),
        ...remaining.filter((item) => supportedInSource(item, source)),
      ]),
    ),
    plan,
    jobDescription,
  )
  const sourceSummary = originalSummary(source)
  const summary = buildSummary(source, plan, profile)

  const changes: TailorChange[] = [
    ...plan.skillsToEmphasize.filter((skill) => supportedInSource(skill, source)).map((skill) => ({
      kind: 'emphasis' as const,
      label: `${skill} moved higher in Skills`,
    })),
    ...plan.missingSkills.map((skill) => ({
      kind: 'omitted' as const,
      label: `${skill} was not added because it is not supported by the master resume`,
    })),
  ]

  const experience = source.roles.map((role) => {
    const roleText = roleTextOf(role)
    const rewritten = role.bullets.map((bullet) => {
      const next = enrichBullet(bullet, roleText, plan.skillsToEmphasize, source)
      if (next.changed) {
        changes.push({
          kind: 'rewritten',
          label: `${role.title} at ${role.company}`,
          before: bullet,
          after: next.text,
        })
      }
      return next.text
    })
    const ranked = rewritten
      .map((text, index) => ({
        text,
        index,
        score: relevance(text, plan.skillsToEmphasize, plan.experienceToEmphasize),
      }))
      .sort((left, right) => right.score - left.score || left.index - right.index)
      .map((item) => item.text)
    return { ...role, bullets: ranked }
  })

  if (sourceSummary && summary !== sourceSummary) {
    changes.unshift({
      kind: 'rewritten',
      label: 'Professional summary targeted to the analyzed role',
      before: sourceSummary,
      after: summary,
    })
  }

  return {
    summary,
    skills,
    experience,
    projects: source.projects.map((name) => ({ name, bullets: [] })),
    education: source.education,
    certifications: source.certifications,
    changes,
    omissions: plan.missingSkills,
    warnings: [],
    contact,
  }
}
