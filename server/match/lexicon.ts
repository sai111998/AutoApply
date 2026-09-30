export type SkillCategory =
  | 'language'
  | 'framework'
  | 'library'
  | 'cloud'
  | 'database'
  | 'devops'
  | 'security'
  | 'architecture'
  | 'methodology'
  | 'testing'
  | 'frontend'
  | 'tools'
  | 'domain'

export type RoleType = 'java-backend' | 'ai-engineer' | 'cybersecurity' | 'frontend' | 'fullstack' | 'general'

export interface LexiconTerm {
  name: string
  category: SkillCategory
  aliases: string[]
}

export const LEXICON: LexiconTerm[] = [
  { name: 'Java', category: 'language', aliases: ['java se', 'java ee', 'jdk', 'j2ee'] },
  { name: 'Python', category: 'language', aliases: ['python3'] },
  { name: 'JavaScript', category: 'language', aliases: ['js', 'ecmascript'] },
  { name: 'TypeScript', category: 'language', aliases: ['ts'] },
  { name: 'Go', category: 'language', aliases: ['golang'] },
  { name: 'Kotlin', category: 'language', aliases: [] },
  { name: 'Rust', category: 'language', aliases: [] },
  { name: 'SQL', category: 'language', aliases: [] },
  { name: 'C++', category: 'language', aliases: ['cpp'] },
  { name: 'C#', category: 'language', aliases: ['csharp', 'c sharp'] },

  { name: 'Spring Boot', category: 'framework', aliases: ['springboot'] },
  { name: 'Spring MVC', category: 'framework', aliases: ['spring mvc'] },
  { name: 'Spring Cloud', category: 'framework', aliases: [] },
  { name: 'Spring', category: 'framework', aliases: ['spring framework'] },
  { name: 'Hibernate', category: 'framework', aliases: ['jpa'] },
  { name: 'Node.js', category: 'framework', aliases: ['nodejs', 'node'] },
  { name: 'Express', category: 'framework', aliases: ['express.js', 'expressjs'] },
  { name: 'Django', category: 'framework', aliases: [] },
  { name: 'Flask', category: 'framework', aliases: [] },
  { name: 'FastAPI', category: 'framework', aliases: ['fast api'] },
  { name: 'React', category: 'frontend', aliases: ['reactjs', 'react.js'] },
  { name: 'Angular', category: 'frontend', aliases: ['angularjs'] },
  { name: 'Vue', category: 'frontend', aliases: ['vue.js', 'vuejs'] },
  { name: 'Next.js', category: 'frontend', aliases: ['nextjs'] },

  { name: 'REST APIs', category: 'architecture', aliases: [
    'rest api', 'restful apis', 'restful api', 'restful services', 'restful service',
    'rest services', 'rest service', 'rest', 'restful',
  ] },
  { name: 'GraphQL', category: 'architecture', aliases: [] },
  { name: 'Microservices', category: 'architecture', aliases: ['micro-services', 'microservice'] },
  { name: 'gRPC', category: 'architecture', aliases: ['grpc'] },
  { name: 'Event-driven', category: 'architecture', aliases: ['event driven', 'event-driven architecture'] },

  { name: 'AWS', category: 'cloud', aliases: ['amazon web services'] },
  { name: 'EC2', category: 'cloud', aliases: [] },
  { name: 'S3', category: 'cloud', aliases: ['amazon s3'] },
  { name: 'RDS', category: 'cloud', aliases: ['amazon rds'] },
  { name: 'Lambda', category: 'cloud', aliases: ['aws lambda'] },
  { name: 'GCP', category: 'cloud', aliases: ['google cloud', 'google cloud platform'] },
  { name: 'Azure', category: 'cloud', aliases: ['microsoft azure'] },

  { name: 'PostgreSQL', category: 'database', aliases: ['postgres', 'psql'] },
  { name: 'MySQL', category: 'database', aliases: [] },
  { name: 'MongoDB', category: 'database', aliases: ['mongo'] },
  { name: 'Redis', category: 'database', aliases: [] },
  { name: 'Oracle', category: 'database', aliases: ['oracle db'] },
  { name: 'SQL Server', category: 'database', aliases: ['mssql', 'microsoft sql server'] },
  { name: 'DynamoDB', category: 'database', aliases: [] },
  { name: 'Elasticsearch', category: 'database', aliases: ['elastic search'] },

  { name: 'Docker', category: 'devops', aliases: ['docker containers', 'dockerized'] },
  { name: 'Kubernetes', category: 'devops', aliases: ['k8s'] },
  { name: 'Terraform', category: 'devops', aliases: [] },
  { name: 'Jenkins', category: 'devops', aliases: [] },
  { name: 'GitHub Actions', category: 'devops', aliases: ['github action'] },
  { name: 'GitLab CI', category: 'devops', aliases: ['gitlab ci/cd'] },
  { name: 'CircleCI', category: 'devops', aliases: ['circle ci'] },
  { name: 'CI/CD', category: 'devops', aliases: ['cicd', 'ci cd', 'ci', 'continuous integration', 'continuous delivery', 'continuous deployment'] },
  { name: 'Ansible', category: 'devops', aliases: [] },
  { name: 'Helm', category: 'devops', aliases: [] },

  { name: 'JUnit', category: 'testing', aliases: ['junit5', 'junit 5'] },
  { name: 'Mockito', category: 'testing', aliases: [] },
  { name: 'Jest', category: 'testing', aliases: [] },
  { name: 'Playwright', category: 'testing', aliases: [] },
  { name: 'Cypress', category: 'testing', aliases: [] },
  { name: 'Vitest', category: 'testing', aliases: [] },
  { name: 'Selenium', category: 'testing', aliases: [] },

  { name: 'SIEM', category: 'security', aliases: [] },
  { name: 'Incident Response', category: 'security', aliases: ['ir'] },
  { name: 'Threat Detection', category: 'security', aliases: [] },
  { name: 'Vulnerability Management', category: 'security', aliases: [] },
  { name: 'Cloud Security', category: 'security', aliases: [] },
  { name: 'OWASP', category: 'security', aliases: [] },
  { name: 'OAuth', category: 'security', aliases: ['oauth2', 'oauth 2'] },
  { name: 'JWT', category: 'security', aliases: [] },

  { name: 'Machine Learning', category: 'domain', aliases: ['ml'] },
  { name: 'LLMs', category: 'domain', aliases: ['large language models', 'llm'] },
  { name: 'RAG', category: 'domain', aliases: ['retrieval augmented generation'] },
  { name: 'Vector databases', category: 'database', aliases: ['vector db', 'vector database', 'pinecone', 'weaviate', 'faiss'] },
  { name: 'TensorFlow', category: 'framework', aliases: [] },
  { name: 'PyTorch', category: 'framework', aliases: [] },
  { name: 'LangChain', category: 'framework', aliases: [] },
  { name: 'scikit-learn', category: 'library', aliases: ['sklearn'] },
  { name: 'Pandas', category: 'library', aliases: [] },
  { name: 'Kafka', category: 'tools', aliases: ['apache kafka'] },
  { name: 'Linux', category: 'tools', aliases: [] },
  { name: 'Git', category: 'tools', aliases: [] },
  { name: 'Maven', category: 'tools', aliases: [] },
  { name: 'Gradle', category: 'tools', aliases: [] },
  { name: 'Agile', category: 'methodology', aliases: [] },
  { name: 'Scrum', category: 'methodology', aliases: [] },
  { name: 'TDD', category: 'methodology', aliases: ['test-driven development', 'test driven development'] },
  { name: 'Tailwind CSS', category: 'frontend', aliases: ['tailwind', 'tailwindcss'] },
  { name: 'CSS', category: 'frontend', aliases: [] },
  { name: 'accessibility', category: 'frontend', aliases: ['a11y', 'wcag'] },
]

