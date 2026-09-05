import { describe, expect, it } from 'vitest'
import { parseJobProfile, parseResumeProfile } from '../match/parse-extract'
import { requireNonEmptyText } from './validate'
import { analyzeJobDescription, parseAnalyzeRequest } from './analysis'
import { HttpError } from '../types'
import { JOB_EXTRACT_PROMPT, RESUME_EXTRACT_PROMPT, jobExtractUserPrompt, resumeExtractUserPrompt } from '../match/prompts'

describe('requireNonEmptyText', () => {
  it('rejects missing, blank, and non-string values', () => {
    expect(() => requireNonEmptyText('', 'jobDescription')).toThrow('jobDescription must not be empty')
    expect(() => requireNonEmptyText('   ', 'resumeText')).toThrow('resumeText must not be empty')
    expect(() => requireNonEmptyText(null, 'jobDescription')).toThrow('jobDescription is required')
  })

  it('trims valid text', () => {
    expect(requireNonEmptyText('  hello  ', 'jobDescription')).toBe('hello')
  })
})

describe('parseAnalyzeRequest', () => {
  it('requires jobDescription and resumeText', () => {
    try {
      parseAnalyzeRequest({ jobDescription: '', resumeText: 'resume' })
      throw new Error('expected failure')
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError)
      expect((error as HttpError).status).toBe(400)
      expect((error as HttpError).message).toContain('jobDescription')
    }

    try {
      parseAnalyzeRequest({ jobDescription: 'role', resumeText: '   ' })
      throw new Error('expected failure')
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError)
      expect((error as HttpError).message).toContain('resumeText')
    }
  })

  it('accepts the required contract plus optional storage fields', () => {
    const parsed = parseAnalyzeRequest({
      jobDescription: 'Senior frontend engineer',
      resumeText: 'Built React apps for 6 years.',
      userId: 'user-1',
      jobId: '3b9f0c2a-7d11-4c3a-9f12-8a1b2c3d4e5f',
      matchId: '4c0e1d3b-8e22-4d4b-a023-9b2c3d4e5f60',
      title: 'Senior Frontend Engineer',
    })
    expect(parsed.jobDescription).toBe('Senior frontend engineer')
    expect(parsed.resumeText).toBe('Built React apps for 6 years.')
    expect(parsed.userId).toBe('user-1')
    expect(parsed.jobId).toBe('3b9f0c2a-7d11-4c3a-9f12-8a1b2c3d4e5f')
    expect(parsed.matchId).toBe('4c0e1d3b-8e22-4d4b-a023-9b2c3d4e5f60')
  })

  it('accepts precomputed profiles and persistResults=false', () => {
    const parsed = parseAnalyzeRequest({
      jobDescription: 'Java engineer',
      resumeText: 'Java Spring Boot',
      resumeProfile: { skills: [{ name: 'Java' }] },
      jobProfile: { requiredSkills: ['Java'] },
      persistResults: false,
    })
    expect(parsed.persistResults).toBe(false)
    expect(parsed.resumeProfile).toEqual({ skills: [{ name: 'Java' }] })
    expect(parsed.jobProfile).toEqual({ requiredSkills: ['Java'] })
  })
})

describe('extract payload parsing', () => {
  it('parses a resume evidence profile', () => {
    const profile = parseResumeProfile({
      skills: [{ name: 'React', evidence: 'Built React apps', years: 6 }],
      jobTitles: ['Frontend Engineer'],
      yearsOfExperience: 6,
    })
    expect(profile.skills[0]?.name).toBe('React')
    expect(profile.yearsOfExperience).toBe(6)
  })

  it('fails closed on a non-object resume payload', () => {
    expect(() => parseResumeProfile('nope')).toThrow(/invalid payload/i)
  })

  it('parses required vs preferred job skills', () => {
    const job = parseJobProfile({
      requiredSkills: ['Java'],
      preferredSkills: [{ name: 'Kubernetes' }],
      yearsOfExperience: 3,
    })
    expect(job.requiredSkills.map((item) => item.name)).toEqual(['Java'])
    expect(job.preferredSkills.map((item) => item.name)).toEqual(['Kubernetes'])
    expect(job.yearsOfExperience).toBe(3)
  })
})

