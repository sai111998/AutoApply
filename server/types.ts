import type { Confidence, MatchReport, Recommendation } from './match/types'

export type { Recommendation }

export interface AnalyzeJobRequestBody {
  jobDescription: string
  resumeText: string
  userId?: string
  resumeId?: string
  jobId?: string
  matchId?: string
  applicationId?: string
  title?: string
  company?: string
  location?: string
  jobUrl?: string
}

export interface AnalysisResult {
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
  requiredSkills: MatchReport['requiredSkills']
  preferredSkills: MatchReport['preferredSkills']
  experience: MatchReport['experience']
  responsibilities: MatchReport['responsibilities']
  education: MatchReport['education']
  certifications: MatchReport['certifications']
  locationFit: MatchReport['location']
  missingEvidence: string[]
  report: MatchReport
}

export interface AnalyzeJobResponseBody extends AnalysisResult {
  persisted: boolean
  jobId: string | null
  matchId: string | null
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}
