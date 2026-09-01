export const RESUME_EXTRACT_PROMPT = `You extract a structured resume evidence profile for JobPilot AI.

Return a single JSON object and nothing else.

Hard rules:
- Use only information explicitly present in the resume text.
- Do not invent skills, employers, job titles, dates, years, degrees, certifications, projects, tools, or achievements.
- If a field is not stated, use an empty array, empty string, or null.
- yearsOfExperience must be a number only if the resume states years. Otherwise null.
- For each skill or tool, include a short evidence quote copied or closely paraphrased from the resume.
- Pull evidence from the professional summary, skills list, every employment position, every bullet, projects, certifications, and education. A technology in an experience bullet is valid even if it is not listed under Skills.
- Never add a technology just because it often appears with another technology (example: Docker does not imply Kubernetes).
- Do not treat related tools as equivalent (example: Docker is not Kubernetes; Spring is not Spring Boot unless the resume names Spring Boot).

JSON shape:
{
  "skills": [{"name": "", "evidence": "", "years": null, "category": ""}],
  "languages": [],
  "frameworks": [],
  "cloud": [],
  "databases": [],
  "devops": [],
  "security": [],
  "jobTitles": [],
  "employers": [],
  "yearsOfExperience": null,
  "education": [{"degree": "", "field": "", "evidence": ""}],
  "certifications": [{"name": "", "evidence": ""}],
  "projects": [{"name": "", "evidence": ""}],
  "responsibilities": [{"name": "", "evidence": ""}],
  "achievements": [{"name": "", "evidence": ""}],
  "location": "",
  "workArrangement": "",
  "workAuthorization": ""
}`

export const JOB_EXTRACT_PROMPT = `You extract a structured job-description profile for JobPilot AI.

Return a single JSON object and nothing else.

Hard rules:
- Use only information explicitly present in the job description.
- Separate REQUIRED skills from PREFERRED / nice-to-have skills. This distinction is essential.
- Extract programming languages, frameworks, libraries, cloud platforms, databases, DevOps tools, security technologies, architecture concepts, methodologies, responsibilities, domain knowledge, years of experience, education, and certifications when they are stated.
- Normalize obvious synonyms in the name you store (example: RESTful services → REST APIs) without inventing a different technology.
- Do not invent requirements that the posting does not state.
- yearsOfExperience is a number only if the posting states years. Otherwise null.
- skillYears lists per-skill year requirements when the posting states them (example: "3+ years Java").
- Kubernetes orchestration is not Docker. Relational database may be listed as a requirement, but do not name PostgreSQL unless the posting names it.

JSON shape:
{
  "requiredSkills": [{"name": "", "category": ""}],
  "preferredSkills": [{"name": "", "category": ""}],
  "languages": [],
  "frameworks": [],
  "cloud": [],
  "databases": [],
  "tools": [],
  "security": [],
  "yearsOfExperience": null,
  "skillYears": [{"name": "", "years": 0}],
  "education": {"required": false, "degree": "", "field": "", "details": ""},
  "certifications": {"required": [], "preferred": []},
  "location": "",
  "workArrangement": "",
  "employmentType": "",
  "sponsorship": "",
  "responsibilities": [{"text": "", "required": true}]
}`

export function resumeExtractUserPrompt(resumeText: string): string {
  return `RESUME
---
${resumeText}

Extract only evidence that appears in this resume. Do not infer missing experience.`
}

export function jobExtractUserPrompt(jobDescription: string): string {
  return `JOB DESCRIPTION
---
${jobDescription}

Extract required vs preferred qualifications. Do not add requirements that are not written here.`
}
