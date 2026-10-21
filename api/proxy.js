'use strict';
/**
 * Vercel serverless function: ANY /api/proxy
 *
 * Replays an API request server-side so the browser is never subject to
 * CORS. The browser POSTs { method, url, headers, body }.
 */
const { handleProxy } = require('../lib/handlers');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    return res.status(204).end();
  }

  let payload = {};
  if (req.method === 'GET' || req.method === 'HEAD') {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    payload = { method: req.method, url: url.searchParams.get('url') || '', headers: {}, body: null };
  } else {
    const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      return res.status(400).json({ error: 'Invalid JSON body.' });
    }
  }

  const out = await handleProxy(payload);
  return res.status(out.status).json(out.json);
};
