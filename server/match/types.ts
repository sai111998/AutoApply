export type Recommendation = 'APPLY' | 'REVIEW' | 'SKIP'
export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW'
export type SkillClass = 'strong' | 'partial' | 'missing' | 'not_applicable'
export type RequirementSource = 'required' | 'preferred'
export type FitStatus = 'match' | 'partial' | 'gap' | 'missing' | 'insufficient_evidence' | 'not_applicable' | 'unknown'

export interface EvidenceItem {
  name: string
  evidence: string
  years?: number | null
  category?: string
}

export interface EducationItem {
  degree: string
  field: string
  evidence: string
}

export interface ResumeProfile {
  skills: EvidenceItem[]
  languages: EvidenceItem[]
  frameworks: EvidenceItem[]
  cloud: EvidenceItem[]
  databases: EvidenceItem[]
  devops: EvidenceItem[]
  security: EvidenceItem[]
  jobTitles: string[]
  employers: string[]
  yearsOfExperience: number | null
  education: EducationItem[]
  certifications: EvidenceItem[]
  projects: EvidenceItem[]
  responsibilities: EvidenceItem[]
  achievements: EvidenceItem[]
  location: string
  workArrangement: string
  workAuthorization: string
}

export interface JobSkill {
  name: string
  category?: string
}

export interface JobProfile {
  requiredSkills: JobSkill[]
  preferredSkills: JobSkill[]
  languages: JobSkill[]
  frameworks: JobSkill[]
  cloud: JobSkill[]
  databases: JobSkill[]
  tools: JobSkill[]
  security: JobSkill[]
  yearsOfExperience: number | null
  skillYears: { name: string; years: number }[]
  education: { required: boolean; degree: string; field: string; details: string }
  certifications: { required: string[]; preferred: string[] }
  location: string
  workArrangement: string
  employmentType: string
  sponsorship: string
  responsibilities: { text: string; required: boolean }[]
}

export interface SkillAssessment {
  name: string
  classification: SkillClass
  source: RequirementSource
  evidence: string
}

export interface DimensionReport {
  status: FitStatus
  jobRequirement: string
  candidateEvidence: string
  gap: string
}

export const SCORE_WEIGHTS = {
  requiredSkills: 0.4,
  experience: 0.2,
  responsibilities: 0.15,
  educationCerts: 0.1,
  preferredSkills: 0.1,
  location: 0.05,
} as const

export interface MatchReport {
  matchScore: number
  recommendation: Recommendation
  confidence: Confidence
  requiredSkills: {
    matched: SkillAssessment[]
    partial: SkillAssessment[]
    missing: SkillAssessment[]
  }
  preferredSkills: {
    matched: SkillAssessment[]
    partial: SkillAssessment[]
    missing: SkillAssessment[]
  }
  experience: DimensionReport
  responsibilities: {
    strongMatches: SkillAssessment[]
    partialMatches: SkillAssessment[]
    gaps: SkillAssessment[]
  }
  education: { status: FitStatus; details: string }
  certifications: { matched: SkillAssessment[]; missing: SkillAssessment[] }
  location: { status: FitStatus; details: string }
  strengths: string[]
  concerns: string[]
  missingEvidence: string[]
  summary: string
  scoring: {
    weights: typeof SCORE_WEIGHTS
    components: Record<keyof typeof SCORE_WEIGHTS, number>
  }
}
