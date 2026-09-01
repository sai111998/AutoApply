const SENIORITY = /^(senior|staff|principal|lead|junior|jr\.?|sr\.?|entry[- ]level)\s+/i

export function shortRoleLabel(jobTitle: string): string {
  let title = jobTitle.trim()
  if (!title) return 'Role'
  title = title.split(/\s+[—–-]\s+/)[0] ?? title
  title = title.split(',')[0]?.trim() ?? title
  title = title.replace(SENIORITY, '')
  title = title.replace(/\bsoftware\s+(engineer|developer|analyst|architect)\b/i, '$1')
  const words = title.split(/\s+/).filter(Boolean)
  if (words.length > 3) title = words.slice(0, 3).join(' ')
  return title.trim() || 'Role'
}

export function compactVersionName(versionName: string, jobTitle?: string): string {
  const raw = versionName.trim()
  if (!raw) return jobTitle ? `Tailored — ${shortRoleLabel(jobTitle)}` : 'Tailored'
  if (/^master(\s+resume)?$/i.test(raw)) return 'Master'

  const role = shortRoleLabel(jobTitle || roleFromVersionName(raw))
  const tailoredVersion = raw.match(/^tailored\s+v(\d+)/i)
  if (tailoredVersion) return `Tailored v${tailoredVersion[1]} — ${role}`
  if (/^tailored\b/i.test(raw)) return `Tailored — ${role}`
  const editedVersion = raw.match(/^edited(?:\s+tailored)?\s+v(\d+)/i)
  if (editedVersion) return `Edited v${editedVersion[1]} — ${role}`
  if (/^edited\b/i.test(raw)) return `Edited — ${role}`
  if (raw.length <= 28) return raw
  return `Tailored — ${role}`
}

function roleFromVersionName(versionName: string): string {
  const withoutPrefix = versionName
    .replace(/^(tailored|edited)(?:\s+tailored)?(?:\s+v\d+)?(?:\s+resume)?\s*[—–:-]\s*/i, '')
    .replace(/\s+[—–-]\s+.*$/, '')
    .replace(/\s+generated version$/i, '')
    .trim()
  return withoutPrefix || versionName
}

export function nextTailoredVersionName(versions: { createdBy: string; status: string }[], jobTitle: string): string {
  const role = shortRoleLabel(jobTitle)
  const count = versions.filter((item) => item.createdBy === 'ai' && isUsable(item.status)).length
  if (count === 0) return `Tailored — ${role}`
  return `Tailored v${count + 1} — ${role}`
}

export function nextEditedVersionName(versions: { createdBy: string; status: string }[], jobTitle: string): string {
  const role = shortRoleLabel(jobTitle)
  const count = versions.filter((item) => item.createdBy === 'user' && isUsable(item.status)).length
  if (count === 0) return `Edited — ${role}`
  return `Edited v${count + 1} — ${role}`
}

function isUsable(status: string): boolean {
  return status === 'completed' || status === 'kept' || status === 'edited'
}

export function versionTypeLabel(input: { createdBy?: string; status?: string; isMaster?: boolean }): string {
  if (input.isMaster) return 'Master'
  if (input.status === 'failed') return 'Failed'
  if (input.createdBy === 'user' || input.status === 'edited') return 'User edited'
  if (input.status === 'kept') return 'AI generated'
  return 'AI generated'
}
