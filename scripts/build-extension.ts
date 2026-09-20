import { mkdir, copyFile, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, 'dist', 'extension')

await mkdir(outDir, { recursive: true })

await build({
  absWorkingDir: root,
  entryPoints: {
    background: path.join(root, 'extension/src/background/index.ts'),
    content: path.join(root, 'extension/src/content/index.ts'),
    popup: path.join(root, 'extension/src/popup/popup.ts'),
    bridge: path.join(root, 'extension/src/bridge/index.ts'),
  },
  outdir: outDir,
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome114'],
  logLevel: 'info',
})

const popupHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>JobPilot Detection</title>
    <link rel="stylesheet" href="popup.css" />
  </head>
  <body>
    <main>
      <h1>JobPilot Detection</h1>
      <p class="note">Development inspector only. This extension does not submit applications.</p>
      <p><button type="button" id="process">Process queued application</button></p>
      <dl>
        <div><dt>Current URL</dt><dd id="url">Inspecting…</dd></div>
        <div><dt>Page title</dt><dd id="title">—</dd></div>
        <div><dt>Detected provider</dt><dd id="provider">—</dd></div>
        <div><dt>Application confidence</dt><dd id="confidence">—</dd></div>
        <div><dt>Application page</dt><dd id="application">—</dd></div>
        <div><dt>Detected fields</dt><dd id="fields">—</dd></div>
        <div><dt>Detected buttons</dt><dd id="buttons">—</dd></div>
        <div><dt>CAPTCHA</dt><dd id="captcha">—</dd></div>
        <div><dt>MFA</dt><dd id="mfa">—</dd></div>
        <div><dt>Login</dt><dd id="login">—</dd></div>
        <div><dt>Session</dt><dd id="session">—</dd></div>
      </dl>
    </main>
    <script src="popup.js"></script>
  </body>
</html>
`

await writeFile(path.join(outDir, 'popup.html'), popupHtml)
await copyFile(path.join(root, 'extension/src/popup/popup.css'), path.join(outDir, 'popup.css'))
await copyFile(path.join(root, 'extension/manifest.json'), path.join(outDir, 'manifest.json'))

const manifest = JSON.parse(await readFile(path.join(outDir, 'manifest.json'), 'utf8')) as { manifest_version?: number }
if (manifest.manifest_version !== 3) {
  throw new Error('Extension manifest must be Manifest V3.')
}

console.log(`Extension written to ${outDir}`)
