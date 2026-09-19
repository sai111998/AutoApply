import type {
  Application,
  Job,
  JobMatch,
  Profile,
  Resume,
  Skill,
  UserPreferences,
  WorkspaceSnapshot,
} from '@/types/domain'

export const DEMO_USER_ID = '11111111-1111-4111-8111-111111111111'

const resumeMaster = '22222222-2222-4222-8222-222222222221'
const resumeTailored = '22222222-2222-4222-8222-222222222222'
const resumeEarlier = '22222222-2222-4222-8222-222222222223'
const resumeJava = '22222222-2222-4222-8222-222222222224'

const jobs = {
  stripe: '33333333-3333-4333-8333-333333333331',
  notion: '33333333-3333-4333-8333-333333333332',
  figma: '33333333-3333-4333-8333-333333333333',
  linear: '33333333-3333-4333-8333-333333333334',
  airbnb: '33333333-3333-4333-8333-333333333335',
  datadog: '33333333-3333-4333-8333-333333333336',
  atlas: '33333333-3333-4333-8333-333333333337',
  northwind: '33333333-3333-4333-8333-333333333338',
  java: '33333333-3333-4333-8333-333333333339',
}

const matches = {
  stripe: '44444444-4444-4444-8444-444444444441',
  notion: '44444444-4444-4444-8444-444444444442',
  figma: '44444444-4444-4444-8444-444444444443',
  linear: '44444444-4444-4444-8444-444444444444',
  airbnb: '44444444-4444-4444-8444-444444444445',
  datadog: '44444444-4444-4444-8444-444444444446',
  atlas: '44444444-4444-4444-8444-444444444447',
  northwind: '44444444-4444-4444-8444-444444444448',
  java: '44444444-4444-4444-8444-444444444449',
}

export const sampleProfile: Profile = {
  id: DEMO_USER_ID,
  fullName: 'Alex Rivera',
  email: 'alex.rivera@example.com',
  location: 'Austin, TX',
  targetJobTitles: ['Senior Frontend Engineer', 'Full Stack Engineer', 'Product Engineer'],
  yearsOfExperience: 8,
  workAuthorization: 'us_citizen',
  sponsorshipRequired: false,
  preferredWorkArrangement: 'hybrid',
  targetSalaryMin: 170000,
  targetSalaryMax: 205000,
  updatedAt: '2026-08-12T14:20:00.000Z',
}

export const sampleSkills: Skill[] = [
  { id: 's1', userId: DEMO_USER_ID, name: 'React', proficiency: 'expert', yearsExperience: 7 },
  { id: 's2', userId: DEMO_USER_ID, name: 'TypeScript', proficiency: 'expert', yearsExperience: 6 },
  { id: 's3', userId: DEMO_USER_ID, name: 'Node.js', proficiency: 'advanced', yearsExperience: 5 },
  { id: 's4', userId: DEMO_USER_ID, name: 'GraphQL', proficiency: 'advanced', yearsExperience: 4 },
  { id: 's5', userId: DEMO_USER_ID, name: 'Design systems', proficiency: 'expert', yearsExperience: 5 },
  { id: 's6', userId: DEMO_USER_ID, name: 'Accessibility', proficiency: 'advanced', yearsExperience: 4 },
  { id: 's7', userId: DEMO_USER_ID, name: 'PostgreSQL', proficiency: 'intermediate', yearsExperience: 3 },
  { id: 's8', userId: DEMO_USER_ID, name: 'Testing (Jest/Playwright)', proficiency: 'advanced', yearsExperience: 5 },
  { id: 's9', userId: DEMO_USER_ID, name: 'CSS / Tailwind', proficiency: 'expert', yearsExperience: 8 },
  { id: 's10', userId: DEMO_USER_ID, name: 'Product thinking', proficiency: 'advanced', yearsExperience: 6 },
]

