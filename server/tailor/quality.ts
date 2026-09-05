import { sameSkill, textContainsTerm } from '../match/normalize'
import type { SourceFacts, TailoredResume, TailoringPlan, ValidationResult } from './types'
import { validateTailoredResume } from './validate'

const LEADERSHIP = /\b(led|architected|spearheaded|founded|managed a team)\b/i
const STUFF_LIMIT = 3

function occurrences(haystack: string, term: string): number {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return haystack.match(new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'gi'))?.length ?? 0
}

function represented(term: string, tailored: TailoredResume): boolean {
  const blob = [
    tailored.summary,
    tailored.skills.join(' '),
    ...tailored.experience.flatMap((role) => role.bullets),
    ...tailored.projects.flatMap((project) => [project.name, ...project.bullets]),
  ].join('\n')
  return textContainsTerm(blob, term) || tailored.skills.some((skill) => sameSkill(skill, term))
}

export function assessTailoredResume(
  tailored: TailoredResume,
  source: SourceFacts,
  plan: TailoringPlan,
): ValidationResult {
  const factual = validateTailoredResume(tailored, source, plan.missingSkills)
  const warnings: string[] = [...(factual.ok ? [] : factual.errors)]

  let representationHits = 0
  let representationTotal = 0
  for (const skill of plan.skillsToEmphasize) {
    representationTotal += 1
    if (represented(skill, tailored)) representationHits += 1
    else warnings.push(`Supported requirement is not clearly represented: ${skill}`)
  }
  for (const theme of plan.experienceToEmphasize.slice(0, 6)) {
    representationTotal += 1
    const blob = tailored.experience.flatMap((role) => role.bullets).join(' ')
    const tokens = theme.split(/\s+/).filter((item) => item.length > 4)
    if (tokens.some((token) => blob.toLowerCase().includes(token.toLowerCase()))) representationHits += 1
    else warnings.push(`Relevant responsibility is not clearly represented: ${theme}`)
  }

  const skillKeys = tailored.skills.map((item) => item.trim().toLowerCase())
  if (new Set(skillKeys).size !== skillKeys.length) warnings.push('Duplicate skills were generated.')

  const bullets = tailored.experience.flatMap((role) => role.bullets.map((item) => item.trim().toLowerCase()))
  if (new Set(bullets).size !== bullets.length) warnings.push('Duplicate experience bullets were generated.')

  for (const skill of plan.skillsToEmphasize) {
    if (occurrences(tailored.summary, skill) > STUFF_LIMIT) {
      warnings.push(`Keyword stuffing in summary: ${skill}`)
    }
  }

  for (const role of tailored.experience) {
    for (const bullet of role.bullets) {
      if (LEADERSHIP.test(bullet) && !LEADERSHIP.test(source.text)) {
        warnings.push(`Leadership language is not supported by the master resume: ${bullet}`)
      }
    }
  }

  if (tailored.summary.length > 0 && plan.skillsToEmphasize.length > 0) {
    const summaryHits = plan.skillsToEmphasize.filter((skill) => textContainsTerm(tailored.summary, skill)).length
    if (summaryHits === 0) warnings.push('Professional summary does not reflect supported job-relevant skills.')
  }

  const qualityScore =
    representationTotal === 0 ? 100 : Math.round((representationHits / representationTotal) * 100)
  const coverage = plan.coverage
  const coverageScore =
    coverage && coverage.overallTotal > 0
      ? Math.round((coverage.overallSupported / coverage.overallTotal) * 100)
      : qualityScore

  return {
    ok: factual.ok,
    errors: factual.errors,
    factualValidation: factual.ok,
    qualityScore,
    coverageScore,
    warnings: warnings.filter((item, index, list) => list.indexOf(item) === index),
  }
}
