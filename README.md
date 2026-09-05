# JobPilot AI

Job search cockpit for managing roles, resumes, and application status. This MVP analyzes a job description against resume text through a **server-side LLM**. It does **not** auto-submit applications or drive a browser.

## Local development

```bash
cp .env.example .env.local
# set LLM_API_KEY in .env.local (see below)
npm install
npm run dev
npm test
```

`npm run dev` starts:

- Vite on http://localhost:5173/
- the analysis API on http://127.0.0.1:8787/ (`POST /api/jobs/analyze`)

Open http://localhost:5173/ to view the public landing page. Click **Get Started** or **Sign In**, then **Explore with sample data**. After sign-in, the workspace lives at `/dashboard`. Job Analysis is under **Job Analysis**. Demo mode pre-fills Alex Rivera’s sample resume text.

## LLM API key (required for live analysis)

The model key **must stay on the server**. Do not put it in any `VITE_` variable or frontend file.

In `.env.local`:

```
LLM_API_KEY=sk-your-key
LLM_API_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini
```

`LLM_API_BASE_URL` should be an OpenAI-compatible Chat Completions root. Examples:

- OpenAI: `https://api.openai.com/v1`
- Groq: `https://api.groq.com/openai/v1`

The API reads `LLM_API_KEY` from `.env` / `.env.local` only. `GET /api/health` reports `llmConfigured: true/false` and never returns the key.

Without `LLM_API_KEY`, the app still runs. Analyze returns `503` and Match Results shows the error — no fake score is invented.

## PostgreSQL storage

When Supabase is configured, profiles, resumes, jobs, matches, and applications persist in Postgres. Analysis results are also written to `jobs` and `job_matches`.

```
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_ANON_KEY
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
```

Apply the initial schema once (idempotent):

1. Open the Supabase SQL Editor.
2. Paste and run `supabase/migrations/001_initial_schema.sql`.
3. Confirm tables under **Table Editor**, the private `resumes` bucket under **Storage**, and `on_auth_user_created` under **Database → Triggers**.

Or, with a personal access token from https://supabase.com/dashboard/account/tokens in `SUPABASE_ACCESS_TOKEN`:

```
npm run db:apply
npm run db:auth-flow
```

`SUPABASE_SERVICE_ROLE_KEY` is server-only. Never prefix it with `VITE_`. For local sign-up testing, turn off **Confirm email** under Authentication → Providers → Email.

## Analysis contract

`POST /api/jobs/analyze`

```json
{
  "jobDescription": "...",
  "resumeText": "..."
}
```

Both fields are required and rejected if empty or whitespace.

```json
{
  "matchScore": 0,
  "recommendation": "APPLY | REVIEW | SKIP",
  "matchedSkills": [],
  "partiallyMatchedSkills": [],
  "missingSkills": [],
  "experienceMatch": true,
  "educationMatch": true,
  "locationMatch": true,
  "strengths": [],
  "concerns": [],
  "summary": ""
}
```

The model is instructed to use **only** the supplied resume text. It must not invent jobs, employers, degrees, or skills.

## Data flow

1. Job Analysis UI collects the posting and resume text.
2. The browser POSTs JSON to `/api/jobs/analyze` (Vite proxies to port 8787).
3. `server/services/analysis.ts` validates the body.
4. `server/services/llm.ts` calls the LLM with a system prompt that forbids invented experience.
5. The structured JSON is parsed, stored in Postgres when configured, and returned.
6. Match Results maps that payload into score, skills, Yes/No dimensions, summary, strengths, and concerns.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | API + Vite |
| `npm test` | Backend analysis service and API tests |
| `npm run build` | Typecheck and frontend bundle |
| `npm run lint` | ESLint |
| `npm run db:apply` | Apply `001_initial_schema.sql` to the linked Supabase project |
| `npm run db:auth-flow` | Sign up → login → create/read/update profile against live Supabase |

## Out of scope

- Automatic job submission
- Browser automation
- Parsing PDF/DOCX bytes in the browser (paste resume text, or use demo parsed text)
