import type { Page } from 'playwright'
import type { CanonicalCandidateProfile } from '../application/candidate-profile'
import type { V2DetectedField } from './types'

export interface V2FieldDescriptor {
  frameIndex: number
  index: number
  tagIndex: number
  tag: 'input' | 'select' | 'textarea'
  type: string
  name: string
  label: string
  placeholder: string
  value: string
  checked: boolean
  required: boolean
  options: string[]
}

interface V2MappedField {
  descriptor: V2FieldDescriptor
  key: string
  value: string
}

export interface V2FieldMapping {
  mapped: V2MappedField[]
  unknownRequired: V2DetectedField[]
  detected: V2DetectedField[]
}

const TEXT_TYPES = new Set([
  '',
  'text',
  'email',
  'tel',
  'number',
  'search',
  'url',
  'date',
  'month',
  'password',
])

function collectDescriptorScript(): V2FieldDescriptor[] {
  const elements = [...document.querySelectorAll('input, select, textarea')]
  const output: V2FieldDescriptor[] = []
  const tagCounts: Record<string, number> = { input: 0, select: 0, textarea: 0 }
  elements.forEach((element, index) => {
    const tag = element.tagName.toLowerCase()
    if (tag !== 'input' && tag !== 'select' && tag !== 'textarea') return
    const input = element as HTMLInputElement
    const type = (input.type ?? '').toLowerCase()
    if (tag === 'input' && (type === 'hidden' || type === 'submit' || type === 'button')) return
    const rect = element.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) return
    const labeled = element as unknown as { labels?: ArrayLike<{ textContent: string | null }> | null }
    const labels = labeled.labels ? Array.from(labeled.labels) : []
    const labelText = labels.map((label) => label.textContent ?? '').join(' ').replace(/\s+/g, ' ').trim()
    const ariaLabel = element.getAttribute('aria-label')?.trim() ?? ''
    const label = labelText || ariaLabel
    const required =
      (element as HTMLInputElement).required === true ||
      element.getAttribute('aria-required') === 'true' ||
      /\*/.test(label)
    const options =
      tag === 'select' ? [...(element as HTMLSelectElement).options].map((o) => o.text.trim()) : []
    output.push({
      frameIndex: 0,
      index,
      tagIndex: tagCounts[tag],
      tag,
      type,
      name: element.getAttribute('name') ?? '',
      label: label.slice(0, 120),
      placeholder: element.getAttribute('placeholder')?.slice(0, 120) ?? '',
      value: (input.value ?? '').slice(0, 200),
      checked: (input as HTMLInputElement).checked === true,
      required,
      options: options.slice(0, 60),
    })
    tagCounts[tag] += 1
  })
  return output
}

export async function detectV2Fields(page: Page): Promise<V2FieldDescriptor[]> {
  const descriptors: V2FieldDescriptor[] = []
  const frames = page.frames()
  for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
    try {
      const collected = await frames[frameIndex].evaluate(collectDescriptorScript)
      for (const descriptor of collected) {
        descriptors.push({ ...descriptor, frameIndex })
      }
    } catch {
      continue
    }
  }
  return descriptors
}

export function classifyV2Field(descriptor: V2FieldDescriptor): string | null {
  const haystack = `${descriptor.label} ${descriptor.placeholder} ${descriptor.name}`.toLowerCase()
  if (descriptor.tag === 'input' && descriptor.type === 'file') {
    if (/cover\s*letter/.test(haystack)) return 'coverLetter'
    return 'resume'
  }
  if (descriptor.type === 'email' || /\bemail\b|\be-mail\b/.test(haystack)) return 'email'
  if (descriptor.type === 'tel' || /\bphone\b|mobile|telephone/.test(haystack)) return 'phone'
  if (/linked\s*in|\blinkedin\b/.test(haystack)) return 'linkedin'
  if (/\bgithub\b/.test(haystack)) return 'github'
  if (/first\s*name|given\s*name|first_name|^fname$/.test(haystack) && !/last/.test(haystack)) {
    return 'firstName'
  }
  if (/last\s*name|family\s*name|surname|last_name|^lname$/.test(haystack)) return 'lastName'
  if (/zip|postal/.test(haystack)) return 'zip'
  if (/street|address\s*line\s*1|^address$/.test(haystack)) return 'address'
  if (/\bcity\b|\btown\b/.test(haystack)) return 'city'
  if (/\bstate\b|province/.test(haystack)) return 'state'
  if (/country/.test(haystack)) return 'country'
  return null
}

function profileValueForKey(profile: CanonicalCandidateProfile, key: string): string {
  switch (key) {
    case 'firstName':
      return profile.firstName
    case 'lastName':
      return profile.lastName
    case 'email':
      return profile.email
    case 'phone':
      return profile.phone
    case 'address':
      return profile.address
    case 'city':
      return profile.city
    case 'state':
      return profile.state
    case 'zip':
      return profile.zip
    case 'country':
      return profile.country
    case 'linkedin':
      return profile.linkedin
    case 'github':
      return profile.github
    default:
      return ''
  }
}

