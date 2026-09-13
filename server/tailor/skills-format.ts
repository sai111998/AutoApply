import { ROLE_PRIORITY, categoryForNormalized, type RoleType } from '../match/lexicon'
import { normalizeSkill, sameSkill } from '../match/normalize'
import type { SkillGroup, TailoringPlan } from './types'

const CATEGORY_LABELS: Record<string, string> = {
  language: 'Languages',
  framework: 'Backend',
  architecture: 'Architecture',
  cloud: 'Cloud',
  database: 'Databases',
  devops: 'DevOps',
  testing: 'Testing',
  frontend: 'Frontend',
  security: 'Security',
  tools: 'Tools',
  methodology: 'Methodologies',
  domain: 'Domain',
  library: 'Libraries',
}

const CATEGORY_ORDER = [
  'language',
  'framework',
  'architecture',
  'cloud',
  'database',
  'devops',
  'testing',
  'frontend',
  'security',
  'tools',
  'methodology',
  'domain',
  'library',
]

function categoryIndex(name: string): number {
  const category = categoryForNormalized(normalizeSkill(name))
  const idx = category ? CATEGORY_ORDER.indexOf(category) : 99
  return idx === -1 ? 99 : idx
}

export function orderSkills(skills: string[], plan: TailoringPlan, jobDescription: string): string[] {
  const role = (plan.roleType as RoleType) || 'general'
  const roleOrder = ROLE_PRIORITY[role] ?? []
  const emphasizeIndex = (name: string) => {
    const idx = plan.skillsToEmphasize.findIndex((item) => sameSkill(item, name))
    return idx === -1 ? 1000 : idx
  }
  const roleIndex = (name: string) => {
    const idx = roleOrder.findIndex((item) => sameSkill(item, name) || normalizeSkill(item) === normalizeSkill(name))
    return idx === -1 ? 1000 : idx
  }
  const jdHit = (name: string) => (jobDescription.toLowerCase().includes(name.toLowerCase()) ? 0 : 1)

  return [...skills].sort((left, right) => {
    const byEmphasize = emphasizeIndex(left) - emphasizeIndex(right)
    if (byEmphasize !== 0) return byEmphasize
    const byJd = jdHit(left) - jdHit(right)
    if (byJd !== 0) return byJd
    const byRole = roleIndex(left) - roleIndex(right)
    if (byRole !== 0) return byRole
    return categoryIndex(left) - categoryIndex(right)
  })
}

export function groupSkills(skills: string[], roleType?: string): SkillGroup[] {
  const groups = new Map<string, string[]>()
  const backendMerge = roleType === 'java-backend' || roleType === 'fullstack'
  for (const skill of skills) {
    const category = categoryForNormalized(normalizeSkill(skill)) ?? 'tools'
    const label =
      backendMerge && (category === 'framework' || category === 'architecture' || category === 'library')
        ? 'Backend'
        : CATEGORY_LABELS[category] ?? 'Additional'
    const existing = groups.get(label) ?? []
    if (!existing.some((item) => sameSkill(item, skill))) existing.push(skill)
    groups.set(label, existing)
  }
  const labelOrder = [
    'Languages',
    'Backend',
    'Architecture',
    'Cloud',
    'Databases',
    'DevOps',
    'Testing',
    'Frontend',
    'Security',
    'Tools',
    'Methodologies',
    'Domain',
    'Libraries',
    'Additional',
  ]
  return [...groups.entries()]
    .sort((left, right) => labelOrder.indexOf(left[0]) - labelOrder.indexOf(right[0]))
    .map(([label, items]) => ({ label, items }))
}

export function formatSkillGroups(groups: SkillGroup[]): string {
  return groups.map((group) => `${group.label}: ${group.items.join(', ')}`).join('\n')
}
