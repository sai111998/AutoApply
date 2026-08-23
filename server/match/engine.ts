import { extractEvidenceSnippet, relatedSkill, sameSkill, tokenOverlap } from './normalize'
import { allResumeSkills, mergeJobSkills } from './ground'
import type {
  Confidence,
  DimensionReport,
  EvidenceItem,
  FitStatus,
  JobProfile,
  JobSkill,
  MatchReport,
  Recommendation,
  RequirementSource,
  ResumeProfile,
  SkillAssessment,
} from './types'
import { SCORE_WEIGHTS } from './types'

function assessSkill(
  skill: JobSkill,
  resumeSkills: EvidenceItem[],
  resumeText: string,
  source: RequirementSource,
): SkillAssessment {
  const exact = resumeSkills.find((item) => sameSkill(item.name, skill.name))
  if (exact) {
    return {
      name: skill.name,
      classification: 'strong',
      source,
      evidence: exact.evidence || extractEvidenceSnippet(resumeText, exact.name),
    }
  }

  const related = resumeSkills.find((item) => relatedSkill(skill.name, item.name) || relatedSkill(item.name, skill.name))
  if (related) {
    return {
      name: skill.name,
      classification: 'partial',
      source,
      evidence: related.evidence || extractEvidenceSnippet(resumeText, related.name),
    }
  }

  const snippet = extractEvidenceSnippet(resumeText, skill.name)
  if (snippet) {
    return { name: skill.name, classification: 'strong', source, evidence: snippet }
  }

  return { name: skill.name, classification: 'missing', source, evidence: '' }
}

function bucket(items: SkillAssessment[]) {
  return {
    matched: items.filter((item) => item.classification === 'strong'),
    partial: items.filter((item) => item.classification === 'partial'),
    missing: items.filter((item) => item.classification === 'missing'),
  }
}

function coverage(items: SkillAssessment[]): number {
  if (items.length === 0) return 1
  const points = items.reduce((sum, item) => {
    if (item.classification === 'strong') return sum + 1
    if (item.classification === 'partial') return sum + 0.5
    return sum
  }, 0)
  return points / items.length
}

function yearsFromResume(profile: ResumeProfile, skillName?: string): number | null {
  if (skillName) {
    const skill = allResumeSkills(profile).find((item) => sameSkill(item.name, skillName))
    if (typeof skill?.years === 'number') return skill.years
  }
  return typeof profile.yearsOfExperience === 'number' ? profile.yearsOfExperience : null
}

function analyzeExperience(resume: ResumeProfile, job: JobProfile, resumeText: string): DimensionReport {
  const skillYear = job.skillYears[0]
  const requiredYears = skillYear?.years ?? job.yearsOfExperience
  const jobRequirement = skillYear
    ? `${skillYear.years}+ years ${skillYear.name}`
    : requiredYears
      ? `${requiredYears}+ years of relevant experience`
      : 'No explicit years-of-experience requirement.'

  if (requiredYears == null) {
    return {
      status: 'not_applicable',
      jobRequirement,
      candidateEvidence: resume.yearsOfExperience != null ? `${resume.yearsOfExperience} years stated on the resume.` : 'No years of experience were stated.',
      gap: '',
    }
  }

  const evidencedYears = yearsFromResume(resume, skillYear?.name)
  if (evidencedYears == null) {
    const snippet = extractEvidenceSnippet(resumeText, 'year')
    return {
      status: 'insufficient_evidence',
      jobRequirement,
      candidateEvidence: snippet || 'The resume does not state years of experience for this requirement.',
      gap: 'Insufficient evidence to compare years of experience. No years were invented.',
    }
  }

  const candidateEvidence = `${evidencedYears} years evidenced on the resume${
    skillYear?.name ? ` (looking for ${skillYear.name})` : ''
  }.`

  if (evidencedYears >= requiredYears) {
    return { status: 'match', jobRequirement, candidateEvidence, gap: '' }
  }
  if (evidencedYears >= requiredYears * 0.6) {
    return {
      status: 'partial',
      jobRequirement,
      candidateEvidence,
      gap: `Resume shows ${evidencedYears} years versus ${requiredYears}+ required.`,
    }
  }
  return {
    status: 'gap',
    jobRequirement,
    candidateEvidence,
    gap: `Resume shows ${evidencedYears} years versus ${requiredYears}+ required.`,
  }
}

