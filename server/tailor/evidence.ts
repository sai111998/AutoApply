import { extractResumeEvidence } from '../match/extract-local'
import { parseSourceRoles } from './source'
import { candidateImplements, relatedSkill, sameSkill, textContainsTerm, tokenOverlap } from '../match/normalize'
import type { SourceFacts } from './types'
import type { JdIntelligence, RequirementKind } from './jd-intel'

export type EvidenceStrength = 'strong' | 'partial' | 'related' | 'missing'

export interface ResumeEvidenceRecord {
  requirement: string
  candidateEvidence: string
  sourceLocation: string
  strength: EvidenceStrength
  supportedTerminology: string[]
  type: RequirementKind | 'responsibility' | 'education' | 'certification' | 'experience' | 'phrase' | 'domain'
}

export interface CoverageMatrixRow {
  requirement: string
  type: ResumeEvidenceRecord['type']
  evidence: string
  coverage: EvidenceStrength
  supported: boolean
}

function sectionOf(location: string): string {
  const lower = location.toLowerCase()
  if (lower.includes('summary')) return 'Summary'
  if (lower.includes('skill')) return 'Skills'
  if (lower.includes('project')) return 'Projects'
  if (lower.includes('certif')) return 'Certifications'
  if (lower.includes('education')) return 'Education'
  return location
}

function roleLocation(title: string, company: string, index: number): string {
  return `${title} → bullet ${index + 1} (${company})`
}

function uniqueTerms(values: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const key = value.trim().toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    result.push(value.trim())
  }
  return result
}

export function collectResumeLocations(source: SourceFacts): Array<{ location: string; text: string }> {
  const items: Array<{ location: string; text: string }> = []
  const summary = source.text.match(/^summary\s*\n([\s\S]*?)(?=\n(?:skills|experience|education|certifications|projects)\b|$)/im)?.[1]
  if (summary?.trim()) items.push({ location: 'Summary', text: summary.trim() })

  const skills = source.text.match(/^skills\s*\n([\s\S]*?)(?=\n(?:summary|experience|education|certifications|projects)\b|$)/im)?.[1]
  if (skills?.trim()) items.push({ location: 'Skills', text: skills.trim() })

  const roles = source.roles.length ? source.roles : parseSourceRoles(source.text)
  for (const role of roles) {
    role.bullets.forEach((bullet, index) => {
      items.push({ location: roleLocation(role.title, role.company, index), text: bullet })
    })
  }

  const projects = source.text.match(/^projects\s*\n([\s\S]*?)(?=\n(?:summary|skills|experience|education|certifications)\b|$)/im)?.[1]
  if (projects?.trim()) items.push({ location: 'Projects', text: projects.trim() })

  const education = source.text.match(/^education\s*\n([\s\S]*?)(?=\n(?:summary|skills|experience|certifications|projects)\b|$)/im)?.[1]
  if (education?.trim()) items.push({ location: 'Education', text: education.trim() })

  const certs = source.text.match(/^certifications\s*\n([\s\S]*?)(?=\n(?:summary|skills|experience|education|projects)\b|$)/im)?.[1]
  if (certs?.trim()) items.push({ location: 'Certifications', text: certs.trim() })

  return items
}

function classifyHit(requirement: string, text: string, sourceSkills: string[]): EvidenceStrength | null {
  if (textContainsTerm(text, requirement) || sourceSkills.some((skill) => sameSkill(skill, requirement) && textContainsTerm(text, skill))) {
    return 'strong'
  }
  if (sourceSkills.some((skill) => candidateImplements(requirement, skill) && textContainsTerm(text, skill))) {
    return 'strong'
  }
  if (tokenOverlap(requirement, text) >= 0.45) return 'partial'
  if (sourceSkills.some((skill) => relatedSkill(requirement, skill) && textContainsTerm(text, skill))) {
    return 'related'
  }
  return null
}

export function extractRequirementEvidence(
  jd: JdIntelligence,
  source: SourceFacts,
): ResumeEvidenceRecord[] {
  const locations = collectResumeLocations(source)
  const extracted = extractResumeEvidence(source.text)
  const records: ResumeEvidenceRecord[] = []

  for (const requirement of jd.requirements) {
    let best: ResumeEvidenceRecord = {
      requirement: requirement.name,
      candidateEvidence: '',
      sourceLocation: '',
      strength: 'missing',
      supportedTerminology: [],
      type:
        requirement.family === 'skill'
          ? requirement.type
          : requirement.family,
    }

    for (const location of locations) {
      const strength = classifyHit(requirement.name, location.text, source.skills)
      if (!strength) continue
      const rank = { strong: 3, partial: 2, related: 1, missing: 0 }
      if (rank[strength] > rank[best.strength]) {
        const terms = uniqueTerms([
          requirement.name,
          ...source.skills.filter((skill) => textContainsTerm(location.text, skill)),
        ])
        best = {
          requirement: requirement.name,
          candidateEvidence: location.text,
          sourceLocation: sectionOf(location.location),
          strength,
          supportedTerminology: terms,
          type: best.type,
        }
      }
    }

    if (best.strength === 'missing') {
      const fallback = extracted.find(
        (item) =>
          (item.skill && sameSkill(item.skill, requirement.name)) ||
          (item.responsibility && tokenOverlap(item.responsibility, requirement.name) >= 0.4),
      )
      if (fallback) {
        best = {
          requirement: requirement.name,
          candidateEvidence: fallback.evidence,
          sourceLocation: fallback.source || fallback.context || 'Resume',
          strength: fallback.skill ? 'strong' : 'partial',
          supportedTerminology: uniqueTerms([fallback.skill, fallback.technology].filter((item): item is string => Boolean(item))),
          type: best.type,
        }
      }
    }

    records.push(best)
  }

  return records
}

export function buildCoverageMatrix(records: ResumeEvidenceRecord[]): CoverageMatrixRow[] {
  return records.map((record) => ({
    requirement: record.requirement,
    type: record.type,
    evidence: record.candidateEvidence || 'None',
    coverage: record.strength,
    supported: record.strength === 'strong' || record.strength === 'partial',
  }))
}

export function formatCoverageMatrix(rows: CoverageMatrixRow[]): string {
  const header = '| JD Requirement | Type | Resume Evidence | Coverage |'
  const divider = '| --- | --- | --- | --- |'
  const body = rows.map((row) => {
    const evidence = row.evidence === 'None' ? 'None' : row.evidence.slice(0, 80)
    return `| ${row.requirement} | ${row.type} | ${evidence} | ${row.coverage} |`
  })
  return [header, divider, ...body].join('\n')
}

export function supportedRequirements(records: ResumeEvidenceRecord[]): ResumeEvidenceRecord[] {
  return records.filter((record) => record.strength === 'strong' || record.strength === 'partial')
}
