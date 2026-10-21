'use strict';
/**
 * Hamdhi web app — local development server.
 *
 * Zero dependencies (Node's built-in http module only) so `npm run dev`
 * works immediately after cloning, with no install step.
 *
 * It serves:
 *   /            -> web/index.html
 *   /api/spec    -> OpenAPI spec fetcher (CORS-safe)
 *   /api/proxy   -> API request proxy (CORS-safe)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { handleSpec, handleProxy } = require('./lib/handlers');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const ROOT = __dirname;

/** Files that must never be served over HTTP (server-side code + config). */
const PRIVATE_PREFIXES = ['api/', 'lib/'];
const PRIVATE_FILES = ['server.js', 'package.json', 'package-lock.json', 'vercel.json', '.env'];

function isPrivate(relPath) {
  const p = relPath.replace(/\\/g, '/');
  if (PRIVATE_FILES.includes(p)) return true;
  return PRIVATE_PREFIXES.some(prefix => p.startsWith(prefix));
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.yaml': 'text/yaml; charset=utf-8',
  '.yml': 'text/yaml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req, limitBytes = 16 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limitBytes) {
        reject(new Error('Request body too large.'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  if (isPrivate(rel)) {
    res.writeHead(404).end('Not found');
    return;
  }
  const filePath = path.join(ROOT, rel);
  // Prevent path traversal outside the web folder.
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA fallback so any deep link still renders the app.
      fs.readFile(path.join(ROOT, 'index.html'), (e2, html) => {
        if (e2) { res.writeHead(404).end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME['.html'] }).end(html);
      });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    }).end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const { pathname } = url;

  try {
    if (pathname === '/api/spec') {
      const out = await handleSpec(url);
      return sendJson(res, out.status, out.json);
    }

    if (pathname === '/api/proxy') {
      let payload = null;
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        const raw = await readBody(req);
        try {
          payload = raw ? JSON.parse(raw) : {};
        } catch {
          return sendJson(res, 400, { error: 'Invalid JSON body.' });
        }
      } else {
        payload = {
          method: req.method,
          url: url.searchParams.get('url') || '',
          headers: {},
          body: null,
        };
      }
      const out = await handleProxy(payload);
      return sendJson(res, out.status, out.json);
    }

    if (pathname === '/api/health') {
      return sendJson(res, 200, { ok: true, app: 'hamdhi-web', time: new Date().toISOString() });
    }

    return serveStatic(req, res, pathname);
  } catch (err) {
    return sendJson(res, 500, { error: err && err.message ? err.message : 'Internal error' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n  Hamdhi web app running`);
  console.log(`  ➜  http://localhost:${PORT}\n`);
  console.log(`  Paste any OpenAPI JSON URL at the top of the page and press "Load URL".\n`);
});
