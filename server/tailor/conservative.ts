import { sameSkill, textContainsTerm } from '../match/normalize'
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

function enrichBullet(bullet: string, roleText: string, emphasize: string[]): { text: string; changed: boolean } {
  const extras = emphasize.filter((skill) => textContainsTerm(roleText, skill) && !textContainsTerm(bullet, skill)).slice(0, 2)
  if (!extras.length) return { text: bullet, changed: false }
  if (!/\b(developed|built|worked|owned|supported|shipped|created|implemented)\b/i.test(bullet) || bullet.length > 120) {
    return { text: bullet, changed: false }
  }
  return {
    text: `${bullet.replace(/\.$/, '')} using ${extras.join(' and ')}.`,
    changed: true,
  }
}

export function buildConservativeResume(
  source: SourceFacts,
  plan: TailoringPlan,
  profile: ResumeProfile | null,
  contact: TailoredResume['contact'],
): TailoredResume {
  const remaining = source.skills.filter((skill) => !plan.skillsToEmphasize.some((item) => sameSkill(item, skill)))
  const skills = unique([
    ...plan.skillsToEmphasize.filter((item) => supportedInSource(item, source)),
    ...remaining,
  ])
  const years = yearsFromResume(source, profile)
  const skillPhrase = plan.skillsToEmphasize.filter((item) => supportedInSource(item, source)).slice(0, 5).join(', ')
  const sourceSummary = originalSummary(source)
  const genericSummary = !sourceSummary || sourceSummary.length < 120 || /with experience in [a-z0-9.+# /-]+\.?$/i.test(sourceSummary)
  const summary = genericSummary && years && skillPhrase
    ? `Software Engineer with ${years}+ years of experience developing ${skillPhrase}.`
    : genericSummary && skillPhrase
      ? `Software Engineer with experience developing ${skillPhrase}.`
      : sourceSummary || 'Software Engineer.'

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
    const roleText = [role.title, role.company, role.dates, ...role.bullets].join(' ')
    const rewritten = role.bullets.map((bullet) => {
      const next = enrichBullet(bullet, roleText, plan.skillsToEmphasize)
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
    const ranked = [...rewritten].sort((left, right) => {
      const score = (value: string) => plan.skillsToEmphasize.filter((skill) => textContainsTerm(value, skill)).length
      return score(right) - score(left)
    })
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
