const ALIASES: Record<string, string> = {
  js: 'javascript',
  'javascript': 'javascript',
  ts: 'typescript',
  'typescript': 'typescript',
  reactjs: 'react',
  'react.js': 'react',
  react: 'react',
  node: 'node.js',
  nodejs: 'node.js',
  'node.js': 'node.js',
  k8s: 'kubernetes',
  kubernetes: 'kubernetes',
  postgres: 'postgresql',
  postgresql: 'postgresql',
  psql: 'postgresql',
  aws: 'amazon web services',
  'amazon web services': 'amazon web services',
  gcp: 'google cloud',
  'google cloud platform': 'google cloud',
  'google cloud': 'google cloud',
  azure: 'microsoft azure',
  'microsoft azure': 'microsoft azure',
  'ci/cd': 'ci/cd',
  cicd: 'ci/cd',
  'github actions': 'github actions',
  jest: 'jest',
  playwright: 'playwright',
  tailwind: 'tailwind css',
  'tailwind css': 'tailwind css',
  'tailwindcss': 'tailwind css',
  css: 'css',
  graphql: 'graphql',
  docker: 'docker',
  terraform: 'terraform',
  python: 'python',
  java: 'java',
  'spring boot': 'spring boot',
  springboot: 'spring boot',
  kotlin: 'kotlin',
  rust: 'rust',
  go: 'go',
  golang: 'go',
}

const FAMILIES: string[][] = [
  ['react', 'react.js', 'reactjs'],
  ['javascript', 'js'],
  ['typescript', 'ts'],
  ['node.js', 'nodejs', 'node'],
  ['postgresql', 'postgres'],
  ['amazon web services', 'aws'],
  ['google cloud', 'gcp', 'google cloud platform'],
  ['microsoft azure', 'azure'],
  ['tailwind css', 'tailwind', 'tailwindcss'],
  ['kubernetes', 'k8s'],
  ['go', 'golang'],
  ['spring boot', 'springboot'],
]

/** Related but not equivalent — may support a Partial classification only. */
const RELATED: Record<string, string[]> = {
  containerization: ['docker', 'podman'],
  containers: ['docker'],
  'ci/cd': ['github actions', 'jenkins', 'circleci', 'gitlab ci'],
  testing: ['jest', 'playwright', 'cypress', 'vitest'],
  cloud: ['amazon web services', 'google cloud', 'microsoft azure'],
  frontend: ['react', 'typescript', 'javascript', 'css'],
  accessibility: ['screen-reader', 'a11y', 'wcag'],
  a11y: ['accessibility'],
}

export function normalizeSkill(value: string): string {
  const trimmed = value.toLowerCase().replace(/[^a-z0-9+./# -]/g, ' ').replace(/\s+/g, ' ').trim()
  return ALIASES[trimmed] ?? trimmed
}

export function sameSkill(a: string, b: string): boolean {
  const left = normalizeSkill(a)
  const right = normalizeSkill(b)
  if (!left || !right) return false
  if (left === right) return true
  if (left.includes(right) || right.includes(left)) {
    return Math.min(left.length, right.length) >= 4
  }
  return FAMILIES.some((family) => family.includes(left) && family.includes(right))
}

export function relatedSkill(requirement: string, candidate: string): boolean {
  const req = normalizeSkill(requirement)
  const ev = normalizeSkill(candidate)
  const related = RELATED[req] ?? []
  return related.some((item) => sameSkill(item, ev) || ev === item)
}

export function textContainsTerm(haystack: string, term: string): boolean {
  if (!term.trim()) return false
  const source = haystack.toLowerCase()
  const normalized = normalizeSkill(term)
  const variants = new Set<string>([term.toLowerCase(), normalized])
  for (const [alias, canonical] of Object.entries(ALIASES)) {
    if (canonical === normalized) variants.add(alias)
  }
  return [...variants].some((variant) => {
    if (variant.length < 2) return false
    const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(source)
  })
}

export function extractEvidenceSnippet(source: string, term: string): string {
  if (!term.trim() || !source.trim()) return ''
  const lines = source.split(/\n+/)
  const match = lines.find((line) => textContainsTerm(line, term))
  if (!match) return ''
  const snippet = match.replace(/\s+/g, ' ').trim()
  return snippet.length > 220 ? `${snippet.slice(0, 217)}...` : snippet
}

const STOP = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'your', 'you', 'are', 'was',
  'were', 'have', 'has', 'will', 'into', 'onto', 'over', 'than', 'then', 'them',
  'their', 'about', 'across', 'using', 'used', 'use', 'able', 'such', 'including',
])

export function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9+.# ]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 3 && !STOP.has(token))
}

export function tokenOverlap(a: string, b: string): number {
  const left = new Set(tokens(a))
  const right = new Set(tokens(b))
  if (left.size === 0 || right.size === 0) return 0
  let shared = 0
  for (const token of left) {
    if (right.has(token)) shared += 1
  }
  return shared / Math.max(left.size, right.size)
}
