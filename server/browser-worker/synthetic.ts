import { createServer, type Server } from 'node:http'

const JOB_PAGE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Software Engineer Job Details</title></head>
  <body>
    <h1>Software Engineer</h1>
    <p>Job Description</p>
    <p>Job Identification 210786459</p>
    <p>Posting Date January 1</p>
    <a href="/browser-worker/synthetic/apply">Apply Now</a>
  </body>
</html>`

const APPLY_PAGE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>JobPilot Synthetic Application</title></head>
  <body>
    <form id="application-form" action="/browser-worker/synthetic/submit" method="post">
      <section id="step-1">
        <h1>Job application form</h1>
        <label for="first-name">First Name</label>
        <input id="first-name" name="first_name" autocomplete="given-name" />
        <label for="last-name">Last Name</label>
        <input id="last-name" name="last_name" autocomplete="family-name" />
        <label for="email">Email</label>
        <input id="email" type="email" name="email" autocomplete="email" />
        <label for="phone">Phone</label>
        <input id="phone" type="tel" name="phone" autocomplete="tel" />
        <label for="address">Address</label>
        <input id="address" name="address" autocomplete="street-address" />
        <label for="city">City</label>
        <input id="city" name="city" autocomplete="address-level2" />
        <label for="resume">Upload Resume</label>
        <input id="resume" type="file" name="resume" aria-label="Upload Resume" />
        <button type="button" id="next-btn">Next</button>
      </section>
      <section id="step-2" hidden>
        <h1>More information</h1>
        <label for="linkedin">LinkedIn</label>
        <input id="linkedin" name="linkedin" />
        <label for="work-auth">Are you legally authorized to work in the United States?</label>
        <select id="work-auth" name="work_authorization">
          <option value="">Select</option>
          <option value="Yes">Yes</option>
          <option value="No">No</option>
        </select>
        <button type="button" id="continue-btn">Continue</button>
      </section>
      <section id="step-3" hidden>
        <h1>Review</h1>
        <p>Review your application before submitting.</p>
        <button type="submit" id="submit-btn">Submit Application</button>
      </section>
    </form>
    <script>
      document.getElementById('next-btn').addEventListener('click', function () {
        document.getElementById('step-1').hidden = true
        document.getElementById('step-2').hidden = false
      })
      document.getElementById('continue-btn').addEventListener('click', function () {
        document.getElementById('step-2').hidden = true
        document.getElementById('step-3').hidden = false
      })
    </script>
  </body>
</html>`

const CONFIRM_PAGE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Application submitted</title></head>
  <body>
    <h1>Thank you for applying</h1>
    <p>Your application was submitted.</p>
    <p>Confirmation number ABC12345</p>
  </body>
</html>`

export function syntheticEmployerHtml(kind: 'job' | 'apply' | 'confirm'): string {
  if (kind === 'job') return JOB_PAGE
  if (kind === 'confirm') return CONFIRM_PAGE
  return APPLY_PAGE
}

export function startSyntheticEmployer(port = 0): Promise<{
  server: Server
  port: number
  jobUrl: string
  applyUrl: string
  close: () => Promise<void>
}> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const url = req.url || '/'
      if (url.startsWith('/browser-worker/synthetic/submit')) {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(CONFIRM_PAGE)
        return
      }
      if (url.startsWith('/browser-worker/synthetic/apply') || url.startsWith('/extension/test/application')) {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(APPLY_PAGE)
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(JOB_PAGE)
    })
    server.listen(port, '127.0.0.1', () => {
      const address = server.address()
      const resolvedPort = typeof address === 'object' && address ? address.port : port
      resolve({
        server,
        port: resolvedPort,
        jobUrl: `http://127.0.0.1:${resolvedPort}/browser-worker/synthetic/job`,
        applyUrl: `http://127.0.0.1:${resolvedPort}/browser-worker/synthetic/apply`,
        close: () =>
          new Promise((done, reject) => {
            server.close((error) => (error ? reject(error) : done()))
          }),
      })
    })
  })
}
