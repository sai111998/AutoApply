export interface FetchLike {
  (input: string, init?: RequestInit): Promise<Response>
}

export interface RequestPolicy {
  timeoutMs?: number
  retries?: number
  minIntervalMs?: number
  cacheTtlMs?: number
  cacheKey?: string
}

const lastCall = new Map<string, number>()
const cache = new Map<string, { expires: number; status: number; body: string; headers: [string, string][] }>()

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function shouldRetry(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504
}

export async function fetchWithPolicy(
  url: string,
  init: RequestInit,
  policy: RequestPolicy = {},
  fetchImpl: FetchLike = fetch,
): Promise<Response> {
  const timeoutMs = policy.timeoutMs ?? 12_000
  const retries = policy.retries ?? 1
  const minIntervalMs = policy.minIntervalMs ?? 250
  const cacheTtlMs = policy.cacheTtlMs ?? 0
  const bucket = policy.cacheKey ?? new URL(url).host

  if (cacheTtlMs > 0) {
    const hit = cache.get(bucket)
    if (hit && hit.expires > Date.now()) {
      return new Response(hit.body, { status: hit.status, headers: hit.headers })
    }
  }

  const wait = minIntervalMs - (Date.now() - (lastCall.get(bucket) ?? 0))
  if (wait > 0) await sleep(wait)

  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    lastCall.set(bucket, Date.now())
    try {
      const response = await fetchImpl(url, { ...init, signal: controller.signal })
      const body = await response.text()
      const headers = [...response.headers.entries()]
      if (shouldRetry(response.status) && attempt < retries) {
        await sleep(400 * 2 ** attempt)
        continue
      }
      if (cacheTtlMs > 0 && response.ok) {
        cache.set(bucket, { expires: Date.now() + cacheTtlMs, status: response.status, body, headers })
      }
      return new Response(body, { status: response.status, headers })
    } catch (error) {
      lastError = error
      const aborted = error instanceof Error && error.name === 'AbortError'
      if (attempt < retries && (aborted || error instanceof TypeError)) {
        await sleep(400 * 2 ** attempt)
        continue
      }
      if (aborted) {
        const timeout = new Error('The job provider timed out.')
        timeout.name = 'TimeoutError'
        throw timeout
      }
      throw error
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Job provider request failed.')
}

export function clearHttpCaches() {
  lastCall.clear()
  cache.clear()
}
