/**
 * A deliberately tiny TOML reader: tables, keys and their raw values, nothing more. It exists
 * to answer questions about pyproject.toml ("is there a [tool.uv] table?", "which scripts are
 * declared?") without a dependency. Anything it does not understand makes it return null, and
 * callers treat null as "cannot tell".
 *
 * @typedef {object} Toml
 * @property {Map<string, Map<string, string>>} tables  Dotted table name → key → raw value text.
 *   Top-level keys live in the table named ''.
 */

/**
 * Remove a trailing `# comment`, honoring quotes.
 * @param {string} line
 * @returns {string}
 */
function stripComment(line) {
  let quote = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === '\\' && quote === '"') i++;
      else if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '#') return line.slice(0, i);
  }
  return line;
}

/**
 * Split a dotted name (`tool."my.tool".x`) into unquoted segments, or null if malformed.
 * @param {string} name
 * @returns {string[] | null}
 */
export function splitDotted(name) {
  const parts = [];
  let i = 0;
  while (i < name.length) {
    while (name[i] === ' ' || name[i] === '\t') i++;
    let seg = '';
    if (name[i] === '"' || name[i] === "'") {
      const q = name[i++];
      const end = name.indexOf(q, i);
      if (end === -1) return null;
      seg = name.slice(i, end);
      i = end + 1;
    } else {
      const m = /^[A-Za-z0-9_-]+/.exec(name.slice(i));
      if (!m) return null;
      seg = m[0];
      i += seg.length;
    }
    parts.push(seg);
    while (name[i] === ' ' || name[i] === '\t') i++;
    if (i < name.length) {
      if (name[i] !== '.') return null;
      i++;
    }
  }
  return parts.length ? parts : null;
}

/**
 * Net bracket depth change of a value fragment, ignoring brackets inside strings.
 * @param {string} s
 * @returns {number}
 */
function depthDelta(s) {
  let depth = 0;
  let quote = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === '\\' && quote === '"') i++;
      else if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') depth--;
  }
  return depth;
}

/**
 * @param {string} text
 * @returns {Toml | null}
 */
export function parseToml(text) {
  /** @type {Map<string, Map<string, string>>} */
  const tables = new Map([['', new Map()]]);
  let current = tables.get('');
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = stripComment(lines[i]).trim();
    if (!line) continue;

    const header = /^\[\[?([^\]]+)\]\]?$/.exec(line);
    if (header) {
      const parts = splitDotted(header[1]);
      if (!parts) return null;
      const name = parts.join('.');
      if (!tables.has(name)) tables.set(name, new Map());
      current = tables.get(name);
      continue;
    }

    const kv = /^("[^"]*"|'[^']*'|[A-Za-z0-9_-]+(?:\s*\.\s*(?:"[^"]*"|'[^']*'|[A-Za-z0-9_-]+))*)\s*=\s*(.*)$/.exec(line);
    if (!kv) return null;
    const keyParts = splitDotted(kv[1]);
    if (!keyParts) return null;
    let value = kv[2];

    if (/^("""|''')/.test(value)) {
      const delim = value.slice(0, 3);
      // The delimiter has no line break in it, so only the line just added can close the string.
      const parts = [value.slice(3)];
      let closed = parts[0].includes(delim);
      while (!closed) {
        if (++i >= lines.length) return null;
        parts.push(lines[i]);
        closed = lines[i].includes(delim);
      }
      value = `${delim}${parts.join('\n')}`;
    } else {
      let depth = depthDelta(value);
      while (depth > 0) {
        if (++i >= lines.length) return null;
        const more = stripComment(lines[i]).trim();
        value += ` ${more}`;
        depth += depthDelta(more);
      }
      if (depth < 0) return null;
    }
    current.set(keyParts.join('.'), value.trim());
  }
  return { tables };
}

/**
 * Names (first path segment) directly under table `name`: its keys plus its sub-tables.
 * `[tool.poe.tasks]` with `test = "pytest"` and `[tool.poe.tasks.lint]` gives `test`, `lint`.
 * @param {Toml} toml
 * @param {string} name
 * @returns {string[] | null}  null when the table does not exist.
 */
export function namesUnder(toml, name) {
  let exists = false;
  const out = new Set();
  for (const [table, keys] of toml.tables) {
    if (table === name) {
      exists = true;
      for (const k of keys.keys()) out.add(k.split('.')[0]);
    } else if (table.startsWith(`${name}.`)) {
      exists = true;
      out.add(table.slice(name.length + 1).split('.')[0]);
    }
  }
  return exists ? [...out].sort() : null;
}

/**
 * Keys of an inline table value `{ a = "x", b = "y" }`, or null if it is not one.
 * @param {string} raw
 * @returns {string[] | null}
 */
export function inlineTableKeys(raw) {
  const m = /^\{([\s\S]*)\}$/.exec(raw.trim());
  if (!m) return null;
  const keys = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  const body = m[1];
  const flush = (end) => {
    const piece = body.slice(start, end).trim();
    if (!piece) return;
    const eq = piece.indexOf('=');
    if (eq === -1) return;
    const parts = splitDotted(piece.slice(0, eq).trim());
    if (parts) keys.push(parts[0]);
  };
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quote) {
      if (c === '\\' && quote === '"') i++;
      else if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) {
      flush(i);
      start = i + 1;
    }
  }
  flush(body.length);
  return keys;
}