function analyzeEducation(resume: ResumeProfile, job: JobProfile): { status: FitStatus; details: string } {
  if (!job.education.required && !job.education.degree && !job.education.field) {
    return { status: 'not_applicable', details: 'The posting does not state an education requirement.' }
  }
  if (resume.education.length === 0) {
    return {
      status: 'unknown',
      details: 'The resume does not include enough education evidence to confirm the requirement.',
    }
  }

  const stated = resume.education
    .map((item) => [item.degree, item.field, item.evidence].filter(Boolean).join(' — '))
    .join('; ')
  const requiredDegree = job.education.degree.toLowerCase()
  const requiredField = job.education.field.toLowerCase()
  const blob = stated.toLowerCase()

  const degreeHit =
    !requiredDegree ||
    blob.includes(requiredDegree) ||
    (requiredDegree.includes('bachelor') && (blob.includes('b.a') || blob.includes('b.s') || blob.includes('bachelor'))) ||
    (requiredDegree.includes('master') && (blob.includes('m.s') || blob.includes('m.a') || blob.includes('master')))

  const fieldHit = !requiredField || blob.includes(requiredField)

  if (degreeHit && fieldHit) {
    return { status: 'match', details: `Resume evidence: ${stated}` }
  }
  if (degreeHit || fieldHit) {
    return { status: 'partial', details: `Partial overlap. Resume evidence: ${stated}. Posting asked for ${job.education.details || job.education.degree || job.education.field}.` }
  }
  return {
    status: 'missing',
    details: `Posting asked for ${job.education.details || [job.education.degree, job.education.field].filter(Boolean).join(' ')}. Resume evidence: ${stated}`,
  }
}

function analyzeCerts(resume: ResumeProfile, job: JobProfile, resumeText: string) {
  const required = job.certifications.required.map((name) => assessSkill({ name }, resume.certifications, resumeText, 'required'))
  const preferred = job.certifications.preferred.map((name) => assessSkill({ name }, resume.certifications, resumeText, 'preferred'))
  return {
    matched: [...required, ...preferred].filter((item) => item.classification === 'strong'),
    missing: required.filter((item) => item.classification === 'missing'),
    preferredMissing: preferred.filter((item) => item.classification === 'missing'),
  }
}

function analyzeLocation(resume: ResumeProfile, job: JobProfile): { status: FitStatus; details: string } {
  const jobLoc = `${job.location} ${job.workArrangement}`.trim()
  if (!jobLoc) {
    return { status: 'not_applicable', details: 'The posting does not state a location or work-arrangement constraint.' }
  }
  const remote = /remote|anywhere|distributed/i.test(jobLoc)
  const hybrid = /hybrid/i.test(jobLoc)
  const onsite = /on-?site|in office|office/i.test(jobLoc)
  const resumeLoc = `${resume.location} ${resume.workArrangement}`.trim()

  if (remote && !onsite) {
    return {
      status: resumeLoc && /on-?site only/i.test(resumeLoc) ? 'gap' : 'match',
      details: 'The posting is remote or unrestricted. Compatibility is based only on stated resume location/arrangement.',
    }
  }
  if (!resumeLoc) {
    return {
      status: 'unknown',
      details: `Posting location/arrangement: ${jobLoc}. The resume does not state a location or work arrangement.`,
    }
  }
  if (sameSkill(resume.location, job.location) || tokenOverlap(resumeLoc, jobLoc) >= 0.2) {
    return { status: 'match', details: `Resume states ${resumeLoc}. Posting asks for ${jobLoc}.` }
  }
  if (hybrid && resumeLoc) {
    return { status: 'partial', details: `Resume states ${resumeLoc}. Posting is hybrid (${jobLoc}).` }
  }
  return { status: 'gap', details: `Resume states ${resumeLoc}. Posting asks for ${jobLoc}.` }
}

