import type { ServerConfig } from '../config'
import { buildUserPrompt, SYSTEM_PROMPT } from '../prompt'
import { HttpError } from '../types'

export interface LlmClient {
  complete: (jobDescription: string, resumeText: string) => Promise<unknown>
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: string | null } }[]
  error?: { message?: string }
}

export function createLlmClient(config: ServerConfig): LlmClient {
  return {
    complete: async (jobDescription, resumeText) => {
      if (!config.llmApiKey) {
        throw new HttpError(
          503,
          'LLM_API_KEY is not configured on the server. Add it to .env.local and restart.',
        )
      }

      const response = await fetch(`${config.llmApiBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.llmApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: config.llmModel,
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: buildUserPrompt(jobDescription, resumeText) },
          ],
        }),
      })

      const payload = (await response.json().catch(() => null)) as ChatCompletionResponse | null
      if (!response.ok) {
        const detail = payload?.error?.message || `LLM API returned ${response.status}`
        throw new HttpError(502, detail)
      }

      const content = payload?.choices?.[0]?.message?.content
      if (!content) {
        throw new HttpError(502, 'LLM API returned an empty analysis')
      }

      try {
        return JSON.parse(content) as unknown
      } catch {
        throw new HttpError(502, 'LLM API returned JSON that could not be parsed')
      }
    },
  }
}
