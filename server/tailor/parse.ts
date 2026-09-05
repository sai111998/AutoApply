import type { SkillGroup, TailorChange, TailoredEducation, TailoredExperience, TailoredProject, TailoredResume } from './types'

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(asString).filter(Boolean)
}

function asExperience(value: unknown): TailoredExperience[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const record = item as Record<string, unknown>
      return {
        company: asString(record.company),
        title: asString(record.title),
        dates: asString(record.dates),
        bullets: asStringArray(record.bullets),
      }
    })
    .filter((item): item is TailoredExperience => Boolean(item && (item.company || item.title)))
}

function asProjects(value: unknown): TailoredProject[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (typeof item === 'string') return { name: item.trim(), bullets: [] }
      if (!item || typeof item !== 'object') return null
      const record = item as Record<string, unknown>
      const name = asString(record.name)
      return name ? { name, bullets: asStringArray(record.bullets) } : null
    })
    .filter((item): item is TailoredProject => Boolean(item))
}

function asEducation(value: unknown): TailoredEducation[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const record = item as Record<string, unknown>
      return {
        degree: asString(record.degree),
        field: asString(record.field),
        details: asString(record.details),
      }
    })
    .filter((item): item is TailoredEducation => Boolean(item && (item.degree || item.field || item.details)))
}

function asChanges(value: unknown): TailorChange[] {
  if (!Array.isArray(value)) return []
  const result: TailorChange[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const kind = asString(record.kind)
    if (kind !== 'emphasis' && kind !== 'rewritten' && kind !== 'reordered' && kind !== 'omitted') continue
    const label = asString(record.label)
    if (!label) continue
    result.push({
      kind,
      label,
      before: asString(record.before) || undefined,
      after: asString(record.after) || undefined,
    })
  }
  return result
}

function asSkillGroups(value: unknown): SkillGroup[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const record = item as Record<string, unknown>
      const label = asString(record.label)
      const items = asStringArray(record.items)
      return label && items.length ? { label, items } : null
    })
    .filter((item): item is SkillGroup => Boolean(item))
}

export function parseTailoredResume(value: unknown, contact: TailoredResume['contact']): TailoredResume {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid tailoring payload')
  }
  const record = value as Record<string, unknown>
  const hasShape =
    typeof record.summary === 'string' ||
    Array.isArray(record.skills) ||
    Array.isArray(record.experience)
  if (!hasShape) {
    throw new Error('Invalid tailoring payload')
  }
  const skillGroups = asSkillGroups(record.skillGroups)
  return {
    summary: asString(record.summary),
    skills: asStringArray(record.skills),
    skillGroups: skillGroups.length ? skillGroups : undefined,
    experience: asExperience(record.experience),
    projects: asProjects(record.projects),
    education: asEducation(record.education),
    certifications: asStringArray(record.certifications),
    changes: asChanges(record.changes),
    omissions: asStringArray(record.omissions),
    warnings: asStringArray(record.warnings),
    contact,
  }
}