export const SAMPLE_RESUME_TEXT = `Alex Rivera
Austin, TX
alex.rivera@example.com

Summary
Senior product-minded frontend engineer with 8 years building React and TypeScript applications, design systems, and accessible user interfaces. Comfortable working across Node.js services and PostgreSQL when needed.

Experience
Senior Frontend Engineer, Northstar Labs — 2021 to present
- Led a React and TypeScript design system used by four product teams.
- Built accessible dashboard UI, including keyboard support and screen-reader reviews.
- Wrote Jest and Playwright coverage for critical checkout and settings flows.
- Partnered with product on roadmap tradeoffs and UX quality.

Frontend Engineer, Harbor Software — 2018 to 2021
- Shipped GraphQL-backed product surfaces in React.
- Maintained CSS and Tailwind component libraries.
- Mentored engineers on testing and accessibility.

Skills
React, TypeScript, Node.js, GraphQL, design systems, accessibility, PostgreSQL, Jest, Playwright, CSS, Tailwind, product thinking.

Education
B.A., University of Texas at Austin
`

export const sampleResumes: Resume[] = [
  {
    id: resumeMaster,
    userId: DEMO_USER_ID,
    fileName: 'Alex_Rivera_Master_Resume.pdf',
    fileType: 'application/pdf',
    versionLabel: 'Master v4 — Aug 2026',
    isMaster: true,
    fileSize: 186400,
    storagePath: null,
    parsedText: SAMPLE_RESUME_TEXT,
    createdAt: '2026-08-04T16:10:00.000Z',
  },
  {
    id: resumeTailored,
    userId: DEMO_USER_ID,
    fileName: 'Alex_Rivera_Product_Engineer.pdf',
    fileType: 'application/pdf',
    versionLabel: 'Product Engineer — Figma/Linear',
    isMaster: false,
    fileSize: 179220,
    storagePath: null,
    parsedText: SAMPLE_RESUME_TEXT,
    createdAt: '2026-08-11T11:42:00.000Z',
  },
  {
    id: resumeEarlier,
    userId: DEMO_USER_ID,
    fileName: 'Alex_Rivera_Resume_Q2.docx',
    fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    versionLabel: 'Q2 2026 archive',
    isMaster: false,
    fileSize: 142880,
    storagePath: null,
    parsedText: '',
    createdAt: '2026-05-18T09:05:00.000Z',
  },
  {
    id: resumeJava,
    userId: DEMO_USER_ID,
    fileName: 'Jordan_Hale_Java_Resume.txt',
    fileType: 'text/plain',
    versionLabel: 'Java / Spring Boot — Northwind',
    isMaster: false,
    fileSize: 1680,
    storagePath: null,
    parsedText: `Jordan Hale
Austin, TX
jordan.hale@example.com

Summary
Software Engineer with experience in Java development.

Experience
Backend Engineer, Northwind — 2021 to present
- Developed Java and Spring Boot applications for payments APIs.
- Owned PostgreSQL schema changes for billing.
- Worked with Docker in CI.
- Reduced checkout errors by adding contract tests.

Backend Engineer, Harbor Software — 2018 to 2021
- Built REST APIs in Java.
- Supported AWS-based services.

Skills
Java, Python, React, AWS, Docker, Spring Boot, PostgreSQL

Education
B.S., Computer Science, State University

Certifications
AWS Certified Developer

Projects
Billing API
`,
    createdAt: '2026-08-20T10:00:00.000Z',
  },
]

