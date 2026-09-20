import { applicationDetector } from '../detection/application-detector'
import { fillSelectorsFor, isFinalSubmitText, isLegitimateApplyText, isLegitimateNextText } from '../agent/fill'
import type { AgentProfileValues } from '../shared/queue'

function isVisible(node: Element): boolean {
  const el = node as HTMLElement
  if (el.hidden || el.closest('[hidden]')) return false
  const style = window.getComputedStyle(el)
  if (style.display === 'none' || style.visibility === 'hidden') return false
  return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
}

function clickByText(accept: (label: string) => boolean): { clicked: boolean; label: string | null } {
  const nodes = [...document.querySelectorAll('button, a, [role="button"], input[type="submit"], input[type="button"]')]
  for (const node of nodes) {
    if (!isVisible(node)) continue
    const label = ((node as HTMLElement).innerText || (node as HTMLInputElement).value || '').replace(/\s+/g, ' ').trim()
    if (!accept(label)) continue
    ;(node as HTMLElement).click()
    return { clicked: true, label }
  }
  return { clicked: false, label: null }
}

function fillValues(values: Partial<AgentProfileValues>): string[] {
  const filled: string[] = []
  const seen = new Set<Element>()
  for (const step of fillSelectorsFor(values)) {
    const el = document.querySelector(step.selector) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null
    if (!el || seen.has(el)) continue
    if (el instanceof HTMLInputElement && el.type === 'file') continue
    seen.add(el)
    el.focus()
    el.value = step.value
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    filled.push(step.selector)
  }
  return filled
}

async function uploadResume(contentBase64: string, fileName: string, mimeType: string): Promise<boolean> {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement | null
  if (!input) return false
  const bytes = Uint8Array.from(atob(contentBase64), (char) => char.charCodeAt(0))
  const file = new File([bytes], fileName, { type: mimeType })
  const transfer = new DataTransfer()
  transfer.items.add(file)
  input.files = transfer.files
  input.dispatchEvent(new Event('change', { bubbles: true }))
  return true
}

function snapshot() {
  const url = location.href
  const title = document.title
  const html = document.documentElement.outerHTML
  const nodes = [...document.querySelectorAll('button, a, [role="button"], input[type="submit"], input[type="button"]')]
  const visibleLabels = nodes
    .filter(isVisible)
    .map((node) => ((node as HTMLElement).innerText || (node as HTMLInputElement).value || '').replace(/\s+/g, ' ').trim())
  return {
    url,
    title,
    html,
    detection: applicationDetector({ html, url, title }),
    visible: {
      apply: visibleLabels.some(isLegitimateApplyText),
      next: visibleLabels.some((label) => isLegitimateNextText(label) && !isFinalSubmitText(label)),
      submit: visibleLabels.some(isFinalSubmitText),
    },
  }
}

chrome.runtime.onMessage.addListener((raw, _sender, sendResponse) => {
  const message = raw && typeof raw === 'object' ? (raw as { type?: string } & Record<string, unknown>) : {}
  if (message.type === 'INSPECT_PAGE') {
    sendResponse({ type: 'PAGE_INSPECTION', ...snapshot(), session: null })
    return
  }
  if (message.type === 'RUN_AGENT_STEP') {
    void (async () => {
      const values = (message.values ?? {}) as Partial<AgentProfileValues>
      const filled = fillValues(values)
      let uploaded = false
      if (message.resume && typeof message.resume === 'object') {
        const resume = message.resume as { contentBase64?: string; fileName?: string; mimeType?: string }
        if (resume.contentBase64) {
          uploaded = await uploadResume(resume.contentBase64, resume.fileName || 'resume.txt', resume.mimeType || 'text/plain')
        }
      }
      let clicked: { clicked: boolean; label: string | null } = { clicked: false, label: null }
      if (message.click === 'apply') clicked = clickByText(isLegitimateApplyText)
      if (message.click === 'next') clicked = clickByText((label) => isLegitimateNextText(label) && !isFinalSubmitText(label))
      sendResponse({ ok: true, filled, uploaded, clicked, ...snapshot() })
    })()
    return true
  }
})
