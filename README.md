# Hamdhi Web — Universal Online OpenAPI UI

Paste an OpenAPI URL. Test every endpoint. That's it.

This is the **standalone web version** of Hamdhi. It runs as a normal website
(Vercel, Netlify, any Node host) and needs nothing from your API — no CORS
configuration, no plugins, no code changes.

```
https://your-app.vercel.app
   ↓ paste
https://api.example.com/openapi.json
   ↓
every endpoint listed, fillable, executable
```

## Run it locally

```bash
npm install     # only dependency: yaml (optional, for YAML specs)
npm run dev     # → http://localhost:3000
```

That's it. Open <http://localhost:3000>, paste your OpenAPI URL, press **Load**.

## How it works

The browser cannot call arbitrary APIs directly — that's what CORS is for.
So Hamdhi Web runs a tiny **server-side proxy**:

| Endpoint | What it does |
|---|---|
| `GET /api/spec?url=...` | Downloads an OpenAPI document (JSON **or** YAML) and returns it as JSON. |
| `ANY /api/proxy` | Replays your API call from the server, so CORS never applies. |

The browser only ever talks to its own origin. Everything else goes through
the proxy.

```
Browser ──▶ /api/spec ──▶ api.example.com/openapi.json
Browser ──▶ /api/proxy ──▶ api.example.com/users/42
```

## Features

- OpenAPI 3.x and Swagger 2.0
- JSON **and** YAML specs
- Path / query / header / cookie parameters with example values
- Request body editor pre-filled from the schema
- Global JWT (Bearer) authorization, saved in your browser
- Copy-as-cURL for every request
- Response body with syntax highlighting + response headers + timing
- Screenshot evidence (PNG) of request + response
- 15 themes, keyboard navigation, endpoint search
- Shareable links: `https://your-app.vercel.app/?url=https://api.example.com/openapi.json`
- Works with APIs that have **no CORS headers at all**

## Deploy to Vercel

```bash
cd web
npx vercel          # preview
npx vercel --prod   # production
```

Or push the `web/` folder to GitHub and connect the repo in the Vercel
dashboard. Vercel detects `api/*.js` as serverless functions automatically —
no build command, no output directory, no configuration.

Full deployment guide (separate repo, monorepo, other Node hosts, custom
domains, env vars): [`DEPLOY.md`](./DEPLOY.md).

### Environment variables (optional)

| Variable | Default | Purpose |
|---|---|---|
| `HAMDHI_ALLOWED_ORIGINS` | *(empty = allow all)* | Comma-separated origin allow-list, e.g. `https://api.example.com`. |
| `HAMDHI_ALLOW_PRIVATE_TARGETS` | `0` in production | Set to `1` to allow `localhost` / private IPs. Off by default in production to prevent SSRF. |

## Security

Because the proxy fetches URLs that users supply, it is guarded against
**SSRF** (server-side request forgery):

- Redirects are followed manually and every hop is re-validated.
- Resolved DNS addresses are checked — loopback, link-local, cloud-metadata
  (`169.254.169.254`), and private ranges are blocked in production.
- `localhost` is blocked in production.
- Response bodies are capped at 8 MB.
- Requests time out after 30 seconds.

Use `HAMDHI_ALLOWED_ORIGINS` to restrict the proxy to your own APIs.

## Files

```
web/
├── index.html          the UI (single file, no build step)
├── server.js           local dev server (zero dependencies)
├── vercel.json         Vercel config
├── api/
│   ├── spec.js         serverless: GET /api/spec
│   └── proxy.js        serverless: ANY /api/proxy
└── lib/
    ├── handlers.js     shared handler logic
    ├── net.js          fetching, validation, SSRF guard
    └── yaml.js         YAML → JSON
```
