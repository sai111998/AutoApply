import { applicationDetector } from '../detection/application-detector'
import { isAgentMessage } from '../shared/messages'
import type { PageInspectionMessage } from '../shared/messages'

function inspectCurrentPage(): PageInspectionMessage {
  const url = location.href
  const title = document.title
  const html = document.documentElement.outerHTML
  const detection = applicationDetector({ html, url, title })
  if (detection.challenges.captcha) {
    chrome.runtime.sendMessage({ type: 'CAPTCHA_DETECTED', url })
  } else if (detection.challenges.mfa) {
    chrome.runtime.sendMessage({ type: 'MFA_DETECTED', url })
  } else if (detection.challenges.login) {
    chrome.runtime.sendMessage({ type: 'LOGIN_REQUIRED', url })
  } else if (detection.isApplicationPage) {
    chrome.runtime.sendMessage({ type: 'APPLICATION_DETECTED', detection, url })
    chrome.runtime.sendMessage({ type: 'PROVIDER_DETECTED', provider: detection.provider, url })
    chrome.runtime.sendMessage({ type: 'APPLICATION_READY', detection, url })
  } else {
    chrome.runtime.sendMessage({
      type: 'APPLICATION_FAILED',
      reason: detection.isJobDetailsPage
        ? 'The page is a job listing. An Apply action is required.'
        : 'The employer application form could not be found.',
      url,
    })
  }
  return { type: 'PAGE_INSPECTION', url, title, detection, session: null }
}

const inspection = inspectCurrentPage()

chrome.runtime.onMessage.addListener((raw, _sender, sendResponse) => {
  if (!isAgentMessage(raw) || raw.type !== 'INSPECT_PAGE') return
  sendResponse(inspectCurrentPage())
})

void inspection
