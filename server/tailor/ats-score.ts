import { sameSkill, textContainsTerm, tokenOverlap } from '../match/normalize'
import type { TailoredResume } from './types'
import type { JdIntelligence, JdRequirement } from './jd-intel'
import type { CoverageMatrixRow, ResumeEvidenceRecord } from './evidence'

export interface AtsAlignmentBreakdown {
  atsAlignmentScore: number
  requiredCoverage: number
  preferredCoverage: number
  responsibilityCoverage: number
  experienceAlignment: number
  keywordAlignment: number
  educationAlignment: number
  supportedCoverageBefore: number
  supportedCoverageAfter: number
  requiredSupported: number
  requiredTotal: number
  preferredSupported: number
  preferredTotal: number
  responsibilitySupported: number
  responsibilityTotal: number
  representedSupported: number
  supportedTotal: number
  requirementTotal: number
}

function resumeBlob(resume: TailoredResume): string {
  return [
    resume.summary,
    resume.skills.join(' '),
    ...resume.experience.flatMap((role) => [role.title, role.company, ...role.bullets]),
    ...resume.projects.flatMap((project) => [project.name, ...project.bullets]),
    ...resume.education.map((item) => [item.degree, item.field, item.details].join(' ')),
    resume.certifications.join(' '),
  ].join('\n')
}

export function termRepresented(term: string, resume: TailoredResume): boolean {
  if (resume.skills.some((skill) => sameSkill(skill, term))) return true
  return textContainsTerm(resumeBlob(resume), term)
}

export function phraseRepresented(phrase: string, resume: TailoredResume): boolean {
  const blob = resumeBlob(resume)
  if (textContainsTerm(blob, phrase)) return true
  const tokens = phrase.split(/\s+/).filter((item) => item.length > 3)
  if (tokens.length === 0) return false
  const hits = tokens.filter((token) => textContainsTerm(blob, token)).length
  return hits / tokens.length >= 0.7 || tokenOverlap(phrase, blob) >= 0.4
}

function isPhraseType(type: ResumeEvidenceRecord['type']): boolean {
  return type === 'responsibility' || type === 'phrase' || type === 'education' || type === 'experience'
}

function representedIn(record: ResumeEvidenceRecord, resume: TailoredResume): boolean {
  return isPhraseType(record.type)
    ? phraseRepresented(record.requirement, resume)
    : termRepresented(record.requirement, resume)
}

function ratio(hits: number, total: number): number {
  if (total <= 0) return 1
  return hits / total
}

function percent(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 100)
}

function requirementsOf(
  jd: JdIntelligence,
  family: JdRequirement['family'],
  type?: JdRequirement['type'],
): JdRequirement[] {
  return jd.requirements.filter((item) => item.family === family && (!type || item.type === type))
}

function supportedFor(requirements: JdRequirement[], records: ResumeEvidenceRecord[]): JdRequirement[] {
  return requirements.filter((item) =>
    records.some(
      (record) =>
        record.requirement === item.name && (record.strength === 'strong' || record.strength === 'partial'),
    ),
  )
}

export function countRepresented(
  names: string[],
  resume: TailoredResume,
  kind: 'term' | 'phrase' = 'term',
): number {
  return names.filter((name) => (kind === 'phrase' ? phraseRepresented(name, resume) : termRepresented(name, resume)))
    .length
}

export function evaluateAtsAlignment(input: {
  jd: JdIntelligence
  records: ResumeEvidenceRecord[]
  original: TailoredResume
  tailored: TailoredResume
  yearsSupported: boolean
}): AtsAlignmentBreakdown {
  const requiredSkills = requirementsOf(input.jd, 'skill', 'required')
  const preferredSkills = requirementsOf(input.jd, 'skill', 'preferred')
  const responsibilities = requirementsOf(input.jd, 'responsibility')
  const education = [...requirementsOf(input.jd, 'education'), ...requirementsOf(input.jd, 'certification')]
  const phrases = input.jd.recruiterPhrases
  const experienceReqs = requirementsOf(input.jd, 'experience')

  const requiredSupported = supportedFor(requiredSkills, input.records)
  const preferredSupported = supportedFor(preferredSkills, input.records)
  const responsibilitySupported = supportedFor(responsibilities, input.records)
  const educationSupported = supportedFor(education, input.records)

  const requiredCoverage = ratio(
    countRepresented(requiredSupported.map((item) => item.name), input.tailored),
    requiredSkills.length,
  )
  const preferredCoverage = ratio(
    countRepresented(preferredSupported.map((item) => item.name), input.tailored),
    preferredSkills.length,
  )
  const responsibilityCoverage = ratio(
    countRepresented(responsibilitySupported.map((item) => item.name), input.tailored, 'phrase'),
    responsibilities.length,
  )
  const educationAlignment = ratio(
    countRepresented(educationSupported.map((item) => item.name), input.tailored, 'phrase'),
    education.length,
  )
  const keywordAlignment = ratio(countRepresented(phrases, input.tailored, 'phrase'), phrases.length)
  const experienceAlignment =
    experienceReqs.length === 0 ? (input.yearsSupported ? 1 : 0.7) : input.yearsSupported ? 1 : 0.4

  const coverageRecords = input.records.filter(
    (record) =>
      record.type === 'required' ||
      record.type === 'preferred' ||
      record.type === 'responsibility' ||
      record.type === 'education' ||
      record.type === 'certification',
  )
  const supported = coverageRecords.filter((record) => record.strength === 'strong' || record.strength === 'partial')
  const supportedBefore = supported.filter((record) => representedIn(record, input.original)).length
  const supportedAfter = supported.filter((record) => representedIn(record, input.tailored)).length

  const atsAlignmentScore = percent(
    requiredCoverage * 0.4 +
      preferredCoverage * 0.15 +
      responsibilityCoverage * 0.2 +
      experienceAlignment * 0.1 +
      keywordAlignment * 0.1 +
      educationAlignment * 0.05,
  )

  return {
    atsAlignmentScore,
    requiredCoverage: percent(requiredCoverage),
    preferredCoverage: percent(preferredCoverage),
    responsibilityCoverage: percent(responsibilityCoverage),
    experienceAlignment: percent(experienceAlignment),
    keywordAlignment: percent(keywordAlignment),
    educationAlignment: percent(educationAlignment),
    supportedCoverageBefore: supportedBefore,
    supportedCoverageAfter: supportedAfter,
    requiredSupported: requiredSupported.length,
    requiredTotal: requiredSkills.length,
    preferredSupported: preferredSupported.length,
    preferredTotal: preferredSkills.length,
    responsibilitySupported: responsibilitySupported.length,
    responsibilityTotal: responsibilities.length,
    representedSupported: supportedAfter,
    supportedTotal: supported.length,
    requirementTotal: coverageRecords.length,
  }
}

export function coverageSummary(matrix: CoverageMatrixRow[]): string {
  const supported = matrix.filter((row) => row.supported).length
  return `${supported} of ${matrix.length} job requirements have resume evidence.`
}
