import type { ServerConfig } from '../config'
import { JOB_EXTRACT_PROMPT, RESUME_EXTRACT_PROMPT, jobExtractUserPrompt, resumeExtractUserPrompt } from '../match/prompts'
import { HttpError } from '../types'

const LLM_TIMEOUT_MS = 45_000

export interface LlmClient {
  extractJson: (systemPrompt: string, userPrompt: string) => Promise<unknown>
  extractResume: (resumeText: string) => Promise<unknown>
  extractJob: (jobDescription: string) => Promise<unknown>
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: string | null } }[]
  error?: { message?: string }
}

async function postChat(config: ServerConfig, systemPrompt: string, userPrompt: string): Promise<unknown> {
  if (!config.llmApiKey) {
    throw new HttpError(503, 'LLM_API_KEY is not configured on the server. Add it to .env.local and restart.')
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS)

  try {
    const response = await fetch(`${config.llmApiBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.llmApiKey}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.llmModel,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    })

    const payload = (await response.json().catch(() => null)) as ChatCompletionResponse | null
    if (!response.ok) {
      const detail = payload?.error?.message || `LLM API returned ${response.status}`
      throw new HttpError(502, /key|secret|bearer/i.test(detail) ? 'The analysis model could not be reached.' : detail)
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
  } catch (error) {
    if (error instanceof HttpError) throw error
    if (error instanceof Error && error.name === 'AbortError') {
      throw new HttpError(504, 'The analysis model timed out. Please try again.')
    }
    throw new HttpError(502, 'The analysis model could not be reached.')
  } finally {
    clearTimeout(timeout)
  }
}

export function createLlmClient(config: ServerConfig): LlmClient {
  return {
    extractJson: (systemPrompt, userPrompt) => postChat(config, systemPrompt, userPrompt),
    extractResume: (resumeText) => postChat(config, RESUME_EXTRACT_PROMPT, resumeExtractUserPrompt(resumeText)),
    extractJob: (jobDescription) => postChat(config, JOB_EXTRACT_PROMPT, jobExtractUserPrompt(jobDescription)),
  }
}