export const sampleJobs: Job[] = [
  {
    id: jobs.stripe,
    userId: DEMO_USER_ID,
    title: 'Senior Frontend Engineer, Dashboard',
    company: 'Stripe',
    location: 'Remote (US) / South Park, SF',
    jobUrl: 'https://stripe.com/jobs/listing/senior-frontend-engineer',
    description:
      'Build high-quality dashboard experiences in React and TypeScript. Partner with design on a mature component system, own accessibility, and ship trustworthy financial UI.',
    createdAt: '2026-08-18T13:00:00.000Z',
  },
  {
    id: jobs.notion,
    userId: DEMO_USER_ID,
    title: 'Full Stack Engineer, Editor',
    company: 'Notion',
    location: 'San Francisco, CA (Hybrid)',
    jobUrl: 'https://www.notion.so/careers',
    description:
      'Work across the editor stack: React, TypeScript, and backend services. Experience with collaborative editing, performance, and product-minded engineering is a plus.',
    createdAt: '2026-08-16T10:20:00.000Z',
  },
  {
    id: jobs.figma,
    userId: DEMO_USER_ID,
    title: 'Product Engineer',
    company: 'Figma',
    location: 'San Francisco, CA / New York, NY',
    jobUrl: 'https://www.figma.com/careers',
    description:
      'Join a product-engineering pod shipping multiplayer design tools. Strong front-end craft, design-system fluency, and comfort with ambiguous product problems.',
    createdAt: '2026-08-14T15:45:00.000Z',
  },
  {
    id: jobs.linear,
    userId: DEMO_USER_ID,
    title: 'Senior Product Engineer',
    company: 'Linear',
    location: 'Remote (North America)',
    jobUrl: 'https://linear.app/careers',
    description:
      'Build a fast, polished issue-tracking product. Deep React/TypeScript, attention to interaction quality, and end-to-end ownership from prototype to production.',
    createdAt: '2026-08-13T09:12:00.000Z',
  },
  {
    id: jobs.airbnb,
    userId: DEMO_USER_ID,
    title: 'Staff Frontend Engineer',
    company: 'Airbnb',
    location: 'San Francisco, CA (Hybrid 3 days)',
    jobUrl: 'https://careers.airbnb.com',
    description:
      'Lead frontend architecture for a guest-facing surface. Staff-level scope, cross-org influence, and experience scaling design systems at large companies.',
    createdAt: '2026-08-10T18:30:00.000Z',
  },
  {
    id: jobs.datadog,
    userId: DEMO_USER_ID,
    title: 'Senior Software Engineer, UI',
    company: 'Datadog',
    location: 'New York, NY (Hybrid)',
    jobUrl: 'https://careers.datadoghq.com',
    description:
      'Build data-dense observability UI. Experience with charts, performance, and TypeScript. Backend exposure to Go or Python is helpful but not required.',
    createdAt: '2026-08-08T12:00:00.000Z',
  },
  {
    id: jobs.atlas,
    userId: DEMO_USER_ID,
    title: 'Platform Engineer',
    company: 'Atlas Robotics',
    location: 'Boston, MA (On-site)',
    jobUrl: 'https://atlasrobotics.example/careers',
    description:
      'On-site platform role focused on Rust, embedded Linux, and robotics middleware. Occasional frontend work in an internal ops console.',
    createdAt: '2026-08-07T16:40:00.000Z',
  },
  {
    id: jobs.northwind,
    userId: DEMO_USER_ID,
    title: 'Director of Engineering',
    company: 'Northwind Health',
    location: 'Chicago, IL (On-site)',
    jobUrl: 'https://northwind.example/jobs/doe',
    description:
      'People-management role owning a 24-person engineering org in a HIPAA environment. Requires prior director experience and healthcare compliance background.',
    createdAt: '2026-08-02T08:15:00.000Z',
  },
  {
    id: jobs.java,
    userId: DEMO_USER_ID,
    title: 'Senior Java Software Engineer',
    company: 'Northwind Payments',
    location: 'Remote (US)',
    jobUrl: 'https://northwind.example/jobs/senior-java',
    description:
      'Senior Java Software Engineer to build payment APIs with Java, Spring Boot, and PostgreSQL. Docker experience is preferred. Kubernetes is required for deployment automation. Terraform experience is a plus.',
    createdAt: '2026-08-21T09:00:00.000Z',
  },
]

