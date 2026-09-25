/* Backend JSearch smoke test: one discovery call through the Live Jobs path. Prints counts only, never keys. */
import { getServerConfig } from '../server/config'
import { listLiveJobs } from '../server/jobs/list'
import { parseLiveJobsQuery } from '../server/jobs/parse'
import { createJobProviders, providerStatuses } from '../server/jobs/provider'

async function main() {
  const query = (process.argv[2] ?? process.env.JSEARCH_SMOKE_QUERY ?? '').trim()
  const location = (process.argv[3] ?? '').trim()
  if (!query) {
    console.error('Usage: npm run jobs:jsearch-smoke -- "<keywords>" [location]')
    process.exit(2)
  }
  const config = getServerConfig()
  const statuses = providerStatuses(createJobProviders(config))
  const jsearch = statuses.find((status) => status.name === 'jsearch')
  console.log(`JSearch configured: ${jsearch?.status === 'available' ? 'YES' : 'NO'} (status=${jsearch?.status ?? 'missing'})`)

  const result = await listLiveJobs(config, { ...parseLiveJobsQuery({ q: query, location }), includeSynthetic: false })
  console.log(`Aggregated jobs: ${result.jobs.length}`)
  for (const entry of result.diagnostics ?? []) {
    console.log(
      `${entry.provider}: raw=${entry.raw} normalized=${entry.normalized} duplicatesRemoved=${entry.duplicatesRemoved} ` +
        `usableApplicationUrls=${entry.usableApplicationUrls} kept=${entry.deduplicated}${entry.warning ? ` warning=${entry.warning}` : ''}`,
    )
  }
  const fromJsearch = result.jobs.filter((job) => job.discoveryProvider === 'jsearch').slice(0, 5)
  for (const job of fromJsearch) {
    const applyHost = job.applicationUrl ? new URL(job.applicationUrl).host : 'none'
    console.log(`  jsearch job: ${job.title} | ${job.company} | applicationProvider=${job.applicationProvider ?? 'unknown'} | apply host=${applyHost}`)
  }
}

main().catch((error) => {
  console.error('JSearch smoke test failed:', error instanceof Error ? error.message : error)
  process.exit(1)
})
