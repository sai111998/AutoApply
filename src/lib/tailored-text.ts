import type { TailoredResumeContent } from '@/types/domain'

export function emptyTailoredContent(): TailoredResumeContent {
  return {
    summary: '',
    skills: [],
    skillGroups: [],
    experience: [],
    projects: [],
    education: [],
    certifications: [],
    changes: [],
    omissions: [],
    warnings: [],
    contact: { name: '', email: '', location: '' },
  }
}

export function sanitizeTailoredContent(resume: TailoredResumeContent): TailoredResumeContent {
  const base = emptyTailoredContent()
  const contact = resume?.contact ?? base.contact
  return {
    ...base,
    ...resume,
    summary: typeof resume?.summary === 'string' ? resume.summary.trim() : '',
    skills: (resume?.skills ?? []).map((item) => item.trim()).filter(Boolean),
    skillGroups: (resume?.skillGroups ?? [])
      .map((group) => ({
        label: (group.label ?? '').trim(),
        items: (group.items ?? []).map((item) => item.trim()).filter(Boolean),
      }))
      .filter((group) => group.label && group.items.length),
    experience: (resume?.experience ?? []).map((role) => ({
      ...role,
      title: (role.title ?? '').trim(),
      company: (role.company ?? '').trim(),
      dates: (role.dates ?? '').trim(),
      bullets: (role.bullets ?? []).map((item) => item.trim()).filter(Boolean),
    })),
    projects: (resume?.projects ?? [])
      .map((project) => ({
        ...project,
        name: (project.name ?? '').trim(),
        bullets: (project.bullets ?? []).map((item) => item.trim()).filter(Boolean),
      }))
      .filter((project) => project.name || project.bullets.length),
    education: (resume?.education ?? [])
      .map((item) => ({
        ...item,
        degree: (item.degree ?? '').trim(),
        field: (item.field ?? '').trim(),
        details: (item.details ?? '').trim(),
      }))
      .filter((item) => item.degree || item.field || item.details),
    certifications: (resume?.certifications ?? []).map((item) => item.trim()).filter(Boolean),
    contact: {
      name: contact.name ?? '',
      email: contact.email ?? '',
      location: contact.location ?? '',
    },
  }
}

export function tailoredResumeToText(resume: TailoredResumeContent): string {
  const clean = sanitizeTailoredContent(resume)
  const lines: string[] = []
  if (clean.contact.name) lines.push(clean.contact.name)
  const contact = [clean.contact.email, clean.contact.location].filter(Boolean).join(' · ')
  if (contact) lines.push(contact)
  lines.push('')
  if (clean.summary) {
    lines.push('Professional Summary')
    lines.push(clean.summary)
    lines.push('')
  }
  if (clean.skills.length) {
    lines.push('Technical Skills')
    lines.push(
      clean.skillGroups?.length
        ? clean.skillGroups.map((group) => `${group.label}: ${group.items.join(', ')}`).join('\n')
        : clean.skills.join(', '),
    )
    lines.push('')
  }
  if (clean.experience.length) {
    lines.push('Experience')
    for (const role of clean.experience) {
      lines.push(`${role.title}, ${role.company} — ${role.dates}`)
      for (const bullet of role.bullets) lines.push(`- ${bullet}`)
      lines.push('')
    }
  }
  if (clean.projects.length) {
    lines.push('Projects')
    for (const project of clean.projects) {
      lines.push(project.name)
      for (const bullet of project.bullets) lines.push(`- ${bullet}`)
    }
    lines.push('')
  }
  if (clean.education.length) {
    lines.push('Education')
    for (const item of clean.education) {
      lines.push([item.degree, item.field, item.details].filter(Boolean).join(', '))
    }
    lines.push('')
  }
  if (clean.certifications.length) {
    lines.push('Certifications')
    lines.push(clean.certifications.join(', '))
  }
  return lines.join('\n').trim()
}

export function scoreChange(previous: number | null, updated: number | null) {
  if (previous == null || updated == null) return null
  return {
    previous,
    updated,
    delta: updated - previous,
  }
}
