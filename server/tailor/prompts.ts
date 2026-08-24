import type { JobProfile, MatchReport, ResumeProfile } from '../match/types'
import type { SourceFacts, TailoringPlan } from './types'

export const TAILOR_SYSTEM_PROMPT = `You are rewriting an existing resume for a specific job.

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
Do not keyword-stuff. Use standard section content, not tables or icons.`

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
  return [
    `Candidate: ${input.contact.name || 'Unknown'}`,
    `Email: ${input.contact.email || ''}`,
    `Location: ${input.contact.location || ''}`,
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
    'Emphasize only if already supported:',
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
