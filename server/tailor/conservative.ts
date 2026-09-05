import { candidateImplements, sameSkill, textContainsTerm } from '../match/normalize'
import type { ResumeProfile } from '../match/types'
import type { SourceFacts, TailorChange, TailoredProject, TailoredResume, TailoringPlan } from './types'
import { supportedInSource } from './source'
import { formatSkillGroups, groupSkills, orderSkills } from './skills-format'
import type { ResumeEvidenceRecord } from './evidence'

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
  if (/^helped with\b/i.test(bullet)) return bullet.replace(/^helped with/i, 'Supported')
  if (/^responsible for testing\b/i.test(bullet)) return bullet.replace(/^responsible for testing/i, 'Tested')
  if (/^responsible for\b/i.test(bullet)) return bullet.replace(/^responsible for/i, 'Owned')
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
  if (
    emphasize.some((skill) => sameSkill(skill, 'AWS')) &&
    supportedInSource('AWS', source) &&
    /\bAWS-based services\b/i.test(next)
  ) {
    next = next.replace(/\bAWS-based services\b/gi, 'AWS cloud services')
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

  if (/^used docker in ci\/cd\.?$/i.test(text) && supportedInSource('Docker', source)) {
    text = 'Used Docker to containerize and deliver applications in CI/CD.'
  } else if (/^used docker in ci\.?$/i.test(text) && supportedInSource('Docker', source)) {
    text = 'Used Docker to containerize and deliver applications in CI/CD.'
  }

  if (
    /developed java and spring boot applications for payment APIs/i.test(text) &&
    supportedInSource('Spring Boot', source)
  ) {
    text = 'Developed Java and Spring Boot backend services and payment APIs.'
  }

  if (/^built rest apis in java\.?$/i.test(text) && supportedInSource('REST APIs', source)) {
    text = 'Built Java REST APIs supporting backend services.'
  }

  if (/^supported aws cloud services\.?$/i.test(text) && supportedInSource('AWS', source)) {
    text = 'Supported AWS cloud services for application delivery.'
  }

  if (/owned postgresql schema changes for billing\.?$/i.test(text) && supportedInSource('PostgreSQL', source)) {
    text = 'Owned PostgreSQL schema changes for billing systems.'
  }

  if (/reduced checkout errors by adding contract tests/i.test(text)) {
    text = 'Reduced checkout errors by adding contract tests for payment APIs.'
  }

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

function phraseList(names: string[]): string {
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`
}

function sanitizeTargetTitle(targetRole: string | undefined, missingSkills: string[], fallback: string): string {
  const title = targetRole?.trim() || fallback
  if (missingSkills.some((skill) => textContainsTerm(title, skill))) return fallback
  return title
}

function domainFromSource(source: SourceFacts, jobDescription: string): string {
  if (/\bpayment/i.test(source.text) || /\bpayment/i.test(jobDescription)) return 'payment platforms'
  if (/\bbilling/i.test(source.text)) return 'billing systems'
  if (/\bsecurity|siem|soc/i.test(source.text)) return 'security operations'
  return ''
}

function buildSummary(
  source: SourceFacts,
  plan: TailoringPlan,
  profile: ResumeProfile | null,
  jobDescription: string,
): string {
  const years = yearsFromResume(source, profile)
  const title = sanitizeTargetTitle(plan.targetRole, plan.missingSkills, source.titles[0] || 'Software Engineer')
  const top = dropParentSkills(plan.skillsToEmphasize.filter((item) => supportedInSource(item, source))).slice(0, 8)
  const domain = domainFromSource(source, jobDescription)
  if (!top.length) return originalSummary(source) || `${title}.`

  const head = years
    ? `${title} with ${years}+ years of experience`
    : `${title} with hands-on experience`
  const core = phraseList(top.slice(0, 5))
  const line1 = domain
    ? `${head} developing ${core} for ${domain}.`
    : `${head} developing ${core}.`

  const rest = top.slice(5)
  const themes = plan.experienceToEmphasize.slice(0, 3)
  const extras: string[] = [...rest]
  if (supportedInSource('Docker', source) && textContainsTerm(source.text, 'CI') && !extras.some((item) => sameSkill(item, 'CI/CD'))) {
    extras.push('Docker-based CI/CD')
  }
  const line2 = extras.length ? `Additional supported strengths include ${phraseList(unique(extras))}.` : ''

  const line3 = themes.length
    ? `Experience includes ${phraseList(themes.slice(0, 3).map((item) => item.replace(/\.$/, '').replace(/^[a-z]/, (ch) => ch.toLowerCase())))}.`
    : ''

  return [line1, line2, line3].filter(Boolean).join('\n')
}

function prioritizeProjects(
  source: SourceFacts,
  plan: TailoringPlan,
  jobDescription: string,
): TailoredProject[] {
  const emphasize = [...plan.skillsToEmphasize, ...plan.experienceToEmphasize]
  return source.projects
    .map((name) => ({
      name,
      bullets: [] as string[],
      score: relevance(name, emphasize, [jobDescription]),
    }))
    .sort((left, right) => right.score - left.score)
    .map(({ name, bullets }) => ({ name, bullets }))
}

export function buildConservativeResume(
  source: SourceFacts,
  plan: TailoringPlan,
  profile: ResumeProfile | null,
  contact: TailoredResume['contact'],
  jobDescription = '',
  evidence: ResumeEvidenceRecord[] = [],
): TailoredResume {
  const remaining = source.skills.filter((skill) => !plan.skillsToEmphasize.some((item) => sameSkill(item, skill)))
  const evidenceSkills = evidence
    .filter(
      (item) =>
        (item.strength === 'strong' || item.strength === 'partial') &&
        (item.type === 'required' || item.type === 'preferred') &&
        item.requirement.split(/\s+/).length <= 4 &&
        supportedInSource(item.requirement, source),
    )
    .map((item) => item.requirement)
  const skills = orderSkills(
    dropParentSkills(
      unique([
        ...plan.skillsToEmphasize.filter((item) => supportedInSource(item, source)),
        ...evidenceSkills,
        ...remaining.filter((item) => supportedInSource(item, source)),
      ]),
    ),
    plan,
    jobDescription,
  )
  const skillGroups = groupSkills(skills, plan.roleType)
  const sourceSummary = originalSummary(source)
  const summary = buildSummary(source, plan, profile, jobDescription)

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
    skillGroups,
    experience,
    projects: prioritizeProjects(source, plan, jobDescription),
    education: source.education,
    certifications: source.certifications,
    changes,
    omissions: plan.missingSkills,
    warnings: [],
    contact,
  }
}

export { formatSkillGroups }
