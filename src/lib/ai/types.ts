export type Recommendation = 'APPLY' | 'REVIEW' | 'SKIP'

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

export interface AnalyzeJobApiResult {
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
  persisted: boolean
  jobId: string | null
  matchId: string | null
}

export type AnalyzeJobClientResponse =
  | { status: 'complete'; result: AnalyzeJobApiResult }
  | { status: 'failed'; message: string }