function analyzeResponsibilities(resume: ResumeProfile, job: JobProfile, resumeText: string) {
  const resumeWork = [...resume.responsibilities, ...resume.achievements, ...resume.projects]
  const strongMatches: SkillAssessment[] = []
  const partialMatches: SkillAssessment[] = []
  const gaps: SkillAssessment[] = []

  for (const item of job.responsibilities) {
    let best = 0
    let evidence = ''
    for (const work of resumeWork) {
      const score = tokenOverlap(item.text, `${work.name} ${work.evidence}`)
      if (score > best) {
        best = score
        evidence = work.evidence || work.name
      }
    }
    if (!evidence) {
      const snippet = extractEvidenceSnippet(resumeText, item.text.split(' ').slice(0, 4).join(' '))
      if (snippet) {
        best = Math.max(best, 0.16)
        evidence = snippet
      }
    }
    const assessment: SkillAssessment = {
      name: item.text,
      classification: best >= 0.28 ? 'strong' : best >= 0.12 ? 'partial' : 'missing',
      source: item.required ? 'required' : 'preferred',
      evidence,
    }
    if (assessment.classification === 'strong') strongMatches.push(assessment)
    else if (assessment.classification === 'partial') partialMatches.push(assessment)
    else gaps.push(assessment)
  }

  return { strongMatches, partialMatches, gaps }
}

function statusScore(status: FitStatus): number {
  switch (status) {
    case 'match':
    case 'not_applicable':
      return 1
    case 'partial':
      return 0.55
    case 'insufficient_evidence':
    case 'unknown':
      return 0.4
    case 'gap':
    case 'missing':
      return 0.15
    default:
      return 0.4
  }
}

function recommend(
  score: number,
  requiredMissing: number,
  requiredCount: number,
  experience: FitStatus,
  education: FitStatus,
): Recommendation {
  const majorRequiredGap = requiredMissing > 0 && requiredCount > 0
  const experienceGap = experience === 'gap'
  if (score < 48 || requiredMissing >= 2 || (majorRequiredGap && requiredMissing / requiredCount >= 0.5) || (experienceGap && score < 70)) {
    return 'SKIP'
  }
  if (
    score >= 78 &&
    requiredMissing === 0 &&
    experience !== 'gap' &&
    experience !== 'insufficient_evidence' &&
    education !== 'missing'
  ) {
    return 'APPLY'
  }
  return 'REVIEW'
}

function confidenceOf(missingEvidence: string[], requiredUnknown: boolean): Confidence {
  if (missingEvidence.length >= 3 || requiredUnknown) return 'LOW'
  if (missingEvidence.length >= 1) return 'MEDIUM'
  return 'HIGH'
}

