import { SPECIALIZATIONS, conflictingSkillPair } from './lexicon'

const ALIASES: Record<string, string> = {
  js: 'javascript',
  javascript: 'javascript',
  ts: 'typescript',
  typescript: 'typescript',
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
  aws: 'aws',
  'amazon web services': 'aws',
  gcp: 'gcp',
  'google cloud platform': 'gcp',
  'google cloud': 'gcp',
  azure: 'azure',
  'microsoft azure': 'azure',
  'ci/cd': 'ci/cd',
  cicd: 'ci/cd',
  'ci cd': 'ci/cd',
  ci: 'ci/cd',
  'continuous integration': 'ci/cd',
  'continuous delivery': 'ci/cd',
  'continuous deployment': 'ci/cd',
  'github actions': 'github actions',
  jest: 'jest',
  playwright: 'playwright',
  tailwind: 'tailwind css',
  'tailwind css': 'tailwind css',
  tailwindcss: 'tailwind css',
  css: 'css',
  graphql: 'graphql',
  docker: 'docker',
  terraform: 'terraform',
  python: 'python',
  java: 'java',
  'spring boot': 'spring boot',
  springboot: 'spring boot',
  'spring mvc': 'spring mvc',
  'spring framework': 'spring',
  spring: 'spring',
  kotlin: 'kotlin',
  rust: 'rust',
  go: 'go',
  golang: 'go',
  rest: 'rest apis',
  'rest api': 'rest apis',
  'rest apis': 'rest apis',
  restful: 'rest apis',
  'restful api': 'rest apis',
  'restful apis': 'rest apis',
  'restful services': 'rest apis',
  'restful service': 'rest apis',
  'rest services': 'rest apis',
  microservice: 'microservices',
  microservices: 'microservices',
  'micro-services': 'microservices',
  junit: 'junit',
  junit5: 'junit',
  'junit 5': 'junit',
  mockito: 'mockito',
  'relational database': 'relational database',
  'relational databases': 'relational database',
}

const FAMILIES: string[][] = [
  ['react', 'react.js', 'reactjs'],
  ['javascript', 'js'],
  ['typescript', 'ts'],
  ['node.js', 'nodejs', 'node'],
  ['postgresql', 'postgres'],
  ['aws', 'amazon web services'],
  ['gcp', 'google cloud', 'google cloud platform'],
  ['azure', 'microsoft azure'],
  ['tailwind css', 'tailwind', 'tailwindcss'],
  ['kubernetes', 'k8s'],
  ['go', 'golang'],
  ['spring boot', 'springboot'],
  ['rest apis', 'rest', 'restful', 'restful services', 'restful apis'],
  ['ci/cd', 'cicd', 'continuous integration'],
]

/** Related but not equivalent — Partial classification only. Never Kubernetes ↔ Docker. */
const RELATED: Record<string, string[]> = {
  containerization: ['docker', 'podman'],
  containers: ['docker'],
  'ci/cd': ['github actions', 'jenkins', 'circleci', 'gitlab ci'],
  testing: ['jest', 'playwright', 'cypress', 'vitest', 'junit', 'mockito'],
  cloud: ['aws', 'gcp', 'azure'],
  frontend: ['react', 'typescript', 'javascript', 'css'],
  accessibility: ['screen-reader', 'a11y', 'wcag'],
  a11y: ['accessibility'],
  'http-based services': ['rest apis'],
  'http services': ['rest apis'],
}

export type SemanticMatchLevel = 'exact' | 'strong' | 'partial' | 'unsupported'

export function normalizeSkill(value: string): string {
  const trimmed = value.toLowerCase().replace(/[^a-z0-9+./# -]/g, ' ').replace(/\s+/g, ' ').trim()
  return ALIASES[trimmed] ?? trimmed
}

export function sameSkill(a: string, b: string): boolean {
  const left = normalizeSkill(a)
  const right = normalizeSkill(b)
  if (!left || !right) return false
  if (left === right) return true
  if (conflictingSkillPair(left, right)) return false
  if (FAMILIES.some((family) => family.includes(left) && family.includes(right))) return true
  return false
}

export function relatedSkill(requirement: string, candidate: string): boolean {
  const req = normalizeSkill(requirement)
  const ev = normalizeSkill(candidate)
  const related = RELATED[req] ?? []
  return related.some((item) => sameSkill(item, ev) || ev === item)
}

export function candidateImplements(requirement: string, candidate: string): boolean {
  const req = normalizeSkill(requirement)
  const ev = normalizeSkill(candidate)
  const specs = SPECIALIZATIONS[req] ?? []
  return specs.some((item) => sameSkill(item, ev) || normalizeSkill(item) === ev)
}

export function semanticMatch(requirement: string, candidate: string): SemanticMatchLevel {
  if (sameSkill(requirement, candidate)) return 'exact'
  if (candidateImplements(requirement, candidate)) return 'strong'
  if (relatedSkill(requirement, candidate) || relatedSkill(candidate, requirement)) return 'partial'
  return 'unsupported'
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