/** Parent concept → specialized evidence that can support it (not the reverse). */
export const SPECIALIZATIONS: Record<string, string[]> = {
  spring: ['spring boot', 'spring mvc', 'spring cloud'],
  'spring framework': ['spring boot', 'spring mvc', 'spring cloud'],
  'relational database': ['postgresql', 'mysql', 'sql server', 'oracle', 'sqlite', 'mariadb'],
  'relational databases': ['postgresql', 'mysql', 'sql server', 'oracle', 'sqlite', 'mariadb'],
  sql: ['postgresql', 'mysql', 'sql server', 'oracle', 'sqlite'],
  cloud: ['aws', 'amazon web services', 'gcp', 'google cloud', 'azure', 'microsoft azure'],
  'cloud-native': ['aws', 'amazon web services', 'gcp', 'google cloud', 'azure'],
  'ci/cd': ['jenkins', 'github actions', 'gitlab ci', 'circleci'],
  testing: ['junit', 'mockito', 'jest', 'playwright', 'cypress', 'vitest'],
  containerization: ['docker'],
  containers: ['docker'],
  'machine learning': ['tensorflow', 'pytorch', 'scikit-learn'],
  llm: ['langchain', 'rag'],
  llms: ['langchain', 'rag'],
}

export const ROLE_PRIORITY: Record<RoleType, string[]> = {
  'java-backend': [
    'java', 'spring boot', 'spring', 'rest apis', 'microservices', 'sql', 'postgresql', 'hibernate',
    'aws', 'docker', 'ci/cd', 'junit', 'mockito', 'kafka', 'kubernetes',
  ],
  'ai-engineer': [
    'python', 'machine learning', 'llms', 'rag', 'vector databases', 'tensorflow', 'pytorch',
    'langchain', 'aws', 'docker', 'sql', 'pandas',
  ],
  cybersecurity: [
    'siem', 'incident response', 'threat detection', 'linux', 'cloud security',
    'vulnerability management', 'aws', 'python',
  ],
  frontend: [
    'react', 'typescript', 'javascript', 'css', 'accessibility', 'next.js', 'graphql', 'jest',
  ],
  fullstack: [
    'javascript', 'typescript', 'react', 'node.js', 'sql', 'postgresql', 'aws', 'docker',
  ],
  general: [],
}

