import { scoreMatch } from '../match/engine'
import { extractResumeLocal, mergeResumeProfiles } from '../match/extract-local'
import { emptyResumeProfile, groundResumeProfile } from '../match/ground'
import { sameSkill, textContainsTerm } from '../match/normalize'
import type { JobProfile, MatchReport, ResumeProfile } from '../match/types'
import type { ResumeEvidenceRecord } from './evidence'
import { supportedInSource } from './source'
import type { SourceFacts, TailoredResume } from './types'

export type GapKind = 'strong' | 'hidden' | 'partial' | 'missing'
export type GapDimension =
  | 'required'
  | 'preferred'
  | 'responsibility'
  | 'experience'
  | 'education'
  | 'keyword'
  | 'location'

export interface OptimizationGap {
  dimension: GapDimension
  requirement: string
  kind: GapKind
  evidence: string
  action: 'optimize' | 'leave'
}

export interface MatchCoverageSnapshot {
  matchScore: number
  requiredMatched: number
  requiredTotal: number
  preferredMatched: number
  preferredTotal: number
  responsibilityCoverage: number
  responsibilityStrong: number
  responsibilityTotal: number
}

export function tailoredResumeToText(resume: TailoredResume): string {
  const lines: string[] = []
  if (resume.contact.name) lines.push(resume.contact.name)
  const contact = [resume.contact.email, resume.contact.location].filter(Boolean).join(' · ')
  if (contact) lines.push(contact)
  lines.push('')
  if (resume.summary) {
    lines.push('Professional Summary')
    lines.push(resume.summary)
    lines.push('')
  }
  if (resume.skills.length) {
    lines.push('Skills')
    lines.push(
      resume.skillGroups?.length
        ? resume.skillGroups.map((group) => `${group.label}: ${group.items.join(', ')}`).join('\n')
        : resume.skills.join(', '),
    )
    lines.push('')
  }
  if (resume.experience.length) {
    lines.push('Experience')
    for (const role of resume.experience) {
      lines.push(`${role.title}, ${role.company} — ${role.dates}`)
      for (const bullet of role.bullets) lines.push(`- ${bullet}`)
      lines.push('')
    }
  }
  if (resume.projects.length) {
    lines.push('Projects')
    for (const project of resume.projects) {
      lines.push(project.name)
      for (const bullet of project.bullets) lines.push(`- ${bullet}`)
      lines.push('')
    }
  }
  if (resume.education.length) {
    lines.push('Education')
    for (const item of resume.education) {
      lines.push([item.degree, item.field, item.details].filter(Boolean).join(', '))
    }
    lines.push('')
  }
  if (resume.certifications.length) {
    lines.push('Certifications')
    lines.push(resume.certifications.join(', '))
  }
  return lines.join('\n').trim()
}

function yearsFromExperience(experience: { dates: string }[]): number | null {
  const spans: number[] = []
  for (const role of experience) {
    const years = role.dates.match(/(?:19|20)\d{2}/g)?.map(Number) ?? []
    if (!years.length) continue
    const start = years[0]
    const end = years[1] ?? new Date().getFullYear()
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) spans.push(end - start)
  }
  if (!spans.length) return null
  return spans.reduce((sum, item) => sum + item, 0)
}

export function resumeProfileFromTailored(resume: TailoredResume, original?: ResumeProfile | null): ResumeProfile {
  const text = tailoredResumeToText(resume)
  const years = yearsFromExperience(resume.experience)
  const structured: ResumeProfile = {
    ...emptyResumeProfile(),
    skills: resume.skills.map((name) => ({ name, evidence: name, years })),
    jobTitles: resume.experience.map((role) => role.title).filter(Boolean),
    employers: resume.experience.map((role) => role.company).filter(Boolean),
    yearsOfExperience: years ?? original?.yearsOfExperience ?? null,
    education: resume.education.map((item) => ({
      degree: item.degree,
      field: item.field,
      evidence: item.details || [item.degree, item.field].filter(Boolean).join(', '),
    })),
    certifications: resume.certifications.map((name) => ({ name, evidence: name })),
    projects: resume.projects.map((item) => ({ name: item.name, evidence: item.name })),
    responsibilities: resume.experience.flatMap((role) =>
      role.bullets.filter(Boolean).map((bullet) => ({ name: bullet, evidence: bullet })),
    ),
    location: resume.contact.location || original?.location || '',
  }
  const preserved = (original?.skills ?? []).filter(
    (item) => textContainsTerm(text, item.name) || resume.skills.some((skill) => sameSkill(skill, item.name)),
  )
  return groundResumeProfile(
    mergeResumeProfiles(structured, mergeResumeProfiles(extractResumeLocal(text), {
      ...emptyResumeProfile(),
      skills: preserved,
      yearsOfExperience: structured.yearsOfExperience,
      location: structured.location,
      education: structured.education.length ? structured.education : original?.education ?? [],
    })),
    text,
  )
}

