# Deploying Hamdhi Web

The web app lives in [`web/`](../web) and is designed to be its own repository
so it can be hosted independently of the Python/Django/FastAPI integrations in
this repo.

## Option A — Separate GitHub repo (recommended)

You want the web app in its own repo, e.g. `hamdhi/hamdhi-web`.

**1. Create the repo on GitHub** (empty, no README).

**2. Push only the `web/` folder:**

```bash
# from the root of this repo
cd web
git init
git add .
git commit -m "Hamdhi Web — universal online OpenAPI UI"
git branch -M main
git remote add origin https://github.com/<you>/hamdhi-web.git
git push -u origin main
```

> The `web/` folder is self-contained: `index.html`, `server.js`, `api/`,
> `lib/`, `package.json`, `vercel.json`. Nothing outside it is required.

**3. Connect to Vercel**
- Go to <https://vercel.com/new> → import the `hamdhi-web` repo.
- Framework preset: **Other**. No build command. Output directory: `.`.
- Deploy.

Vercel auto-detects `api/spec.js` and `api/proxy.js` as serverless functions.

## Option B — Deploy from this repo (monorepo)

Keep everything in one repo and point Vercel at the `web/` directory:

- Vercel → Settings → Root Directory: `web`
- Framework preset: **Other**
- Build Command: *(leave empty)*
- Output Directory: *(leave empty)*

`web/vercel.json` already contains the rewrites and function config.

## Option C — Any other Node host

The app is a plain Node HTTP server with no framework:

```bash
cd web
npm install
PORT=3000 NODE_ENV=production node server.js
```

Put it behind nginx/Caddy, or use Railway / Render / Fly.io. Set
`NODE_ENV=production` so the SSRF guard blocks private targets.

## Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `HAMDHI_ALLOWED_ORIGINS` | Vercel → Settings → Environment Variables | Comma-separated origin allow-list. Empty = allow any public origin. |
| `HAMDHI_ALLOW_PRIVATE_TARGETS` | same | `1` allows `localhost` / private IPs. Off by default in production. |

Example allow-list:

```
HAMDHI_ALLOWED_ORIGINS=https://api.example.com,https://staging.example.com
```

## Verify the deployment

```bash
# health check
curl https://your-app.vercel.app/api/health

# spec fetch
curl "https://your-app.vercel.app/api/spec?url=https://petstore3.swagger.io/api/v3/openapi.json"

# proxy
curl -X POST https://your-app.vercel.app/api/proxy \
  -H "Content-Type: application/json" \
  -d '{"method":"GET","url":"https://petstore3.swagger.io/api/v3/pet/1"}'
```

Then open <https://your-app.vercel.app> in a browser, paste the spec URL, and
press **Load**.

## Custom domain

Vercel → Project → Settings → Domains → add your domain. The app is a
single-page app, so `vercel.json` rewrites every non-`/api/` path to
`index.html`. Shareable deep links work automatically:

```
https://your-app.vercel.app/?url=https://api.example.com/openapi.json
```
