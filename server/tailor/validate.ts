import { sameSkill, textContainsTerm } from '../match/normalize'
import { extractDates, extractNumbers, supportedInSource } from './source'
import type { SourceFacts, TailoredResume, ValidationResult } from './types'

function matchesKnown(value: string, allowed: string[], sourceText: string): boolean {
  if (!value.trim()) return false
  if (textContainsTerm(sourceText, value)) return true
  return allowed.some((item) => sameSkill(item, value) || textContainsTerm(item, value) || textContainsTerm(value, item))
}

export function validateTailoredResume(tailored: TailoredResume, source: SourceFacts, missingSkills: string[]): ValidationResult {
  const errors: string[] = []

  const generatedText = [
    tailored.summary,
    tailored.skills.join(' '),
    ...tailored.experience.flatMap((role) => role.bullets),
    ...tailored.projects.flatMap((project) => [project.name, ...project.bullets]),
  ].join('\n')

  for (const skill of tailored.skills) {
    if (!supportedInSource(skill, source)) {
      errors.push(`Unsupported skill: ${skill}`)
    }
    if (missingSkills.some((missing) => sameSkill(missing, skill)) && !supportedInSource(skill, source)) {
      errors.push(`Missing job requirement was added: ${skill}`)
    }
  }

  for (const missing of missingSkills) {
    if (missing.split(/\s+/).length > 3) continue
    if (textContainsTerm(generatedText, missing) && !supportedInSource(missing, source)) {
      errors.push(`Missing job requirement was added: ${missing}`)
    }
  }

  for (const role of tailored.experience) {
    if (role.company && !matchesKnown(role.company, source.employers, source.text)) {
      errors.push(`Unsupported employer: ${role.company}`)
    }
    if (role.title && !matchesKnown(role.title, source.titles, source.text)) {
      errors.push(`Unsupported job title: ${role.title}`)
    }
    if (role.dates) {
      const dates = extractDates(role.dates)
      const unknownDate = dates.some((date) => !source.dates.includes(date) && !textContainsTerm(source.text, date))
      if (unknownDate || (dates.length === 0 && !textContainsTerm(source.text, role.dates))) {
        errors.push(`Date was changed or invented: ${role.dates}`)
      }
    }
    for (const bullet of role.bullets) {
      const invented = extractNumbers(bullet).filter((item) => !source.numbers.includes(item) && !textContainsTerm(source.text, item))
      if (invented.length) {
        errors.push(`Unsupported metric in experience: ${invented.join(', ')}`)
      }
    }
  }

  for (const cert of tailored.certifications) {
    if (!matchesKnown(cert, source.certifications, source.text)) {
      errors.push(`Unsupported certification: ${cert}`)
    }
  }

  for (const item of tailored.education) {
    const probe = item.degree || item.field || item.details
    if (probe && !textContainsTerm(source.text, probe) && !source.education.some((edu) =>
      (item.degree && sameSkill(edu.degree, item.degree)) || (item.field && sameSkill(edu.field, item.field)),
    )) {
      errors.push(`Unsupported education: ${probe}`)
    }
  }

  for (const project of tailored.projects) {
    if (project.name && !matchesKnown(project.name, source.projects, source.text)) {
      errors.push(`Unsupported project: ${project.name}`)
    }
  }

  if (tailored.experience.length > source.roles.length && source.roles.length > 0) {
    errors.push('A new employer or role was introduced.')
  }
  if (source.roles.length > 0 && tailored.experience.length === 0) {
    errors.push('Existing experience was removed.')
  }

  return { ok: errors.length === 0, errors }
}

export const VALIDATION_USER_MESSAGE =
  'Some generated content could not be verified against your master resume. Please review and regenerate.'
