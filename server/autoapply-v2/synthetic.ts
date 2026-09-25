import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

const CONFIRMATION_ID = 'TEST-12345'

function sendHtml(res: ServerResponse, html: string, status = 200) {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' })
  res.end(html)
}

function consumeBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', () => resolve(Buffer.concat(chunks)))
  })
}

function jobPage(): string {
  return `<!doctype html><html><head><title>Senior Engineer - V2 Test Employer</title></head><body>
<main><h1>Senior Engineer</h1><p>V2 Test Employer · Remote</p>
<h2>Job Description</h2><p>Build reliable automation. Responsibilities include shipping quality software.</p>
<h2>Qualifications</h2><p>5+ years of experience.</p>
<a href="/test-employer/job/1/apply?step=1">Apply Now</a>
</main></body></html>`
}

function step1Page(): string {
  return `<!doctype html><html><head><title>Application - Step 1</title></head><body>
<main><h1>Job Application - Step 1</h1>
<form method="POST" action="/test-employer/job/1/apply?step=2">
<label for="firstName">First Name *</label><input id="firstName" name="firstName" type="text" required />
<label for="lastName">Last Name *</label><input id="lastName" name="lastName" type="text" required />
<label for="email">Email *</label><input id="email" name="email" type="email" required />
<label for="phone">Phone *</label><input id="phone" name="phone" type="tel" required />
<label for="workAuth">Are you authorized to work in the US?</label>
<select id="workAuth" name="workAuth"><option value="yes" selected>Yes</option><option value="no">No</option></select>
<label for="sponsorship">Will you require sponsorship?</label>
<select id="sponsorship" name="sponsorship"><option value="no" selected>No</option><option value="yes">Yes</option></select>
<button type="submit">Next</button>
</form></main></body></html>`
}

function step2Page(): string {
  return `<!doctype html><html><head><title>Application - Step 2</title></head><body>
<main><h1>Job Application - Step 2</h1>
<form method="POST" action="/test-employer/job/1/apply?step=review" enctype="multipart/form-data">
<label for="resume">Upload Resume *</label><input id="resume" name="resume" type="file" accept=".txt,.pdf,.doc,.docx" required />
<p id="resumeName" aria-live="polite"></p>
<label for="veteran">Veteran status</label>
<select id="veteran" name="veteran"><option value="no-answer" selected>Prefer not to answer</option><option value="yes">Yes</option><option value="no">No</option></select>
<button type="submit">Continue</button>
</form>
<script>
document.getElementById('resume').addEventListener('change', (event) => {
  const file = event.target.files && event.target.files[0]
  document.getElementById('resumeName').textContent = file ? 'Selected: ' + file.name : ''
})
</script>
</main></body></html>`
}

function reviewPage(): string {
  return `<!doctype html><html><head><title>Application - Review</title></head><body>
<main><h1>Review Your Application</h1>
<p>Please review your information before submitting.</p>
<ul><li>Contact details complete</li><li>Resume attached</li></ul>
<form method="POST" action="/test-employer/job/1/apply?step=done">
<button type="submit">Submit Application</button>
</form></main></body></html>`
}

function donePage(): string {
  return `<!doctype html><html><head><title>Application Submitted</title></head><body>
<main><h1>Application Submitted</h1>
<p>Thank you for applying. Your application has been received.</p>
<p>Confirmation ID: ${CONFIRMATION_ID}</p>
</main></body></html>`
}

export interface V2SyntheticEmployer {
  baseUrl: string
  jobUrl: string
  confirmationId: string
  close: () => Promise<void>
}

export async function startV2SyntheticEmployer(): Promise<V2SyntheticEmployer> {
  const server: Server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (req.method === 'GET' && url.pathname === '/test-employer/job/1') {
        sendHtml(res, jobPage())
        return
      }
      if (url.pathname === '/test-employer/job/1/apply') {
        const step = url.searchParams.get('step')
        if (req.method === 'GET' && step === '1') {
          sendHtml(res, step1Page())
          return
        }
        if (req.method === 'POST' && step === '2') {
          await consumeBody(req)
          sendHtml(res, step2Page())
          return
        }
        if (req.method === 'POST' && step === 'review') {
          await consumeBody(req)
          sendHtml(res, reviewPage())
          return
        }
        if (req.method === 'POST' && step === 'done') {
          await consumeBody(req)
          sendHtml(res, donePage())
          return
        }
      }
      sendHtml(res, '<h1>Not found</h1>', 404)
    } catch {
      sendHtml(res, '<h1>Employer error</h1>', 500)
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  const baseUrl = `http://127.0.0.1:${port}`
  return {
    baseUrl,
    jobUrl: `${baseUrl}/test-employer/job/1`,
    confirmationId: CONFIRMATION_ID,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}
