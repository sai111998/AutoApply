import { createBrowserWorker, startEmbeddedWorker } from './worker'
import { startSyntheticEmployer } from './synthetic'
import { probeBrowserLaunch } from './runtime'

async function main() {
  const probe = await probeBrowserLaunch()
  if (!probe.ok) {
    console.error(`JobPilot browser worker could not launch Chromium: ${probe.reason}`)
    process.exitCode = 1
    return
  }
  if (process.argv.includes('--synthetic')) {
    const site = await startSyntheticEmployer()
    console.log(`Synthetic employer: ${site.jobUrl}`)
  }
  const worker = await createBrowserWorker({
    headless: process.env.JOBPILOT_BROWSER_HEADLESS !== '0',
    autoSubmit: process.env.JOBPILOT_AUTO_SUBMIT === '1',
  })
  await worker.start()
  console.log('JobPilot browser worker is running. Queue: existing Auto Apply jobs. Concurrency: 1.')
}

if (process.argv[1] && process.argv[1].includes('browser-worker')) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}

export { startEmbeddedWorker, createBrowserWorker }