export const sampleMatches: JobMatch[] = [
  {
    id: matches.stripe,
    userId: DEMO_USER_ID,
    jobId: jobs.stripe,
    resumeId: resumeMaster,
    overallScore: 91,
    skillsMatched: [
      { name: 'React', note: 'Primary UI stack' },
      { name: 'TypeScript', note: 'Required' },
      { name: 'Design systems', note: 'Dashboard component library' },
      { name: 'Accessibility', note: 'Financial UI requirements' },
    ],
    skillsPartial: [{ name: 'Payments domain', note: 'Transferable product sense, limited payments depth' }],
    skillsMissing: [{ name: 'Ruby', note: 'Mentioned as a plus for adjacent services' }],
    experienceMatch: { score: 88, summary: 'Senior-level product UI experience aligns with the posted range.' },
    educationMatch: { score: 80, summary: 'Degree not listed as a hard filter.' },
    locationMatch: { score: 95, summary: 'Remote US is compatible with Austin-based hybrid preference.' },
    workAuthorizationNotes: 'U.S. work authorization is compatible; no sponsorship required.',
    strengths: ['Deep React/TypeScript craft', 'Design-system ownership', 'Accessibility experience'],
    concerns: ['Limited payments-domain keywords on the master resume'],
    recommendation: 'APPLY',
    analysisStatus: 'complete',
    analysisSource: 'sample',
    provider: 'sample-preview',
    errorMessage: null,
    summary: null,
    createdAt: '2026-08-18T13:04:00.000Z',
    analyzedAt: '2026-08-18T13:04:00.000Z',
  },
  {
    id: matches.notion,
    userId: DEMO_USER_ID,
    jobId: jobs.notion,
    resumeId: resumeMaster,
    overallScore: 76,
    skillsMatched: [
      { name: 'React' },
      { name: 'TypeScript' },
      { name: 'Product thinking' },
    ],
    skillsPartial: [
      { name: 'Full-stack services', note: 'Node.js present; collaborative-editor backend not evidenced' },
    ],
    skillsMissing: [{ name: 'CRDT / collaborative editing' }, { name: 'On-site SF 3 days' }],
    experienceMatch: { score: 82, summary: 'Senior IC experience is a fit; editor-domain depth is thinner.' },
    educationMatch: { score: 78, summary: 'No strict education gate listed.' },
    locationMatch: { score: 62, summary: 'Hybrid San Francisco conflicts with Austin home base.' },
    workAuthorizationNotes: 'Authorization is not a blocker.',
    strengths: ['Product-minded frontend work', 'Strong TypeScript'],
    concerns: ['Relocation or travel for SF hybrid', 'Editor-infrastructure keywords missing'],
    recommendation: 'REVIEW',
    analysisStatus: 'complete',
    analysisSource: 'sample',
    provider: 'sample-preview',
    errorMessage: null,
    summary: null,
    createdAt: '2026-08-16T10:24:00.000Z',
    analyzedAt: '2026-08-16T10:24:00.000Z',
  },
  {
    id: matches.figma,
    userId: DEMO_USER_ID,
    jobId: jobs.figma,
    resumeId: resumeTailored,
    overallScore: 84,
    skillsMatched: [
      { name: 'React' },
      { name: 'TypeScript' },
      { name: 'Design systems' },
      { name: 'Product thinking' },
    ],
    skillsPartial: [{ name: 'Multiplayer clients', note: 'Some real-time UI, not Figma-scale' }],
    skillsMissing: [{ name: 'C++ / WASM', note: 'Listed as a plus, not required' }],
    experienceMatch: { score: 86, summary: 'Product engineer shape matches the posting.' },
    educationMatch: { score: 80, summary: 'No hard education requirement.' },
    locationMatch: { score: 70, summary: 'SF/NY hubs; remote-friendly teams vary by org.' },
    workAuthorizationNotes: 'U.S. citizen; sponsorship not required.',
    strengths: ['Design-tool adjacent craft', 'Tailored resume version already exists'],
    concerns: ['Hub location may require travel'],
    recommendation: 'APPLY',
    analysisStatus: 'complete',
    analysisSource: 'sample',
    provider: 'sample-preview',
    errorMessage: null,
    summary: null,
    createdAt: '2026-08-14T15:50:00.000Z',
    analyzedAt: '2026-08-14T15:50:00.000Z',
  },
  {
    id: matches.linear,
    userId: DEMO_USER_ID,
    jobId: jobs.linear,
    resumeId: resumeMaster,
    overallScore: 88,
    skillsMatched: [
      { name: 'React' },
      { name: 'TypeScript' },
      { name: 'CSS / Tailwind' },
      { name: 'Product thinking' },
    ],
    skillsPartial: [{ name: 'High-performance UI', note: 'Strong, but no published perf case study' }],
    skillsMissing: [],
    experienceMatch: { score: 90, summary: 'End-to-end product engineering maps cleanly.' },
    educationMatch: { score: 80, summary: 'Not a gating factor.' },
    locationMatch: { score: 96, summary: 'Remote North America matches Austin.' },
    workAuthorizationNotes: 'Compatible.',
    strengths: ['Interaction quality', 'Remote-ready', 'Full-stack comfort'],
    concerns: ['Small-team bar for written communication is high — resume could show more writing samples'],
    recommendation: 'APPLY',
    analysisStatus: 'complete',
    analysisSource: 'sample',
    provider: 'sample-preview',
    errorMessage: null,
    summary: null,
    createdAt: '2026-08-13T09:18:00.000Z',
    analyzedAt: '2026-08-13T09:18:00.000Z',
  },
  {
    id: matches.airbnb,
    userId: DEMO_USER_ID,
    jobId: jobs.airbnb,
    resumeId: resumeMaster,
    overallScore: 64,
    skillsMatched: [{ name: 'React' }, { name: 'TypeScript' }, { name: 'Design systems' }],
    skillsPartial: [{ name: 'Staff scope', note: 'Senior IC, limited org-level architecture narrative' }],
    skillsMissing: [{ name: 'Large-org staff leadership examples' }, { name: 'Marketplace domain' }],
    experienceMatch: { score: 58, summary: 'Staff title is a stretch versus current senior scope.' },
    educationMatch: { score: 75, summary: 'Unlikely to be the blocker.' },
    locationMatch: { score: 55, summary: '3-day SF hybrid is a relocation ask.' },
    workAuthorizationNotes: 'Compatible.',
    strengths: ['Design-system depth', 'Consumer UI experience'],
    concerns: ['Level mismatch', 'Relocation'],
    recommendation: 'REVIEW',
    analysisStatus: 'complete',
    analysisSource: 'sample',
    provider: 'sample-preview',
    errorMessage: null,
    summary: null,
    createdAt: '2026-08-10T18:36:00.000Z',
    analyzedAt: '2026-08-10T18:36:00.000Z',
  },
  {
    id: matches.datadog,
    userId: DEMO_USER_ID,
    jobId: jobs.datadog,
    resumeId: resumeMaster,
    overallScore: 71,
    skillsMatched: [{ name: 'React' }, { name: 'TypeScript' }, { name: 'Testing (Jest/Playwright)' }],
    skillsPartial: [{ name: 'Data visualization', note: 'Some dashboard work, not observability-grade charts' }],
    skillsMissing: [{ name: 'Go', note: 'Helpful for adjacent services' }],
    experienceMatch: { score: 74, summary: 'Senior UI experience fits; domain is new.' },
    educationMatch: { score: 78, summary: 'No strict gate.' },
    locationMatch: { score: 48, summary: 'NYC hybrid is a relocation.' },
    workAuthorizationNotes: 'Compatible.',
    strengths: ['Complex UI', 'Testing discipline'],
    concerns: ['Location', 'Observability-domain keywords'],
    recommendation: 'REVIEW',
    analysisStatus: 'complete',
    analysisSource: 'sample',
    provider: 'sample-preview',
    errorMessage: null,
    summary: null,
    createdAt: '2026-08-08T12:08:00.000Z',
    analyzedAt: '2026-08-08T12:08:00.000Z',
  },
  {
    id: matches.atlas,
    userId: DEMO_USER_ID,
    jobId: jobs.atlas,
    resumeId: resumeMaster,
    overallScore: 41,
    skillsMatched: [{ name: 'TypeScript', note: 'Only for an internal console' }],
    skillsPartial: [{ name: 'Systems programming interest', note: 'Not evidenced on resume' }],
    skillsMissing: [{ name: 'Rust' }, { name: 'Embedded Linux' }, { name: 'Robotics middleware' }],
    experienceMatch: { score: 35, summary: 'Core stack does not match the posted platform work.' },
    educationMatch: { score: 60, summary: 'Unknown whether a CS systems background is expected.' },
    locationMatch: { score: 20, summary: 'On-site Boston conflicts with Austin hybrid preference.' },
    workAuthorizationNotes: 'Compatible, but location and stack are the real constraints.',
    strengths: ['Can contribute to an ops console if needed'],
    concerns: ['Wrong stack', 'On-site requirement', 'Domain mismatch'],
    recommendation: 'SKIP',
    analysisStatus: 'complete',
    analysisSource: 'sample',
    provider: 'sample-preview',
    errorMessage: null,
    summary: null,
    createdAt: '2026-08-07T16:44:00.000Z',
    analyzedAt: '2026-08-07T16:44:00.000Z',
  },
  {
    id: matches.northwind,
    userId: DEMO_USER_ID,
    jobId: jobs.northwind,
    resumeId: resumeMaster,
    overallScore: 38,
    skillsMatched: [{ name: 'Product thinking' }],
    skillsPartial: [{ name: 'Mentorship', note: 'Informal tech lead, not director-level org ownership' }],
    skillsMissing: [{ name: 'Director experience' }, { name: 'HIPAA / healthcare compliance' }, { name: 'People management of 20+' }],
    experienceMatch: { score: 30, summary: 'Role is a management-level jump the resume does not support.' },
    educationMatch: { score: 70, summary: 'Unlikely to be the main issue.' },
    locationMatch: { score: 25, summary: 'On-site Chicago is outside the target map.' },
    workAuthorizationNotes: 'Compatible.',
    strengths: ['Cross-functional product work'],
    concerns: ['Level', 'Industry', 'Location'],
    recommendation: 'SKIP',
    analysisStatus: 'complete',
    analysisSource: 'sample',
    provider: 'sample-preview',
    errorMessage: null,
    summary: null,
    createdAt: '2026-08-02T08:20:00.000Z',
    analyzedAt: '2026-08-02T08:20:00.000Z',
  },
  {
    id: matches.java,
    userId: DEMO_USER_ID,
    jobId: jobs.java,
    resumeId: resumeJava,
    overallScore: 91,
    skillsMatched: [
      { name: 'Java', note: 'Northwind payment APIs' },
      { name: 'Spring Boot', note: 'Backend services' },
      { name: 'REST APIs', note: 'Harbor Software and Northwind' },
      { name: 'PostgreSQL', note: 'Billing schema ownership' },
      { name: 'AWS', note: 'Harbor Software services' },
      { name: 'Docker', note: 'CI usage' },
    ],
    skillsPartial: [{ name: 'microservices', note: 'Service work is evidenced; explicit microservice framing is lighter' }],
    skillsMissing: [
      { name: 'Kubernetes', note: 'Required for deployment automation; not on the resume' },
      { name: 'Terraform', note: 'Listed as a plus; not on the resume' },
    ],
    experienceMatch: {
      score: 90,
      summary: 'Backend Engineer roles at Northwind and Harbor Software align with a senior Java posting.',
    },
    educationMatch: { score: 88, summary: 'B.S. in Computer Science matches the typical degree ask.' },
    locationMatch: { score: 96, summary: 'Remote US is compatible with Austin.' },
    workAuthorizationNotes: 'Compatible.',
    strengths: ['Java and Spring Boot payment APIs', 'PostgreSQL ownership', 'AWS and Docker evidence'],
    concerns: ['Kubernetes is required and not evidenced', 'Terraform is absent'],
    recommendation: 'APPLY',
    analysisStatus: 'complete',
    analysisSource: 'sample',
    provider: 'sample-preview',
    errorMessage: null,
    summary:
      'Jordan Hale’s Java, Spring Boot, REST, PostgreSQL, and AWS experience aligns closely with this senior backend role. Kubernetes and Terraform remain gaps and must not be added to the resume.',
    createdAt: '2026-08-19T09:00:00.000Z',
    analyzedAt: '2026-08-19T09:00:00.000Z',
    confidence: 'HIGH',
    report: {
      matchScore: 91,
      recommendation: 'APPLY',
      confidence: 'HIGH',
      requiredSkills: {
        matched: [
          { name: 'Java', classification: 'strong', source: 'required', evidence: 'Developed Java and Spring Boot applications for payments APIs.' },
          { name: 'Spring Boot', classification: 'strong', source: 'required', evidence: 'Developed Java and Spring Boot applications for payments APIs.' },
          { name: 'PostgreSQL', classification: 'strong', source: 'required', evidence: 'Owned PostgreSQL schema changes for billing.' },
          { name: 'REST APIs', classification: 'strong', source: 'required', evidence: 'Built REST APIs in Java.' },
        ],
        partial: [],
        missing: [{ name: 'Kubernetes', classification: 'missing', source: 'required', evidence: '' }],
      },
      preferredSkills: {
        matched: [
          { name: 'Docker', classification: 'strong', source: 'preferred', evidence: 'Worked with Docker in CI.' },
          { name: 'AWS', classification: 'strong', source: 'preferred', evidence: 'Supported AWS-based services.' },
        ],
        partial: [{ name: 'microservices', classification: 'partial', source: 'preferred', evidence: 'Service-oriented backend work' }],
        missing: [{ name: 'Terraform', classification: 'missing', source: 'preferred', evidence: '' }],
      },
      experience: {
        status: 'match',
        jobRequirement: 'Senior Java backend experience',
        candidateEvidence: 'Backend Engineer at Northwind and Harbor Software, 2018 to present',
        gap: '',
      },
      responsibilities: {
        strongMatches: [
          { name: 'Backend development', classification: 'strong', source: 'required', evidence: 'Java and Spring Boot applications' },
          { name: 'REST API development', classification: 'strong', source: 'required', evidence: 'Built REST APIs in Java.' },
          { name: 'Cloud deployment', classification: 'strong', source: 'preferred', evidence: 'Supported AWS-based services.' },
        ],
        partialMatches: [],
        gaps: [{ name: 'Kubernetes', classification: 'missing', source: 'required', evidence: '' }],
      },
      education: { status: 'match', details: 'B.S., Computer Science, State University' },
      certifications: {
        matched: [
          { name: 'AWS Certified Developer', classification: 'strong', source: 'preferred', evidence: 'AWS Certified Developer' },
        ],
        missing: [],
      },
      location: { status: 'match', details: 'Remote US' },
      strengths: ['Java and Spring Boot payment APIs', 'PostgreSQL ownership', 'AWS and Docker evidence'],
      concerns: ['Kubernetes is required and not evidenced'],
      missingEvidence: ['Kubernetes', 'Terraform'],
      summary:
        'Strong Java/Spring Boot overlap. Do not add Kubernetes or Terraform; they are absent from the master resume.',
    },
  },
]

