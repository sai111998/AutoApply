# JobPilot Chrome Extension

Manifest V3 foundation for detecting employer application pages in the user's Chrome browser. It does **not** submit applications, bypass CAPTCHA/MFA/login, or store employer passwords.

## Build

From the repository root:

```bash
npm run build:extension
```

The unpacked extension is written to `dist/extension`.

`npm run build` also builds the extension after the web app.

## Load in Chrome

1. Open Chrome
2. Go to `chrome://extensions`
3. Turn on **Developer mode**
4. Click **Load unpacked**
5. Select `dist/extension`

## Local test page

Start the JobPilot API (`npm run dev` or the API on port 8787), then open:

http://127.0.0.1:8787/extension/test/application.html

The development popup shows URL, title, provider, confidence, fields, buttons, CAPTCHA, MFA, and login.

## Backend

The extension calls authenticated JobPilot APIs only:

- `GET /api/extension/context`
- `GET /api/extension/job`
- `GET /api/extension/profile`
- `GET /api/extension/questions`
- `GET /api/extension/resume`
- `POST /api/extension/sessions`

Send `x-jobpilot-user-id` or `userId`. The extension never receives `SUPABASE_SERVICE_ROLE_KEY` or other server secrets.
