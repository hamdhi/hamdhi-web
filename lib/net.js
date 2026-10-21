'use strict';
/**
 * Shared target-fetching logic for the Hamdhi web app.
 * Used by BOTH the local dev server (server.js) and the Vercel
 * serverless functions (api/*.js) so both behave identically.
 */
const DNS = require('dns');
const { URL } = require('url');

const MAX_SPEC_BYTES = 8 * 1024 * 1024;   // 8 MB (specs are text)
const MAX_BODY_BYTES = 8 * 1024 * 1024;   // 8 MB (API responses)
const DEFAULT_TIMEOUT_MS = 30000;
const MAX_REDIRECTS = 4;

/* ------------------------------------------------------------------ *
 * Target validation (SSRF guard)
 * ------------------------------------------------------------------ */

function ipv4ToLong(ip) {
  return ip.split('.').reduce((acc, part) => ((acc << 8) + Number(part)) >>> 0, 0);
}

function isPrivateIPv4(ip) {
  const long = ipv4ToLong(ip);
  const inRange = (start, end) => long >= ipv4ToLong(start) && long <= ipv4ToLong(end);
  return inRange('0.0.0.0', '0.255.255.255')        // this-network
    || inRange('10.0.0.0', '10.255.255.255')        // private
    || inRange('100.64.0.0', '100.127.255.255')      // CGNAT
    || inRange('127.0.0.0', '127.255.255.255')       // loopback
    || inRange('169.254.0.0', '169.254.255.255')     // link-local + cloud metadata
    || inRange('172.16.0.0', '172.31.255.255')       // private
    || inRange('192.0.0.0', '192.0.0.255')
    || inRange('192.168.0.0', '192.168.255.255')     // private
    || inRange('198.18.0.0', '198.19.255.255')       // benchmarking
    || inRange('224.0.0.0', '239.255.255.255')       // multicast
    || inRange('240.0.0.0', '255.255.255.255');      // reserved
}

function isPrivateIPv6(ip) {
  const v = ip.toLowerCase().replace(/^\[|\]$/g, '');
  if (v === '::1' || v === '::') return true;
  if (v.startsWith('fe80') || v.startsWith('fc') || v.startsWith('fd')) return true;
  const m = v.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (m) return isPrivateIPv4(m[1]);
  return false;
}

/** Private targets are allowed locally (dev) but blocked in production. */
function allowPrivateTargets() {
  if (process.env.HAMDHI_ALLOW_PRIVATE_TARGETS === '1') return true;
  if (process.env.HAMDHI_ALLOW_PRIVATE_TARGETS === '0') return false;
  return process.env.NODE_ENV !== 'production';
}

/** Optional hard allow-list: comma separated origins, e.g. https://api.example.com */
function allowedOrigins() {
  const raw = process.env.HAMDHI_ALLOWED_ORIGINS || '';
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

function originOf(u) {
  try { return new URL(u).origin; } catch (e) { return ''; }
}

function checkAllowList(targetUrl) {
  const list = allowedOrigins();
  if (!list.length) return null;
  const o = originOf(targetUrl);
  if (!o) return 'Target URL is not valid.';
  const ok = list.some(a => {
    const allowed = a.replace(/\/$/, '');
    return allowed === '*' || o === allowed || o.startsWith(allowed + '/');
  });
  if (ok) return null;
  return 'Target origin "' + o + '" is not allowed. Allowed: ' + list.join(', ');
}

/** Resolve the hostname and reject private/internal IPs (SSRF protection). */
async function assertHostAllowed(hostname) {
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    if (!allowPrivateTargets()) throw new Error('Requests to localhost are blocked in production.');
    return;
  }
  let addresses = [];
  try {
    addresses = await DNS.promises.lookup(hostname, { all: true });
  } catch (e) {
    return; // DNS failure will surface as a normal fetch error
  }
  if (!allowPrivateTargets()) {
    for (const a of addresses) {
      const priv = a.family === 6 ? isPrivateIPv6(a.address) : isPrivateIPv4(a.address);
      if (priv) throw new Error('Blocked request to internal address (' + a.address + ').');
    }
  }
}

/** Parse + validate a user supplied target URL. Throws Error with a friendly message. */
async function parseTarget(rawUrl) {
  let u;
  try {
    u = new URL(String(rawUrl).trim());
  } catch (e) {
    throw new Error('"' + rawUrl + '" is not a valid URL. Include the full http(s) address.');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('Unsupported protocol "' + u.protocol + '". Only http and https are allowed.');
  }
  const allowErr = checkAllowList(u.href);
  if (allowErr) throw new Error(allowErr);
  await assertHostAllowed(u.hostname);
  return u;
}

/* ------------------------------------------------------------------ *
 * Fetching
 * ------------------------------------------------------------------ */

function withTimeout(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

/**
 * Fetch a target following redirects manually so every hop is re-validated.
 * Returns { response, finalUrl }.
 */
async function fetchTarget(targetUrl, options) {
  const opts = options || {};
  const method = opts.method || 'GET';
  const headers = opts.headers || {};
  const body = opts.body == null ? null : opts.body;
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  const maxBytes = opts.maxBytes || MAX_BODY_BYTES;

  let current = await parseTarget(targetUrl);
  let redirects = 0;

  for (;;) {
    const t = withTimeout(timeoutMs);
    let resp;
    try {
      resp = await fetch(current.href, {
        method: method,
        headers: headers,
        body: (method === 'GET' || method === 'HEAD') ? undefined : body,
        redirect: 'manual',
        signal: t.signal,
      });
    } catch (err) {
      t.done();
      if (err && err.name === 'AbortError') {
        throw new Error('Request to ' + current.href + ' timed out after ' + timeoutMs + 'ms.');
      }
      throw new Error('Could not reach ' + current.href + ' - ' + (err && err.message ? err.message : 'network error') + '.');
    }
    t.done();

    const location = resp.headers.get('location');
    const isRedirect = resp.status >= 300 && resp.status < 400 && location;
    if (!isRedirect) return { response: resp, finalUrl: current.href };

    if (++redirects > MAX_REDIRECTS) throw new Error('Too many redirects.');
    const next = new URL(location, current.href);
    await parseTarget(next.href); // re-validate the new hop
    current = next;
  }
}

/** Read a response body as text, capped at maxBytes. */
async function readText(resp, maxBytes) {
  const limit = maxBytes || MAX_BODY_BYTES;
  const buf = Buffer.from(await resp.arrayBuffer());
  const slice = buf.length > limit ? buf.subarray(0, limit) : buf;
  return {
    text: slice.toString('utf8'),
    truncated: buf.length > limit,
    bytes: buf.length,
  };
}

module.exports = {
  MAX_SPEC_BYTES: MAX_SPEC_BYTES,
  MAX_BODY_BYTES: MAX_BODY_BYTES,
  DEFAULT_TIMEOUT_MS: DEFAULT_TIMEOUT_MS,
  parseTarget: parseTarget,
  fetchTarget: fetchTarget,
  readText: readText,
  allowPrivateTargets: allowPrivateTargets,
  allowedOrigins: allowedOrigins,
  originOf: originOf,
};
