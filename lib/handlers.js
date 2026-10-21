'use strict';
/**
 * Request handlers shared by the local dev server (server.js) and the
 * Vercel serverless functions (api/spec.js, api/proxy.js).
 *
 * Two endpoints power the whole web app:
 *   GET  /api/spec?url=<openapi url>   -> fetch an OpenAPI spec (JSON or YAML)
 *   ANY  /api/proxy                    -> replay an API call without CORS limits
 */
const { fetchTarget, readText, MAX_SPEC_BYTES, MAX_BODY_BYTES } = require('./net');
const { parseYaml } = require('./yaml');

/** Strip hop-by-hop / browser-forbidden headers before forwarding. */
const BLOCKED_REQUEST_HEADERS = new Set([
  'host', 'connection', 'content-length', 'transfer-encoding', 'upgrade',
  'proxy-authenticate', 'proxy-authorization', 'te', 'trailer',
  'cookie', 'origin', 'referer', 'sec-fetch-mode', 'sec-fetch-site',
  'sec-fetch-dest', 'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform',
]);

/** Response headers we never echo back to the browser. */
const BLOCKED_RESPONSE_HEADERS = new Set([
  'content-encoding', 'content-length', 'transfer-encoding', 'connection',
  'set-cookie', 'access-control-allow-origin', 'access-control-allow-credentials',
  'access-control-allow-headers', 'access-control-allow-methods',
  'access-control-expose-headers', 'access-control-max-age',
]);

function sanitizeRequestHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers || {})) {
    const key = String(k).toLowerCase();
    if (BLOCKED_REQUEST_HEADERS.has(key)) continue;
    if (key.startsWith('sec-')) continue;
    const val = Array.isArray(v) ? v.join(', ') : String(v);
    if (!val) continue;
    out[key] = val;
  }
  return out;
}

function sanitizeResponseHeaders(headers) {
  const out = {};
  if (!headers) return out;
  headers.forEach((v, k) => {
    const key = String(k).toLowerCase();
    if (BLOCKED_RESPONSE_HEADERS.has(key)) return;
    out[key] = v;
  });
  return out;
}

/* ------------------------------------------------------------------ *
 * GET /api/spec?url=...
 * ------------------------------------------------------------------ */

function looksLikeSpec(json) {
  if (!json || typeof json !== 'object') return false;
  if (json.openapi || json.swagger) return true;
  if (json.paths && typeof json.paths === 'object' && Object.keys(json.paths).length) return true;
  return false;
}

/**
 * Fetch an OpenAPI document and return it as JSON.
 * Handles JSON specs, YAML specs, and specs served behind auth (via ?auth=).
 */
async function handleSpec(url, options = {}) {
  if (!url) {
    return { status: 400, json: { error: 'Missing "url" query parameter.' } };
  }

  const headers = { Accept: 'application/json, application/yaml, text/yaml, text/plain, */*' };
  const auth = options.authHeader || url.searchParams.get('auth');
  if (auth) headers.Authorization = auth;

  const target = url.searchParams.get('url');
  let result;
  try {
    result = await fetchTarget(target, { method: 'GET', headers: headers, maxBytes: MAX_SPEC_BYTES });
  } catch (err) {
    return { status: 502, json: { error: err.message, url: target } };
  }

  const resp = result.response;
  const read = await readText(resp, MAX_SPEC_BYTES);

  if (!resp.ok) {
    return {
      status: 502,
      json: {
        error: 'The spec server returned HTTP ' + resp.status + ' ' + (resp.statusText || ''),
        url: result.finalUrl,
        status: resp.status,
        body: read.text.slice(0, 2000),
      },
    };
  }

  let spec = null;
  try {
    spec = JSON.parse(read.text);
  } catch (err) {
    const yamlSpec = parseYaml(read.text);
    if (yamlSpec && typeof yamlSpec === 'object') spec = yamlSpec;
  }

  if (!spec || typeof spec !== 'object') {
    return {
      status: 502,
      json: {
        error: 'The response was neither valid JSON nor valid YAML.',
        url: result.finalUrl,
        body: read.text.slice(0, 2000),
      },
    };
  }

  if (!looksLikeSpec(spec)) {
    return {
      status: 502,
      json: {
        error: 'The document is JSON/YAML but not an OpenAPI spec (missing openapi/swagger/paths).',
        url: result.finalUrl,
        body: read.text.slice(0, 2000),
      },
    };
  }

  return {
    status: 200,
    json: {
      spec: spec,
      url: result.finalUrl,
      truncated: read.truncated,
      contentType: resp.headers.get('content-type') || '',
    },
  };
}

/* ------------------------------------------------------------------ *
 * ANY /api/proxy
 * ------------------------------------------------------------------ */

/**
 * Replay an API request server-side so the browser never hits CORS.
 * The browser POSTs { method, url, headers, body } to /api/proxy.
 */
async function handleProxy(payload) {
  if (!payload || typeof payload !== 'object') {
    return { status: 400, json: { error: 'Invalid JSON body.' } };
  }
  const method = String(payload.method || 'GET').toUpperCase();
  const target = payload.url;
  if (!target) {
    return { status: 400, json: { error: 'Missing "url" in request body.' } };
  }

  const headers = sanitizeRequestHeaders(payload.headers);
  let body = null;
  if (['GET', 'HEAD'].indexOf(method) === -1 && payload.body != null && payload.body !== '') {
    body = typeof payload.body === 'string' ? payload.body : JSON.stringify(payload.body);
    if (!headers['content-type']) headers['content-type'] = 'application/json';
  }

  const startedAt = Date.now();
  let result;
  try {
    result = await fetchTarget(target, { method: method, headers: headers, body: body, maxBytes: MAX_BODY_BYTES });
  } catch (err) {
    return { status: 502, json: { error: err.message, url: target } };
  }

  const resp = result.response;
  const read = await readText(resp, MAX_BODY_BYTES);

  return {
    status: 200,
    json: {
      status: resp.status,
      statusText: resp.statusText || '',
      ok: resp.status >= 200 && resp.status < 300,
      headers: sanitizeResponseHeaders(resp.headers),
      body: read.text,
      truncated: read.truncated,
      bytes: read.bytes,
      finalUrl: result.finalUrl,
      ms: Date.now() - startedAt,
    },
  };
}

module.exports = {
  handleSpec: handleSpec,
  handleProxy: handleProxy,
  sanitizeRequestHeaders: sanitizeRequestHeaders,
  sanitizeResponseHeaders: sanitizeResponseHeaders,
  MAX_SPEC_BYTES: MAX_SPEC_BYTES,
  MAX_BODY_BYTES: MAX_BODY_BYTES,
};
