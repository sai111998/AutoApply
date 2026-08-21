# JobPilot AI

Job search cockpit for managing roles, resumes, and application status. This MVP helps you collect job descriptions, store resume versions, and route analysis through an external AI API. It does **not** auto-submit applications or drive a browser.

## What you can do in the MVP

- Sign in with Supabase Auth, or explore a labeled sample workspace
- Maintain a candidate profile, skills, and search preferences
- Upload PDF/DOCX resume versions and mark one as master
- Paste a job description and save it for analysis
- Review match results (sample previews or live API output)
- Track application status in a filterable table

## Stack

- React 19 + TypeScript + Vite
- Tailwind CSS 4
- React Router
- Supabase (Auth, PostgreSQL, Storage)
- Pluggable analysis client under `src/lib/ai`

## Local development

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open http://localhost:5173 and choose **Explore with sample data** to walk the full UI without credentials.

## Supabase setup

1. Create a project at [supabase.com](https://supabase.com).
2. Copy the project URL and anon key into `.env.local`:

```
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_ANON_KEY
```

3. Run `supabase/migrations/00001_init.sql` in the SQL editor. That script creates:

- `profiles`
- `resumes`
- `jobs`
- `job_matches`
- `applications`
- `skills`
- `user_preferences`

It also enables RLS, creates a profile/preferences row on signup, and adds a private `resumes` storage bucket.

## Connecting an analysis API later

JobPilot never invents production-looking scores in the browser. New analyses create a `job_matches` row with status `queued` / `unavailable` until a backend responds.

Set:

```
VITE_AI_API_URL=https://your-analyzer.example
```

The client POSTs to `{VITE_AI_API_URL}/v1/analyze`:

```json
{
  "job": {
    "title": "Senior Frontend Engineer",
    "company": "Acme",
    "location": "Remote (US)",
    "jobUrl": "https://...",
    "description": "..."
  },
  "candidate": {
    "profile": { "...": "..." },
    "skills": [{ "name": "TypeScript", "proficiency": "expert" }],
    "resume": { "id": "...", "versionLabel": "Master v4", "fileName": "resume.pdf" }
  }
}
```

Expected `200` body:

```json
{
  "overallScore": 84,
  "skillsMatched": [{ "name": "React" }],
  "skillsPartial": [{ "name": "GraphQL", "note": "Used in side projects" }],
  "skillsMissing": [{ "name": "Kotlin" }],
  "experienceMatch": { "score": 80, "summary": "..." },
  "educationMatch": { "score": 70, "summary": "..." },
  "locationMatch": { "score": 90, "summary": "..." },
  "workAuthorization": "Compatible; no sponsorship required.",
  "strengths": ["..."],
  "concerns": ["..."],
  "recommendation": "APPLY"
}
```

`202 Accepted` is treated as queued. Invalid payloads fail closed instead of filling in guessed scores.

Implementation:

- `src/lib/ai/client.ts` — selects HTTP vs pending client
- `src/lib/ai/http-client.ts` — fetch + contract validation
- `src/lib/ai/pending-client.ts` — default when no URL is set

Sample match records in demo mode are tagged `analysisSource: "sample"` and shown with a **Sample preview** banner.

## Scripts

| Command        | Purpose              |
| -------------- | -------------------- |
| `npm run dev`  | Vite dev server      |
| `npm run build`| Typecheck and bundle |
| `npm run preview` | Preview production build |

## Out of scope (for later)

- Automatic job submission
- Browser automation / form filling on career sites
- Parsing resume PDFs in the client
- Cover-letter generation