export const sampleApplications: Application[] = [
  {
    id: '55555555-5555-4555-8555-555555555551',
    userId: DEMO_USER_ID,
    jobId: jobs.stripe,
    matchId: matches.stripe,
    resumeId: resumeMaster,
    selectedResumeVersionId: null,
    currentMatchId: matches.stripe,
    currentMatchScore: 91,
    status: 'ready',
    dateAdded: '2026-08-18',
    dateApplied: null,
    nextAction: 'Tailor resume and submit',
    notes: 'Highlight dashboard and accessibility work.',
    updatedAt: '2026-08-18T13:10:00.000Z',
  },
  {
    id: '55555555-5555-4555-8555-555555555552',
    userId: DEMO_USER_ID,
    jobId: jobs.linear,
    matchId: matches.linear,
    resumeId: resumeMaster,
    selectedResumeVersionId: null,
    currentMatchId: matches.linear,
    currentMatchScore: 88,
    status: 'applied',
    dateAdded: '2026-08-13',
    dateApplied: '2026-08-14',
    nextAction: 'Follow up in 5 days',
    notes: 'Submitted via Linear careers page.',
    updatedAt: '2026-08-14T19:00:00.000Z',
  },
  {
    id: '55555555-5555-4555-8555-555555555553',
    userId: DEMO_USER_ID,
    jobId: jobs.figma,
    matchId: matches.figma,
    resumeId: resumeTailored,
    selectedResumeVersionId: null,
    currentMatchId: matches.figma,
    currentMatchScore: 84,
    status: 'interview',
    dateAdded: '2026-08-14',
    dateApplied: '2026-08-15',
    nextAction: 'Prepare interview notes',
    notes: 'Recruiter screen scheduled.',
    updatedAt: '2026-08-19T16:40:00.000Z',
  },
  {
    id: '55555555-5555-4555-8555-555555555554',
    userId: DEMO_USER_ID,
    jobId: jobs.notion,
    matchId: matches.notion,
    resumeId: resumeMaster,
    selectedResumeVersionId: null,
    currentMatchId: matches.notion,
    currentMatchScore: 76,
    status: 'ready',
    dateAdded: '2026-08-16',
    dateApplied: null,
    nextAction: 'Decide on SF hybrid before applying',
    notes: '',
    updatedAt: '2026-08-16T10:30:00.000Z',
  },
  {
    id: '55555555-5555-4555-8555-555555555555',
    userId: DEMO_USER_ID,
    jobId: jobs.datadog,
    matchId: matches.datadog,
    resumeId: resumeMaster,
    selectedResumeVersionId: null,
    currentMatchId: matches.datadog,
    currentMatchScore: 71,
    status: 'applied',
    dateAdded: '2026-08-08',
    dateApplied: '2026-08-09',
    nextAction: 'Follow up in 5 days',
    notes: '',
    updatedAt: '2026-08-09T12:00:00.000Z',
  },
  {
    id: '55555555-5555-4555-8555-555555555556',
    userId: DEMO_USER_ID,
    jobId: jobs.airbnb,
    matchId: matches.airbnb,
    resumeId: resumeMaster,
    selectedResumeVersionId: null,
    currentMatchId: matches.airbnb,
    currentMatchScore: 64,
    status: 'withdrawn',
    dateAdded: '2026-08-10',
    dateApplied: null,
    nextAction: 'No action',
    notes: 'Paused due to relocation.',
    updatedAt: '2026-08-12T09:00:00.000Z',
  },
  {
    id: '55555555-5555-4555-8555-555555555557',
    userId: DEMO_USER_ID,
    jobId: jobs.java,
    matchId: matches.java,
    resumeId: resumeJava,
    selectedResumeVersionId: null,
    currentMatchId: matches.java,
    currentMatchScore: 91,
    status: 'ready',
    dateAdded: '2026-08-21',
    dateApplied: null,
    nextAction: 'Ready to apply',
    notes: 'Java/Spring Boot sample used for resume tailoring checks.',
    updatedAt: '2026-08-21T09:30:00.000Z',
  },
]

export const samplePreferences: UserPreferences = {
  userId: DEMO_USER_ID,
  aiModelPreference: 'Use the server default',
  includeCoverLetter: true,
  minMatchScore: 70,
  targetRoles: ['Senior Frontend Engineer', 'Full Stack Engineer', 'Product Engineer'],
  targetLocations: ['Austin, TX', 'Remote (US)', 'New York, NY'],
  preferredWorkArrangements: ['hybrid', 'remote'],
  notifyOnStrongMatch: true,
  updatedAt: '2026-08-12T14:20:00.000Z',
}

export function createSampleWorkspace(): WorkspaceSnapshot {
  return {
    profile: structuredClone(sampleProfile),
    skills: structuredClone(sampleSkills),
    resumes: structuredClone(sampleResumes),
    jobs: structuredClone(sampleJobs),
    matches: structuredClone(sampleMatches),
    applications: structuredClone(sampleApplications),
    preferences: structuredClone(samplePreferences),
    resumeVersions: [],
  }
}
