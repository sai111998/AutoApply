import type { AnalyzeJobRequest, AnalyzeJobResponse, AnalyzeJobSuccess, JobAnalysisClient } from './types'

function isSuccessPayload(value: unknown): value is AnalyzeJobSuccess {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.overallScore === 'number' &&
    Array.isArray(record.skillsMatched) &&
    Array.isArray(record.skillsPartial) &&
    Array.isArray(record.skillsMissing) &&
    Array.isArray(record.strengths) &&
    Array.isArray(record.concerns) &&
    (record.recommendation === 'APPLY' ||
      record.recommendation === 'REVIEW' ||
      record.recommendation === 'SKIP')
  )
}

export function createHttpAnalysisClient(baseUrl: string): JobAnalysisClient {
  const endpoint = `${baseUrl.replace(/\/$/, '')}/v1/analyze`

  return {
    isConfigured: () => true,
    analyze: async (request: AnalyzeJobRequest): Promise<AnalyzeJobResponse> => {
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
        })

        if (response.status === 202) {
          return {
            status: 'queued',
            message: 'The analysis API accepted this job and will return results asynchronously.',
          }
        }

        if (!response.ok) {
          const detail = await response.text()
          return {
            status: 'failed',
            message: detail || `Analysis API returned ${response.status}.`,
          }
        }

        const payload: unknown = await response.json()
        if (!isSuccessPayload(payload)) {
          return {
            status: 'failed',
            message: 'Analysis API returned an unexpected payload. Check the /v1/analyze contract.',
          }
        }

        return { status: 'complete', result: payload }
      } catch (error) {
        return {
          status: 'failed',
          message:
            error instanceof Error
              ? error.message
              : 'Could not reach the analysis API.',
        }
      }
    },
  }
}
