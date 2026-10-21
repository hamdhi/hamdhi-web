'use strict';
/**
 * Vercel serverless function: GET /api/spec?url=<openapi url>
 *
 * Fetches an OpenAPI document server-side so the browser never hits CORS,
 * and returns it as JSON (YAML specs are converted automatically).
 */
const { handleSpec } = require('../lib/handlers');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    return res.status(204).end();
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(405).json({ error: 'Use GET.' });
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const out = await handleSpec(url);
  return res.status(out.status).json(out.json);
};