export function scoreTailoredResume(
  resume: TailoredResume,
  jobProfile: JobProfile,
  originalProfile?: ResumeProfile | null,
): MatchReport {
  const text = tailoredResumeToText(resume)
  return scoreMatch(resumeProfileFromTailored(resume, originalProfile), jobProfile, text)
}

export function coverageFromMatch(report: MatchReport): MatchCoverageSnapshot {
  const requiredTotal =
    (report.requiredSkills?.matched.length ?? 0) +
    (report.requiredSkills?.partial.length ?? 0) +
    (report.requiredSkills?.missing.length ?? 0)
  const preferredTotal =
    (report.preferredSkills?.matched.length ?? 0) +
    (report.preferredSkills?.partial.length ?? 0) +
    (report.preferredSkills?.missing.length ?? 0)
  const responsibilityTotal =
    (report.responsibilities?.strongMatches.length ?? 0) +
    (report.responsibilities?.partialMatches.length ?? 0) +
    (report.responsibilities?.gaps.length ?? 0)
  const responsibilityPoints =
    (report.responsibilities?.strongMatches.length ?? 0) +
    (report.responsibilities?.partialMatches.length ?? 0) * 0.5
  return {
    matchScore: report.matchScore,
    requiredMatched: report.requiredSkills?.matched.length ?? 0,
    requiredTotal,
    preferredMatched: report.preferredSkills?.matched.length ?? 0,
    preferredTotal,
    responsibilityCoverage: responsibilityTotal ? Math.round((responsibilityPoints / responsibilityTotal) * 100) : 100,
    responsibilityStrong: report.responsibilities?.strongMatches.length ?? 0,
    responsibilityTotal,
  }
}

function evidenceFor(requirement: string, records: ResumeEvidenceRecord[]): ResumeEvidenceRecord | undefined {
  return records.find((record) => sameSkill(record.requirement, requirement) || record.requirement === requirement)
}

function classifyRequirement(
  classification: string,
  requirement: string,
  evidence: string,
  records: ResumeEvidenceRecord[],
  source: SourceFacts,
): Pick<OptimizationGap, 'kind' | 'evidence' | 'action'> {
  const record = evidenceFor(requirement, records)
  const sourceHit = supportedInSource(requirement, source) || Boolean(record && record.strength !== 'missing')
  if (classification === 'strong') {
    return { kind: 'strong', evidence: evidence || record?.candidateEvidence || '', action: 'optimize' }
  }
  if (classification === 'partial' || record?.strength === 'partial' || record?.strength === 'related') {
    return {
      kind: sourceHit ? 'hidden' : 'partial',
      evidence: evidence || record?.candidateEvidence || '',
      action: 'optimize',
    }
  }
  if (sourceHit) {
    return { kind: 'hidden', evidence: record?.candidateEvidence || evidence, action: 'optimize' }
  }
  return { kind: 'missing', evidence: '', action: 'leave' }
}

export function classifyMatchGaps(
  report: MatchReport,
  source: SourceFacts,
  records: ResumeEvidenceRecord[],
): OptimizationGap[] {
  const gaps: OptimizationGap[] = []
  const pushSkill = (
    dimension: 'required' | 'preferred',
    items: { name: string; classification: string; evidence: string }[],
  ) => {
    for (const item of items) {
      gaps.push({
        dimension,
        requirement: item.name,
        ...classifyRequirement(item.classification, item.name, item.evidence, records, source),
      })
    }
  }
  pushSkill('required', [
    ...(report.requiredSkills?.matched ?? []),
    ...(report.requiredSkills?.partial ?? []),
    ...(report.requiredSkills?.missing ?? []),
  ])
  pushSkill('preferred', [
    ...(report.preferredSkills?.matched ?? []),
    ...(report.preferredSkills?.partial ?? []),
    ...(report.preferredSkills?.missing ?? []),
  ])

  for (const item of [
    ...(report.responsibilities?.strongMatches ?? []),
    ...(report.responsibilities?.partialMatches ?? []),
    ...(report.responsibilities?.gaps ?? []),
  ]) {
    gaps.push({
      dimension: 'responsibility',
      requirement: item.name,
      ...classifyRequirement(item.classification, item.name, item.evidence, records, source),
    })
  }

  if (report.experience.status === 'insufficient_evidence' || report.experience.status === 'partial' || report.experience.status === 'gap') {
    const yearsPresent = /\d+\+?\s*years?/i.test(source.text) || source.roles.some((role) => /(?:19|20)\d{2}/.test(role.dates))
    gaps.push({
      dimension: 'experience',
      requirement: report.experience.jobRequirement,
      kind: yearsPresent ? 'hidden' : 'missing',
      evidence: report.experience.candidateEvidence,
      action: yearsPresent ? 'optimize' : 'leave',
    })
  }

  if (report.education.status === 'unknown' || report.education.status === 'missing' || report.education.status === 'gap') {
    gaps.push({
      dimension: 'education',
      requirement: report.education.details || 'Education requirement',
      kind: source.education.length ? 'hidden' : 'missing',
      evidence: source.education.map((item) => item.details || item.degree).join('; '),
      action: source.education.length ? 'optimize' : 'leave',
    })
  }

  return gaps
}