export const ACTION_VERBS = [
  'developed', 'designed', 'implemented', 'built', 'integrated', 'automated', 'deployed',
  'optimized', 'troubleshot', 'tested', 'migrated', 'configured', 'maintained', 'owned',
  'led', 'created', 'shipped', 'supported', 'reduced',
]

export const SAFE_VERB_UPGRADES: Record<string, string> = {
  'worked with': 'Used',
  'worked on': 'Developed',
  'helped with': 'Supported',
  'used': 'Used',
}

const CONFLICTING_PREFIXES: Array<[string, string]> = [
  ['java', 'javascript'],
  ['java', 'javadoc'],
  ['react', 'reactive'],
  ['go', 'google'],
  ['go', 'golang'],
]

export function conflictingSkillPair(a: string, b: string): boolean {
  const left = a.toLowerCase()
  const right = b.toLowerCase()
  return CONFLICTING_PREFIXES.some(
    ([short, long]) =>
      (left === short && right.startsWith(long)) || (right === short && left.startsWith(long)),
  )
}

export function detectRoleType(jobText: string): RoleType {
  const text = jobText.toLowerCase()
  const score = (needles: string[]) => needles.reduce((sum, item) => sum + (text.includes(item) ? 1 : 0), 0)
  const scores: Array<{ type: RoleType; value: number }> = [
    { type: 'java-backend', value: score(['java', 'spring', 'backend', 'microservices', 'rest']) },
    { type: 'ai-engineer', value: score(['machine learning', 'llm', 'rag', 'pytorch', 'tensorflow', 'nlp', 'ai engineer']) },
    { type: 'cybersecurity', value: score(['siem', 'soc', 'incident response', 'threat', 'cyber', 'vulnerability']) },
    { type: 'frontend', value: score(['react', 'frontend', 'front-end', 'typescript', 'css', 'ui']) },
    { type: 'fullstack', value: score(['full stack', 'fullstack', 'full-stack']) },
  ]
  scores.sort((a, b) => b.value - a.value)
  return scores[0] && scores[0].value >= 2 ? scores[0].type : 'general'
}

export function categoryForNormalized(name: string): SkillCategory | null {
  const needle = name.toLowerCase()
  const hit = LEXICON.find(
    (term) =>
      term.name.toLowerCase() === needle ||
      term.aliases.some((alias) => alias.toLowerCase() === needle),
  )
  return hit?.category ?? null
}

export function displayNameFor(term: string): string {
  const needle = term.toLowerCase()
  const hit = LEXICON.find(
    (item) => item.name.toLowerCase() === needle || item.aliases.some((alias) => alias === needle),
  )
  return hit?.name ?? term
}

export interface FoundTerm {
  name: string
  category: SkillCategory
  matched: string
  index: number
}

export function findLexiconTerms(text: string): FoundTerm[] {
  if (!text.trim()) return []
  const catalog: Array<{ name: string; category: SkillCategory; variant: string }> = []
  for (const term of LEXICON) {
    catalog.push({ name: term.name, category: term.category, variant: term.name })
    for (const alias of term.aliases) catalog.push({ name: term.name, category: term.category, variant: alias })
  }
  catalog.sort((a, b) => b.variant.length - a.variant.length)

  const used = new Array(text.length).fill(false)
  const found: FoundTerm[] = []
  const seen = new Set<string>()

  for (const item of catalog) {
    const escaped = item.variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`(^|[^a-zA-Z0-9+#])(${escaped})(?=[^a-zA-Z0-9+#]|$)`, 'gi')
    let match: RegExpExecArray | null
    while ((match = re.exec(text))) {
      const start = match.index + match[1].length
      const end = start + match[2].length
      let blocked = false
      for (let i = start; i < end; i += 1) {
        if (used[i]) {
          blocked = true
          break
        }
      }
      if (blocked) continue
      for (let i = start; i < end; i += 1) used[i] = true
      const key = item.name.toLowerCase()
      if (!seen.has(key)) {
        seen.add(key)
        found.push({ name: item.name, category: item.category, matched: match[2], index: start })
      }
    }
  }
  return found
}
