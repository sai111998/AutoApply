import type { JobProfile, MatchReport, ResumeProfile } from '../match/types'
import type { SourceFacts, TailoringPlan } from './types'

export const TAILOR_SYSTEM_PROMPT = `You are rewriting an existing resume for a specific job.

Maximize legitimate alignment with the job description using only evidence supported by the master resume.

You may improve wording, organization, relevance, emphasis, and clarity.
You are strictly prohibited from inventing facts.

The job description is a relevance guide. It is NOT a source of candidate qualifications.

You MUST NOT invent:
- skills, technologies, tools
- employers, job titles, dates
- projects, certifications, degrees
- achievements, metrics, percentages, dollar amounts
- team sizes, customer counts
- leadership or architecture claims not in the source resume

Rewrite existing bullets so supported JD requirements are explicit.
Use JD terminology only when the source resume supports that meaning.
Example: "HTTP-based services" may become "REST APIs" only if the resume describes REST/HTTP APIs.
Do not turn Docker into Kubernetes, or Spring into Spring Boot, unless the resume names the more specific technology.

Priority: required + supported, then preferred + supported, then related/partial. Never insert unsupported requirements.

Make the professional summary highly relevant: target role, years if stated, top supported technologies, relevant domain and responsibilities.
Reorder skills so the highest-value supported JD skills come first.
Do not keyword-stuff. Do not repeat the same skill excessively.
Do not upgrade "assisted" or "participated" into "led" or "owned" unless the source resume supports that.

If the job requires something absent from the resume, omit it. Never add it.
If a bullet cannot be improved without new facts, keep the original meaning.

Return JSON only with this shape:
{
  "summary": "string",
  "skills": ["string"],
  "experience": [{ "company": "", "title": "", "dates": "", "bullets": [""] }],
  "projects": [{ "name": "", "bullets": [""] }],
  "education": [{ "degree": "", "field": "", "details": "" }],
  "certifications": ["string"],
  "changes": [{ "kind": "emphasis|rewritten|reordered|omitted", "label": "", "before": "", "after": "" }],
  "omissions": ["string"],
  "warnings": ["string"]
}

Use only employers, titles, dates, skills, education, certifications, and projects present in the source resume.
Use standard section headings and readable bullets. Keywords must appear in meaningful context.`

export function tailorUserPrompt(input: {
  resumeText: string
  jobDescription: string
  plan: TailoringPlan
  profile: ResumeProfile | null
  jobProfile: JobProfile | null
  report: MatchReport | null
  source: SourceFacts
  contact: { name: string; email: string; location: string }
}): string {
  const coverage = input.plan.coverage
  const coverageLine = coverage
    ? `JD coverage (supported / stated, not a match score): required ${coverage.requiredSupported}/${coverage.requiredTotal}, preferred ${coverage.preferredSupported}/${coverage.preferredTotal}, overall ${coverage.overallSupported}/${coverage.overallTotal}.`
    : ''
  return [
    `Candidate: ${input.contact.name || 'Unknown'}`,
    `Email: ${input.contact.email || ''}`,
    `Location: ${input.contact.location || ''}`,
    input.plan.targetRole ? `Target role: ${input.plan.targetRole}` : '',
    input.plan.roleType ? `Role type: ${input.plan.roleType}` : '',
    coverageLine,
    '',
    'Skills already supported by the resume (you may reorder, never invent):',
    input.source.skills.join(', ') || '(none extracted)',
    '',
    'Employers:',
    input.source.employers.join(', ') || '(none extracted)',
    'Titles:',
    input.source.titles.join(', ') || '(none extracted)',
    'Certifications:',
    input.source.certifications.join(', ') || '(none)',
    '',
    'Emphasize only if already supported (required + supported first):',
    input.plan.skillsToEmphasize.join(', ') || '(none)',
    'Related but do not invent:',
    input.plan.relatedSkills.join(', ') || '(none)',
    'Missing from resume — DO NOT ADD:',
    input.plan.missingSkills.join(', ') || '(none)',
    'Experience themes to emphasize if already present:',
    input.plan.experienceToEmphasize.join(', ') || '(none)',
    '',
    'SOURCE RESUME:',
    input.resumeText,
    '',
    'JOB DESCRIPTION (relevance guide only):',
    input.jobDescription,
    '',
    input.report ? `Match score: ${input.report.matchScore}. Recommendation: ${input.report.recommendation}.` : '',
  ]
    .filter((line) => line !== '')
    .join('\n')
}
