export type Recommendation = 'APPLY' | 'REVIEW' | 'SKIP'
export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW'
export type SkillClass = 'strong' | 'partial' | 'missing' | 'not_applicable'
export type RequirementSource = 'required' | 'preferred'
export type FitStatus = 'match' | 'partial' | 'gap' | 'missing' | 'insufficient_evidence' | 'not_applicable' | 'unknown'

export interface AnalyzeJobApiRequest {
  jobDescription: string
  resumeText: string
  userId?: string
  resumeId?: string
  title?: string
  company?: string
  location?: string
  jobUrl?: string
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
}

export interface AnalyzeJobApiResult {
  matchScore: number
  recommendation: Recommendation
  confidence: Confidence
  matchedSkills: string[]
  partiallyMatchedSkills: string[]
  missingSkills: string[]
  experienceMatch: boolean
  educationMatch: boolean
  locationMatch: boolean
  strengths: string[]
  concerns: string[]
  summary: string
  requiredSkills?: MatchReport['requiredSkills']
  preferredSkills?: MatchReport['preferredSkills']
  experience?: DimensionReport
  responsibilities?: MatchReport['responsibilities']
  education?: MatchReport['education']
  certifications?: MatchReport['certifications']
  locationFit?: MatchReport['location']
  missingEvidence?: string[]
  report?: MatchReport
  persisted: boolean
  jobId: string | null
  matchId: string | null
}

export type AnalyzeJobClientResponse =
  | { status: 'complete'; result: AnalyzeJobApiResult }
  | { status: 'failed'; message: string }
