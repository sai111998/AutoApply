import { createHttpAnalysisClient } from './http-client'
import { pendingAnalysisClient } from './pending-client'
import type { JobAnalysisClient } from './types'

export function getJobAnalysisClient(): JobAnalysisClient {
  const baseUrl = import.meta.env.VITE_AI_API_URL?.trim()
  if (!baseUrl) return pendingAnalysisClient
  return createHttpAnalysisClient(baseUrl)
}

export type { AnalyzeJobRequest, AnalyzeJobResponse, JobAnalysisClient } from './types'