export function scoreMatch(resume: ResumeProfile, job: JobProfile, resumeText: string): MatchReport {
  const resumeSkills = allResumeSkills(resume)
  const { required, preferred } = mergeJobSkills(job)
  const requiredAssessed = required.map((skill) => assessSkill(skill, resumeSkills, resumeText, 'required'))
  const preferredAssessed = preferred.map((skill) => assessSkill(skill, resumeSkills, resumeText, 'preferred'))
  const requiredSkills = bucket(requiredAssessed)
  const preferredSkills = bucket(preferredAssessed)
  const experience = analyzeExperience(resume, job, resumeText)
  const education = analyzeEducation(resume, job)
  const certs = analyzeCerts(resume, job, resumeText)
  const location = analyzeLocation(resume, job)
  const responsibilities = analyzeResponsibilities(resume, job, resumeText)

  const components = {
    requiredSkills: coverage(requiredAssessed),
    experience: statusScore(experience.status),
    responsibilities: coverage([
      ...responsibilities.strongMatches,
      ...responsibilities.partialMatches,
      ...responsibilities.gaps,
    ]),
    educationCerts:
      (statusScore(education.status) + (certs.missing.length === 0 ? 1 : Math.max(0, 1 - certs.missing.length * 0.4))) / 2,
    preferredSkills: coverage(preferredAssessed),
    location: statusScore(location.status),
  }

  let matchScore = Math.round(
    Object.entries(SCORE_WEIGHTS).reduce((sum, [key, weight]) => {
      return sum + weight * components[key as keyof typeof SCORE_WEIGHTS] * 100
    }, 0),
  )

  if (requiredSkills.missing.length >= 2) matchScore = Math.min(matchScore, 49)
  else if (requiredSkills.missing.length === 1) matchScore = Math.min(matchScore, 74)

  matchScore = Math.max(0, Math.min(100, matchScore))

  const missingEvidence: string[] = []
  if (experience.status === 'insufficient_evidence') missingEvidence.push('Years of experience are not stated clearly enough to compare.')
  if (education.status === 'unknown') missingEvidence.push('Education evidence is missing or too thin to confirm the posting requirement.')
  if (location.status === 'unknown') missingEvidence.push('Location or work arrangement is not stated on the resume.')
  if (resumeSkills.length === 0) missingEvidence.push('No grounded technical skills could be taken from the resume text.')

  const recommendation = recommend(
    matchScore,
    requiredSkills.missing.length,
    requiredAssessed.length,
    experience.status,
    education.status,
  )

  const strengths = [
    ...requiredSkills.matched.slice(0, 3).map((item) => `${item.name}: evidenced on the resume.`),
    ...responsibilities.strongMatches.slice(0, 2).map((item) => `Aligned responsibility: ${item.name}`),
  ].slice(0, 5)

  const concerns = [
    ...requiredSkills.missing.map((item) => `Required skill not evidenced: ${item.name}`),
    ...certs.missing.map((item) => `Required certification not evidenced: ${item.name}`),
    experience.gap,
    education.status === 'missing' || education.status === 'unknown' ? education.details : '',
    location.status === 'gap' ? location.details : '',
  ]
    .filter(Boolean)
    .slice(0, 6)

  const summary = [
    `Match score ${matchScore} / 100 with a ${recommendation} recommendation.`,
    requiredAssessed.length
      ? `Required skills: ${requiredSkills.matched.length} strong, ${requiredSkills.partial.length} partial, ${requiredSkills.missing.length} missing.`
      : 'The posting did not list distinct required skills after grounding.',
    experience.status === 'not_applicable'
      ? 'No explicit experience-year requirement was stated.'
      : `Experience: ${experience.status.replaceAll('_', ' ')}.`,
    'This is a fit recommendation from the supplied resume and job description, not a hiring or interview prediction.',
  ].join(' ')

  return {
    matchScore,
    recommendation,
    confidence: confidenceOf(missingEvidence, education.status === 'unknown' || experience.status === 'insufficient_evidence'),
    requiredSkills,
    preferredSkills,
    experience,
    responsibilities,
    education,
    certifications: { matched: certs.matched, missing: certs.missing },
    location,
    strengths: strengths.length ? strengths : ['Limited positive overlap could be stated from the resume text.'],
    concerns: concerns.length ? concerns : ['No major concerns were identified from the supplied texts.'],
    missingEvidence,
    summary,
    scoring: { weights: SCORE_WEIGHTS, components },
  }
}

export function toLegacyArrays(report: MatchReport) {
  const matched = [
    ...report.requiredSkills.matched,
    ...report.preferredSkills.matched,
  ].map((item) => item.name)
  const partial = [
    ...report.requiredSkills.partial,
    ...report.preferredSkills.partial,
  ].map((item) => item.name)
  const missing = [
    ...report.requiredSkills.missing,
    ...report.preferredSkills.missing,
  ].map((item) => item.name)
  return {
    matchedSkills: uniqueNames(matched),
    partiallyMatchedSkills: uniqueNames(partial),
    missingSkills: uniqueNames(missing),
    experienceMatch: report.experience.status === 'match' || report.experience.status === 'not_applicable',
    educationMatch: report.education.status === 'match' || report.education.status === 'not_applicable',
    locationMatch: report.location.status === 'match' || report.location.status === 'not_applicable',
  }
}

function uniqueNames(names: string[]): string[] {
  return [...new Set(names)]
}