export function formatOptimizationReport(report: MatchReport, gaps: OptimizationGap[]): string {
  const lines = [
    `Original Match Engine score: ${report.matchScore}.`,
    'Optimize only supported/hidden gaps. Never invent missing requirements.',
    '',
    'Priority: required skills, required responsibilities, experience, preferred skills, terminology, education.',
  ]
  const groups: GapDimension[] = ['required', 'responsibility', 'experience', 'preferred', 'education', 'keyword', 'location']
  for (const dimension of groups) {
    const items = gaps.filter((gap) => gap.dimension === dimension)
    if (!items.length) continue
    lines.push('', `${dimension}:`)
    for (const gap of items) {
      const mark = gap.kind === 'strong' ? '✓' : gap.kind === 'missing' ? '✗' : '⚠'
      lines.push(
        `${mark} ${gap.requirement} [${gap.kind}] ${gap.action === 'leave' ? 'leave gap' : 'surface existing evidence'}${
          gap.evidence ? ` — ${gap.evidence.slice(0, 90)}` : ''
        }`,
      )
    }
  }
  return lines.join('\n')
}

export function lostSupportedNames(before: MatchReport, after: MatchReport): string[] {
  const beforeMatched = [
    ...(before.requiredSkills?.matched ?? []),
    ...(before.preferredSkills?.matched ?? []),
  ].map((item) => item.name)
  const afterVisible = [
    ...(after.requiredSkills?.matched ?? []),
    ...(after.requiredSkills?.partial ?? []),
    ...(after.preferredSkills?.matched ?? []),
    ...(after.preferredSkills?.partial ?? []),
  ]
  return beforeMatched.filter(
    (name) =>
      (after.requiredSkills?.missing ?? []).some((item) => sameSkill(item.name, name)) ||
      (after.preferredSkills?.missing ?? []).some((item) => sameSkill(item.name, name)) ||
      !afterVisible.some((item) => sameSkill(item.name, name)),
  )
}

function uniqueSkills(values: string[]): string[] {
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

export function restoreLostEvidence(
  tailored: TailoredResume,
  source: SourceFacts,
  lost: string[],
): TailoredResume {
  if (!lost.length) return tailored
  const blob = tailoredResumeToText(tailored)
  const skills = uniqueSkills([
    ...lost.filter((name) => supportedInSource(name, source) && !tailored.skills.some((skill) => sameSkill(skill, name))),
    ...tailored.skills,
  ])
  const experience = tailored.experience.map((role) => {
    const original = source.roles.find(
      (item) => sameSkill(item.company, role.company) || item.company.toLowerCase() === role.company.toLowerCase(),
    )
    if (!original) return role
    const missing = lost.filter(
      (name) =>
        supportedInSource(name, source) &&
        original.bullets.some((bullet) => textContainsTerm(bullet, name)) &&
        !role.bullets.some((bullet) => textContainsTerm(bullet, name)) &&
        !textContainsTerm(blob, name),
    )
    if (!missing.length) return role
    const restored = original.bullets.filter((bullet) => missing.some((name) => textContainsTerm(bullet, name)))
    return { ...role, bullets: uniqueSkills([...restored, ...role.bullets]) }
  })
  return { ...tailored, skills, experience }
}

export function matchRetryNote(original: MatchReport, after: MatchReport, gaps: OptimizationGap[]): string {
  const lost = lostSupportedNames(original, after)
  const hidden = gaps.filter((gap) => gap.kind === 'hidden' && gap.action === 'optimize').map((gap) => gap.requirement)
  const missing = gaps.filter((gap) => gap.kind === 'missing').map((gap) => gap.requirement)
  return [
    `The Match Engine scored this draft ${after.matchScore} versus original ${original.matchScore}.`,
    lost.length ? `Supported evidence became less visible: ${lost.join(', ')}. Restore it.` : '',
    hidden.length ? `Surface hidden supported evidence using existing wording: ${hidden.slice(0, 8).join('; ')}.` : '',
    missing.length ? `Do not add unsupported requirements: ${missing.slice(0, 8).join(', ')}.` : '',
    'Do not invent facts. Keep employers, titles, dates, and metrics unchanged.',
  ]
    .filter(Boolean)
    .join(' ')
}

export function preferredCandidate(
  original: MatchReport,
  left: { resume: TailoredResume; match: MatchReport; coverageAfter: number },
  right: { resume: TailoredResume; match: MatchReport; coverageAfter: number },
): { resume: TailoredResume; match: MatchReport; coverageAfter: number } {
  const lostLeft = lostSupportedNames(original, left.match).length
  const lostRight = lostSupportedNames(original, right.match).length
  if (lostLeft !== lostRight) return lostLeft < lostRight ? left : right
  if (left.match.matchScore !== right.match.matchScore) {
    return left.match.matchScore >= right.match.matchScore ? left : right
  }
  return left.coverageAfter >= right.coverageAfter ? left : right
}
