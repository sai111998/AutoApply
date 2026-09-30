import type { Frame, Page } from 'playwright'

export const V2_APPLY_LABEL = /^(apply now|apply to (this )?job|apply for (this )?job|start application|apply)$/i
export const V2_APPLY_MANUAL_LABEL = /^apply manually$/i
export const V2_NEXT_LABEL = /^(next|continue|save and continue|next step)$/i
export const V2_SUBMIT_LABEL =
  /^(submit( my)? application|send application|finish|complete application|submit)$/i

async function firstVisibleControl(
  page: Page,
  label: RegExp,
): Promise<{ frame: Frame | Page; index: number } | null> {
  const frames: Array<Frame | Page> = [page, ...page.frames().slice(1)]
  for (const frame of frames) {
    try {
      const buttons = frame.getByRole('button', { name: label })
      const count = await buttons.count()
      for (let index = 0; index < count; index += 1) {
        const candidate = buttons.nth(index)
        try {
          if (await candidate.isVisible({ timeout: 500 })) return { frame, index }
        } catch {
          continue
        }
      }
      const links = frame.getByRole('link', { name: label })
      const linkCount = await links.count()
      for (let index = 0; index < linkCount; index += 1) {
        const candidate = links.nth(index)
        try {
          if (await candidate.isVisible({ timeout: 500 })) return { frame, index: -1 - index }
        } catch {
          continue
        }
      }
    } catch {
      continue
    }
  }
  return null
}

export async function findV2ApplyControl(page: Page): Promise<boolean> {
  return (await firstVisibleControl(page, V2_APPLY_LABEL)) !== null
}

export async function clickV2Apply(page: Page): Promise<boolean> {
  const found = await firstVisibleControl(page, V2_APPLY_LABEL)
  if (!found) return false
  const controls =
    found.index >= 0
      ? found.frame.getByRole('button', { name: V2_APPLY_LABEL }).nth(found.index)
      : found.frame.getByRole('link', { name: V2_APPLY_LABEL }).nth(-1 - found.index)
  try {
    await controls.click({ timeout: 5000 })
    return true
  } catch {
    return false
  }
}

export async function findV2ApplyManualControl(page: Page): Promise<boolean> {
  return (await firstVisibleControl(page, V2_APPLY_MANUAL_LABEL)) !== null
}

export async function clickV2ApplyManual(page: Page): Promise<boolean> {
  const found = await firstVisibleControl(page, V2_APPLY_MANUAL_LABEL)
  if (!found) return false
  const controls =
    found.index >= 0
      ? found.frame.getByRole('button', { name: V2_APPLY_MANUAL_LABEL }).nth(found.index)
      : found.frame.getByRole('link', { name: V2_APPLY_MANUAL_LABEL }).nth(-1 - found.index)
  try {
    await controls.click({ timeout: 5000 })
    return true
  } catch {
    return false
  }
}

export async function findV2NextControl(page: Page): Promise<boolean> {
  return (await firstVisibleControl(page, V2_NEXT_LABEL)) !== null
}

export async function clickV2Next(page: Page): Promise<boolean> {
  const found = await firstVisibleControl(page, V2_NEXT_LABEL)
  if (!found) return false
  const controls =
    found.index >= 0
      ? found.frame.getByRole('button', { name: V2_NEXT_LABEL }).nth(found.index)
      : found.frame.getByRole('link', { name: V2_NEXT_LABEL }).nth(-1 - found.index)
  try {
    await controls.click({ timeout: 5000 })
    return true
  } catch {
    return false
  }
}

export async function findV2SubmitControl(page: Page): Promise<boolean> {
  return (await firstVisibleControl(page, V2_SUBMIT_LABEL)) !== null
}