describe('prompt contract', () => {
  it('forbids inventing candidate experience', () => {
    expect(RESUME_EXTRACT_PROMPT).toMatch(/Do not invent/i)
    expect(RESUME_EXTRACT_PROMPT).toMatch(/only information explicitly present/i)
    expect(JOB_EXTRACT_PROMPT).toMatch(/REQUIRED/)
    expect(JOB_EXTRACT_PROMPT).toMatch(/PREFERRED/)
  })

  it('sends resume and job as separate labeled sections', () => {
    expect(resumeExtractUserPrompt('Python intern, 2019')).toContain('RESUME')
    expect(jobExtractUserPrompt('Need Rust')).toContain('JOB DESCRIPTION')
    expect(jobExtractUserPrompt('Need Rust')).toContain('Need Rust')
  })
})

describe('analyzeJobDescription with supplied profiles', () => {
  const config = {
    port: 0,
    llmApiKey: '',
    llmApiBaseUrl: '',
    llmModel: '',
    supabaseUrl: '',
    supabaseServiceRoleKey: '',
  }
  const llm = {
    extractJson: async () => {
      throw new Error('LLM should not be called')
    },
    extractResume: async () => {
      throw new Error('Resume extraction should not be called')
    },
    extractJob: async () => {
      throw new Error('Job extraction should not be called')
    },
  }

  it('scores without calling the LLM and without persisting the original match', async () => {
    let persistCalled = false
    const result = await analyzeJobDescription(
      config,
      llm,
      {
        jobDescription: 'Need Java, Spring Boot, and PostgreSQL. Kubernetes is preferred. Build payment APIs.',
        resumeText:
          'Jordan Hale\nSkills: Java, Spring Boot, PostgreSQL\nDeveloped Java and Spring Boot applications for payments APIs. Owned PostgreSQL schema changes for billing.',
        resumeProfile: {
          skills: [
            { name: 'Java', evidence: 'Java' },
            { name: 'Spring Boot', evidence: 'Spring Boot' },
            { name: 'PostgreSQL', evidence: 'PostgreSQL' },
          ],
        },
        jobProfile: {
          requiredSkills: [{ name: 'Java' }, { name: 'Spring Boot' }, { name: 'PostgreSQL' }],
          preferredSkills: [{ name: 'Kubernetes' }],
        },
        persistResults: false,
      },
      async () => {
        persistCalled = true
        return { persisted: true, jobId: 'job', matchId: 'match' }
      },
    )
    expect(persistCalled).toBe(false)
    expect(result.persist.persisted).toBe(false)
    expect(result.result.matchScore).toBeGreaterThan(70)
    expect(result.result.requiredSkills.missing).toHaveLength(0)
  })

  it('can lower the score when Spring Boot is removed from the tailored resume', async () => {
    const strong = await analyzeJobDescription(
      config,
      llm,
      {
        jobDescription: 'Need Java, Spring Boot, and PostgreSQL.',
        resumeText: 'Java, Spring Boot, PostgreSQL. Developed Java and Spring Boot applications.',
        resumeProfile: {
          skills: [{ name: 'Java' }, { name: 'Spring Boot' }, { name: 'PostgreSQL' }],
        },
        jobProfile: {
          requiredSkills: [{ name: 'Java' }, { name: 'Spring Boot' }, { name: 'PostgreSQL' }],
        },
        persistResults: false,
      },
      async () => ({ persisted: false, jobId: null, matchId: null }),
    )
    const weak = await analyzeJobDescription(
      config,
      llm,
      {
        jobDescription: 'Need Java, Spring Boot, and PostgreSQL.',
        resumeText: 'Java and Python. Worked on internal tools.',
        resumeProfile: {
          skills: [{ name: 'Java' }, { name: 'Python' }],
        },
        jobProfile: {
          requiredSkills: [{ name: 'Java' }, { name: 'Spring Boot' }, { name: 'PostgreSQL' }],
        },
        persistResults: false,
      },
      async () => ({ persisted: false, jobId: null, matchId: null }),
    )
    expect(weak.result.matchScore).toBeLessThan(strong.result.matchScore)
  })
})
