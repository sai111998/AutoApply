import { afterEach, describe, expect, it } from 'vitest'
import { emptyNormalizedJob } from './normalize'
import { previewLiveJobTailor, clearLivePreviewCache } from './preview'
import { clearLiveScoreCache, liveScoreCacheStats, scoreJobAgainstResume } from './score'
import { JAVA_BACKEND_JD, JAVA_RESUME_TEXT, MISSING_STACK_JD } from '../tailor/fixtures'

const javaJob = emptyNormalizedJob({
  id: 'job-java',
  provider: 'job-opportunities',
  providerJobId: 'job-java',
  title: 'Senior Java Engineer',
  company: 'ABC',
  description: JAVA_BACKEND_JD,
})

const kubernetesJob = emptyNormalizedJob({
  id: 'job-k8s',
  provider: 'job-opportunities',
  providerJobId: 'job-k8s',
  title: 'Platform Engineer',
  company: 'ABC',
  description: MISSING_STACK_JD,
})

afterEach(() => {
  clearLiveScoreCache()
  clearLivePreviewCache()
})

describe('live job Match Engine scoring', () => {
  it('scores fetched jobs with the existing Match Engine and extracts skills', () => {
    const match = scoreJobAgainstResume(javaJob, JAVA_RESUME_TEXT, 'resume-1')
    expect(match.score).toEqual(expect.any(Number))
    expect(match.score).toBeGreaterThan(0)
    expect(match.score).not.toBe(80)
    expect(match.score).not.toBe(85)
    expect(match.matchedSkills.join(' ')).toMatch(/Java/i)
    expect(match.missingSkills.join(' ')).toMatch(/Kubernetes/i)
    expect(match.resumeVersionId).toBe('resume-1')
    expect(match.scoreUpdatedAt).toBeTruthy()
    expect(match.cached).toBe(false)
  })

  it('reuses the cached score for the same job and resume version', () => {
    const first = scoreJobAgainstResume(javaJob, JAVA_RESUME_TEXT, 'resume-1')
    const second = scoreJobAgainstResume(javaJob, JAVA_RESUME_TEXT, 'resume-1')
    expect(second.cached).toBe(true)
    expect(second.score).toBe(first.score)
    expect(second.matchedSkills).toEqual(first.matchedSkills)
    expect(second.missingSkills).toEqual(first.missingSkills)
    expect(liveScoreCacheStats().hits).toBe(1)
    expect(liveScoreCacheStats().misses).toBe(1)
  })

  it('recalculates when the resume changes', () => {
    const first = scoreJobAgainstResume(javaJob, JAVA_RESUME_TEXT, 'resume-1')
    const changed = scoreJobAgainstResume(javaJob, 'Python developer with Django.', 'resume-1')
    expect(changed.cached).toBe(false)
    expect(changed.score).not.toBe(first.score)
  })

  it('recalculates when the job description changes', () => {
    const first = scoreJobAgainstResume(javaJob, JAVA_RESUME_TEXT, 'resume-1')
    const changed = scoreJobAgainstResume(kubernetesJob, JAVA_RESUME_TEXT, 'resume-1')
    expect(changed.cached).toBe(false)
    expect(changed.score).not.toBe(first.score)
    expect(changed.missingSkills.join(' ')).toMatch(/Kubernetes|Terraform|Go/i)
  })

  it('previews a tailored score with the same Match Engine without fabricating experience', () => {
    const preview = previewLiveJobTailor({
      resumeText: JAVA_RESUME_TEXT,
      resumeVersionId: 'resume-1',
      job: kubernetesJob,
    })
    expect(preview.current.score).toEqual(expect.any(Number))
    expect(preview.tailored.score).toEqual(expect.any(Number))
    expect(preview.tailored.score).toBeGreaterThanOrEqual(preview.current.score ?? 0)
    expect(preview.previewText).not.toMatch(/invented-certification/i)
    expect(preview.stillMissing.join(' ')).toMatch(/Kubernetes|Terraform|Go/i)
    const again = previewLiveJobTailor({
      resumeText: JAVA_RESUME_TEXT,
      resumeVersionId: 'resume-1',
      job: kubernetesJob,
    })
    expect(again.cached).toBe(true)
    expect(again.tailored.score).toBe(preview.tailored.score)
  })
})
