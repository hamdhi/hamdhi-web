'use strict';
/**
 * YAML -> JSON helper (Node side).
 *
 * If the optional `yaml` package is installed we use it (it is a dependency
 * of the web app). Otherwise we fall back to the shared indentation based
 * parser in ../js/yaml-subset.js, which covers the subset of YAML that
 * OpenAPI documents actually use: nested maps, lists, scalars, quoted strings
 * and inline arrays/objects.
 *
 * The same fallback parser is shipped to the browser as js/yaml-subset.js so
 * the UI can parse YAML specs even on hosts without a server runtime.
 */
const { parseSubset, parseScalar, parseYaml: parseYamlSubset } = require('../js/yaml-subset');

/** Parse a YAML document into a JS object. Returns null when unparseable. */
function parseYaml(text) {
  try {
    const YAML = require('yaml');
    const parsed = YAML.parse(text);
    if (parsed !== undefined) return parsed;
  } catch (err) {
    if (err && err.code !== 'MODULE_NOT_FOUND') {
      // The package exists but failed to parse -> fall through to fallback.
    }
  }
  try {
    return parseYamlSubset(text);
  } catch {
    return null;
  }
}

module.exports = { parseYaml: parseYaml, parseSubset: parseSubset, parseScalar: parseScalar };
