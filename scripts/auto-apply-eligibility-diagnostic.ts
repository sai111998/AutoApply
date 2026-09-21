import { writeFileSync } from 'node:fs'
import { getServerConfig } from '../server/config'
import { listLiveJobs } from '../server/jobs/list'
import { JAVA_RESUME_TEXT } from '../server/tailor/fixtures'
import { defaultAutoApplyConfig, resetAutoApplyEngineForTests } from '../server/apply/engine'
import { evaluateJobEligibility } from '../server/agent/pipeline'
import { startCampaign } from '../server/agent/agent'
import { canEnterAutonomousApply } from '../server/apply/capability'
import { schedulerRunning, stopAgentScheduler } from '../server/agent/scheduler'
import { agentIntervalMs } from '../server/agent/policy'
import { getCampaign } from '../server/agent/state'
import { getBrowserWorker } from '../server/browser-worker/worker'
import type { AutoApplyProfile } from '../server/apply/types'

const profile: AutoApplyProfile = {
  fullName: 'Jordan Hale',
  email: 'jordan.hale@example.com',
  location: 'Austin, TX',
  yearsOfExperience: 6,
  workAuthorization: 'us_citizen',
  sponsorshipRequired: false,
  preferredWorkArrangement: 'hybrid',
  targetSalaryMin: null,
  targetSalaryMax: null,
}

function distribution(scores: Array<number | null>) {
  const known = scores.filter((score): score is number => typeof score === 'number' && Number.isFinite(score))
  const missing = scores.length - known.length
  if (!known.length) return { missing, count: 0, min: null, max: null, median: null, ge70: 0, lt70: 0 }
  const sorted = [...known].sort((left, right) => left - right)
  const mid = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  return {
    missing,
    count: known.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    median,
    ge70: known.filter((score) => score >= 70).length,
    lt70: known.filter((score) => score < 70).length,
  }
}

async function main() {
  resetAutoApplyEngineForTests()
  const config = getServerConfig()
  const listed = await listLiveJobs(config, {
    q: 'Java',
    country: 'US',
    state: '',
    remote: 'any',
    employmentType: 'any',
    seniority: '',
    page: 1,
    limit: 50,
    resumeText: JAVA_RESUME_TEXT,
    resumeVersionId: 'resume-1',
    sort: 'match',
    jobType: 'all',
  })
  const startInput = {
    userId: 'diagnostic',
    resumeId: 'resume-1',
    resumeVersionId: 'resume-1',
    resumeText: JAVA_RESUME_TEXT,
    masterResumeText: JAVA_RESUME_TEXT,
    profile,
    config: defaultAutoApplyConfig({
      maxJobs: 5,
      minimumMatchRate: 70,
      autoTailorResume: true,
      q: 'Java',
      jobType: 'all',
      remotePreference: 'any',
      keywords: [],
      employmentType: 'any',
    }),
  }
  const rows = listed.jobs.slice(0, Math.max(10, Math.min(12, listed.jobs.length))).map((job) => {
    const evaluated = evaluateJobEligibility(job, { startInput })
    return {
      jobId: job.id,
      title: job.title,
      company: job.company,
      url: job.jobUrl || job.url,
      currentScore: evaluated.initialScore,
      tailoredScore: evaluated.tailoredScore,
      resumeVersionId: evaluated.resumeVersionId,
      eligible: evaluated.ok,
      capability: evaluated.capability,
      autoApplyCapable: canEnterAutonomousApply(evaluated.capability),
      stage: evaluated.stage,
      code: evaluated.code ?? null,
      reason: evaluated.ok
        ? evaluated.initialScore != null && evaluated.initialScore >= 70
          ? 'Current score >= 70'
          : 'Tailored score >= 70'
        : evaluated.reason,
    }
  })
  const started = await startCampaign(config, startInput, {
    deps: {
      delayMs: 0,
      listJobs: async () => listed,
    },
    schedule: true,
  })
  const campaign = getCampaign(started.run.id)
  const intervalMs = agentIntervalMs()
  const report = {
    found: started.run.counts.found,
    eligible: started.run.counts.eligible,
    autoApplyCapable: started.run.counts.autoApplyCapable,
    queued: started.items.length,
    warning: listed.warning ?? null,
    funnel: started.funnel,
    threshold: started.run.config.minimumMatchRate,
    jobType: started.run.config.jobType,
    remote: started.run.config.remotePreference,
    keywords: started.run.config.keywords,
    autoTailor: started.run.config.autoTailorResume,
    maxJobs: started.run.config.maxJobs,
    campaignStatus: campaign?.status ?? started.run.status,
    lastDiscoveryAt: started.funnel?.lastDiscoveryAt ?? campaign?.lastTickAt ?? null,
    lastEligibilityAt: started.funnel?.lastEligibilityAt ?? null,
    nextDiscoveryAt: campaign?.lastTickAt
      ? new Date(campaign.lastTickAt + intervalMs).toISOString()
      : new Date(Date.now() + intervalMs).toISOString(),
    schedulerRunning: schedulerRunning(),
    browserWorkerRunning: Boolean(getBrowserWorker()?.running()),
    newJobs: listed.jobs.length,
    currentScoreDistribution: distribution(listed.jobs.map((job) => job.match?.score ?? job.matchScore ?? null)),
    tailoredScoreDistribution: distribution(rows.map((row) => row.tailoredScore)),
    rows,
  }
  writeFileSync('/tmp/auto-apply-eligibility-diagnostic.json', JSON.stringify(report, null, 2))
  console.log(
    `Found ${report.found} · Eligible ${report.eligible} · Auto-apply capable ${report.autoApplyCapable} · Queued ${report.queued} · threshold ${report.threshold}`,
  )
  console.log(
    `Funnel discovered=${started.funnel?.discovered} keyword=${started.funnel?.afterKeywords} location=${started.funnel?.afterLocation} remote=${started.funnel?.afterRemote} employment=${started.funnel?.afterEmploymentType} duplicates=${started.funnel?.afterDuplicates} match=${started.funnel?.afterMatch} c2c=${started.funnel?.afterC2c} eligible=${started.funnel?.eligible} capable=${started.funnel?.autoApplyCapable} code=${started.funnel?.code}`,
  )
  console.log(
    `Campaign ${report.campaignStatus} · schedulerRunning=${report.schedulerRunning} · browserWorkerRunning=${report.browserWorkerRunning} · lastDiscovery=${report.lastDiscoveryAt} · nextDiscovery=${report.nextDiscoveryAt}`,
  )
  console.log('Job | Current Score | Tailored Score | Eligible? | Reason')
  for (const row of rows) {
    console.log(`${row.title} | ${row.currentScore} | ${row.tailoredScore} | ${row.eligible ? 'YES' : 'NO'} | ${row.reason ?? ''}`)
  }
  stopAgentScheduler()
}

main().catch((error) => {
  stopAgentScheduler()
  console.error(error)
  process.exit(1)
})