export function mapV2Fields(
  descriptors: V2FieldDescriptor[],
  profile: CanonicalCandidateProfile,
): V2FieldMapping {
  const mapped: V2MappedField[] = []
  const unknownRequired: V2DetectedField[] = []
  const detected: V2DetectedField[] = []
  for (const descriptor of descriptors) {
    const key = classifyV2Field(descriptor)
    detected.push({
      key: key ?? 'unknown',
      label: descriptor.label || descriptor.placeholder || descriptor.name || descriptor.type,
      required: descriptor.required,
      kinds: [descriptor.tag, descriptor.type || 'text'],
    })
    if (key === 'resume' || key === 'coverLetter') continue
    if (!key) {
      if (descriptor.required && needsV2Interaction(descriptor)) {
        unknownRequired.push(detected[detected.length - 1])
      }
      continue
    }
    const value = profileValueForKey(profile, key).trim()
    if (!value) {
      if (descriptor.required && needsV2Interaction(descriptor)) {
        unknownRequired.push({
          key,
          label: descriptor.label || key,
          required: true,
          kinds: [descriptor.tag],
        })
      }
      continue
    }
    if (descriptor.required || descriptor.tag !== 'select') {
      mapped.push({ descriptor, key, value })
    } else if (descriptor.tag === 'select' && !descriptor.value) {
      mapped.push({ descriptor, key, value })
    }
  }
  return { mapped, unknownRequired, detected }
}

function needsV2Interaction(descriptor: V2FieldDescriptor): boolean {
  if (descriptor.tag === 'select') return !descriptor.value
  if (descriptor.tag === 'input' && (descriptor.type === 'checkbox' || descriptor.type === 'radio')) {
    return !descriptor.checked
  }
  return true
}

export function isV2TextField(descriptor: V2FieldDescriptor): boolean {
  if (descriptor.tag === 'textarea') return true
  if (descriptor.tag !== 'input') return false
  return TEXT_TYPES.has(descriptor.type)
}

export async function fillV2Fields(page: Page, mapped: V2MappedField[]): Promise<string[]> {
  const filled: string[] = []
  const frames = page.frames()
  for (const entry of mapped) {
    const frame = frames[entry.descriptor.frameIndex] ?? frames[0]
    if (!frame) continue
    const filledField = await fillV2Field(frame, entry)
    if (filledField) filled.push(entry.key)
  }
  return [...new Set(filled)]
}

async function fillV2Field(
  frame: { getByLabel: Page['getByLabel']; getByPlaceholder: Page['getByPlaceholder']; evaluate: Page['evaluate'] },
  entry: V2MappedField,
): Promise<boolean> {
  const { descriptor, value } = entry
  if (descriptor.tag === 'select') {
    return frame.evaluate(
      ({ tagIndex, target }) => {
        const selects = [...document.querySelectorAll('select')]
        const select = selects[tagIndex]
        if (!select) return false
        const normalized = target.toLowerCase()
        const match =
          [...select.options].find((option) => option.text.trim().toLowerCase() === normalized) ??
          [...select.options].find((option) => option.text.toLowerCase().includes(normalized)) ??
          [...select.options].find((option) => option.value && option.value.trim() !== '')
        if (!match) return false
        select.value = match.value || match.text
        select.dispatchEvent(new Event('input', { bubbles: true }))
        select.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      },
      { tagIndex: descriptor.tagIndex, target: value },
    ) as Promise<boolean>
  }
  if (!isV2TextField(descriptor)) return false
  const label = descriptor.label.replace(/\*/g, '').trim()
  if (label) {
    try {
      const locator = frame.getByLabel(label, { exact: false }).first()
      if ((await locator.count()) > 0) {
        await locator.fill(value, { timeout: 4000 })
        return true
      }
    } catch {
      // fall through to placeholder/index strategies
    }
  }
  if (descriptor.placeholder) {
    try {
      const locator = frame.getByPlaceholder(descriptor.placeholder).first()
      if ((await locator.count()) > 0) {
        await locator.fill(value, { timeout: 4000 })
        return true
      }
    } catch {
      // fall through to index strategy
    }
  }
  try {
    return (await frame.evaluate(
      ({ tag, tagIndex, target }) => {
        const fields = [...document.querySelectorAll(tag)].filter((element) => {
          if (tag === 'input') {
            const type = (element.getAttribute('type') ?? '').toLowerCase()
            if (type === 'hidden' || type === 'submit' || type === 'button') return false
          }
          const rect = element.getBoundingClientRect()
          return rect.width > 0 || rect.height > 0
        })
        const field = fields[tagIndex] as HTMLInputElement | HTMLTextAreaElement | undefined
        if (!field) return false
        field.focus()
        ;(field as HTMLInputElement).value = target
        field.dispatchEvent(new Event('input', { bubbles: true }))
        field.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      },
      { tag: descriptor.tag, tagIndex: descriptor.tagIndex, target: value },
    )) as boolean
  } catch {
    return false
  }
}
