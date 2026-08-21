import type { AnalyzeJobResponse, JobAnalysisClient } from './types'

const UNAVAILABLE_MESSAGE =
  'No analysis API is connected. JobPilot queued this role and will score it when VITE_AI_API_URL points at an analysis service.'

export const pendingAnalysisClient: JobAnalysisClient = {
  isConfigured: () => false,
  analyze: async (): Promise<AnalyzeJobResponse> => ({
    status: 'unavailable',
    message: UNAVAILABLE_MESSAGE,
  }),
}
