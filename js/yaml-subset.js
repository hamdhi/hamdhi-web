'use strict';
/**
 * YAML subset parser — UMD build so it works in Node AND in the browser.
 *
 * Covers the subset of YAML that OpenAPI documents actually use:
 * nested maps, lists, scalars, quoted strings and inline arrays/objects.
 *
 * Node:  const { parseSubset } = require('./yaml-subset');
 * Browser: <script src="js/yaml-subset.js"></script> -> window.HamdhiYaml.parseSubset
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HamdhiYaml = api;
})(typeof self !== 'undefined' ? self : this, function () {
  function parseScalar(raw) {
    const s = String(raw).trim();
    if (s === '' || s === '~' || s === 'null' || s === 'Null' || s === 'NULL') return null;
    if (s === 'true' || s === 'True' || s === 'TRUE') return true;
    if (s === 'false' || s === 'False' || s === 'FALSE') return false;
    if (/^-?\d+$/.test(s)) return parseInt(s, 10);
    if (/^-?\d*\.\d+(e[+-]?\d+)?$/i.test(s)) return parseFloat(s);
    if ((s.startsWith('"') && s.endsWith('"') && s.length > 1)) {
      try { return JSON.parse(s); } catch { return s.slice(1, -1); }
    }
    if (s.startsWith("'") && s.endsWith("'") && s.length > 1) return s.slice(1, -1).replace(/''/g, "'");
    if (s.startsWith('[') || s.startsWith('{')) {
      try { return JSON.parse(s.replace(/'/g, '"')); } catch { return s; }
    }
    return s;
  }

  /** Indentation based parser covering maps, lists and scalars. */
  function parseSubset(text) {
    const lines = [];
    for (const raw of String(text).split(/\r?\n/)) {
      if (!raw.trim() || raw.trim().startsWith('#')) continue;
      const indent = raw.match(/^\s*/)[0].length;
      lines.push({ indent, text: raw.trim() });
    }
    if (!lines.length) return {};

    let pos = 0;

    function parseBlock(minIndent) {
      // Decide map vs list from the first line at this level.
      const first = lines[pos];
      const isList = first.text.startsWith('- ') || first.text === '-';
      const container = isList ? [] : {};
      const baseIndent = first.indent;

      while (pos < lines.length) {
        const line = lines[pos];
        if (line.indent < baseIndent) break;
        if (line.indent > baseIndent) {
          // Unexpected deeper indent -> skip to avoid an infinite loop.
          pos++;
          continue;
        }
        if (isList !== (line.text.startsWith('- ') || line.text === '-')) break;

        if (isList) {
          const item = line.text === '-' ? '' : line.text.slice(2).trim();
          pos++;
          if (item === '') {
            container.push(pos < lines.length && lines[pos].indent > baseIndent ? parseBlock(baseIndent + 1) : null);
          } else if (/^[^:]+:\s*$/.test(item) || /^[^:]+:\s+/.test(item)) {
            // Inline map start inside a list item: "- name: x" (+ possible children)
            const obj = {};
            const m = item.match(/^([^:]+):\s*(.*)$/);
            const key = m[1].trim().replace(/^["']|["']$/g, '');
            const rest = m[2].trim();
            if (rest === '') {
              obj[key] = (pos < lines.length && lines[pos].indent > baseIndent) ? parseBlock(baseIndent + 1) : null;
            } else {
              obj[key] = parseScalar(rest);
            }
            // Extra keys of the same list item (indented deeper than the dash)
            while (pos < lines.length && lines[pos].indent > baseIndent) {
              const sub = lines[pos];
              const sm = sub.text.match(/^([^:]+):\s*(.*)$/);
              if (!sm) { pos++; continue; }
              const skey = sm[1].trim().replace(/^["']|["']$/g, '');
              const srest = sm[2].trim();
              const childIndent = sub.indent;
              pos++;
              if (srest === '') {
                obj[skey] = (pos < lines.length && lines[pos].indent > childIndent) ? parseBlock(childIndent + 1) : null;
              } else {
                obj[skey] = parseScalar(srest);
              }
            }
            container.push(obj);
          } else {
            container.push(parseScalar(item));
          }
          continue;
        }

        // Map entry
        const m = line.text.match(/^([^:]+):\s*(.*)$/);
        if (!m) { pos++; continue; }
        const key = m[1].trim().replace(/^["']|["']$/g, '');
        const rest = m[2].trim();
        pos++;
        if (rest === '') {
          container[key] = (pos < lines.length && lines[pos].indent > baseIndent) ? parseBlock(baseIndent + 1) : null;
        } else {
          container[key] = parseScalar(rest);
        }
      }
      return container;
    }

    return parseBlock(0);
  }

  /** Parse a YAML document; returns null when it cannot be parsed. */
  function parseYaml(text) {
    try {
      const yaml = parseSubset(text);
      return yaml && typeof yaml === 'object' ? yaml : null;
    } catch {
      return null;
    }
  }

  return { parseSubset: parseSubset, parseYaml: parseYaml, parseScalar: parseScalar };
});
