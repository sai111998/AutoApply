const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'for', 'to', 'in'])
const ROLE_SOFT = new Set(['developer', 'engineer', 'software', 'senior', 'jr', 'junior'])

export function expandSearchQueries(query: string): string[] {
  const original = query.trim()
  if (!original) return ['']
  const lower = original.toLowerCase()
  const variants = new Set<string>([original])
  const hasFullStack = /full[\s-]*stack/.test(lower)
  const hasJava = /\bjava\b/.test(lower)
  const hasDeveloper = /\bdeveloper\b/.test(lower)
  const hasEngineer = /\bengineer\b/.test(lower)

  if (hasFullStack && hasJava) {
    variants.add('Java Full Stack Developer')
    variants.add('Full Stack Engineer Java')
    variants.add('Java Software Engineer')
    variants.add('Software Engineer Java')
  } else if (hasFullStack && (hasDeveloper || hasEngineer || lower.includes('full stack'))) {
    variants.add('Full Stack Engineer')
    variants.add('Software Engineer Full Stack')
    variants.add('Full Stack Software Engineer')
  } else if (hasJava && (hasDeveloper || hasEngineer)) {
    variants.add('Java Software Engineer')
    variants.add('Software Engineer Java')
    variants.add('Java Engineer')
  }

  return [...variants].slice(0, 4)
}

export function queryTokensMatch(
  job: { title: string; company: string; description?: string | null; location?: string | null },
  query: string,
): boolean {
  const raw = query.trim().toLowerCase()
  if (!raw) return true
  const tokens = raw.split(/[\s,/]+/).filter((item) => item.length > 1 && !STOP.has(item))
  if (!tokens.length) return true
  const haystack = `${job.title} ${job.company} ${job.description ?? ''} ${job.location ?? ''}`.toLowerCase()
  const hard = tokens.filter((token) => !ROLE_SOFT.has(token) && token !== 'full' && token !== 'stack')
  const hasFullStackQuery = tokens.includes('full') && tokens.includes('stack')
  if (hasFullStackQuery && !/full[\s-]*stack/.test(haystack)) return false
  if (hard.some((token) => !haystack.includes(token))) return false
  const soft = tokens.filter((token) => ROLE_SOFT.has(token))
  if (!soft.length) return true
  return soft.some((token) => haystack.includes(token) || (token === 'developer' && haystack.includes('engineer')) || (token === 'engineer' && haystack.includes('developer')))
}
