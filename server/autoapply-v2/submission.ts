import type { Frame, Page } from 'playwright'
import { V2_SUBMIT_LABEL } from './navigation'

export async function clickV2Submit(page: Page): Promise<boolean> {
  const frames: Array<Frame | Page> = [page, ...page.frames().slice(1)]
  for (const frame of frames) {
    try {
      const buttons = frame.getByRole('button', { name: V2_SUBMIT_LABEL })
      const count = await buttons.count()
      for (let index = 0; index < count; index += 1) {
        const candidate = buttons.nth(index)
        try {
          if (!(await candidate.isVisible({ timeout: 500 })) || !(await candidate.isEnabled({ timeout: 500 }))) {
            continue
          }
          await candidate.click({ timeout: 5000 })
          return true
        } catch {
          continue
        }
      }
    } catch {
      continue
    }
  }
  return false
}
