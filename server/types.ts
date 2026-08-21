export type Recommendation = 'APPLY' | 'REVIEW' | 'SKIP'

export interface AnalyzeJobRequestBody {
  jobDescription: string
  resumeText: string
  userId?: string
  resumeId?: string
  title?: string
  company?: string
  location?: string
  jobUrl?: string
}

export interface AnalysisResult {
  matchScore: number
  recommendation: Recommendation
  matchedSkills: string[]
  partiallyMatchedSkills: string[]
  missingSkills: string[]
  experienceMatch: boolean
  educationMatch: boolean
  locationMatch: boolean
  strengths: string[]
  concerns: string[]
  summary: string
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
