import type { Job, Profile, Resume, Skill } from '@/types/domain'

export interface AnalysisCandidatePayload {
  profile: Profile
  skills: Skill[]
  resume: Pick<Resume, 'id' | 'versionLabel' | 'fileName'> | null
}

export interface AnalyzeJobRequest {
  job: Pick<Job, 'title' | 'company' | 'location' | 'jobUrl' | 'description'>
  candidate: AnalysisCandidatePayload
}

export interface AnalyzeJobSuccess {
  overallScore: number
  skillsMatched: { name: string; note?: string }[]
  skillsPartial: { name: string; note?: string }[]
  skillsMissing: { name: string; note?: string }[]
  experienceMatch: { score: number; summary: string }
  educationMatch: { score: number; summary: string }
  locationMatch: { score: number; summary: string }
  workAuthorization: string
  strengths: string[]
  concerns: string[]
  recommendation: 'APPLY' | 'REVIEW' | 'SKIP'
  provider?: string
}

export type AnalyzeJobResponse =
  | {
      status: 'complete'
      result: AnalyzeJobSuccess
    }
  | {
      status: 'unavailable' | 'queued' | 'failed'
      message: string
    }

export interface JobAnalysisClient {
  isConfigured: () => boolean
  analyze: (request: AnalyzeJobRequest) => Promise<AnalyzeJobResponse>
}
