import { blank, hasPlaceholder, makeClaim } from './util.js';

const KNOWN_EXT = new Set([
  'md', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'json', 'yml', 'yaml', 'toml',
  'py', 'sh', 'txt', 'lock', 'css', 'html', 'svg', 'rs', 'go', 'rb',
]);

/** Prose that happens to contain a slash. */
const NOT_PATHS = new Set([
  'and/or', 'or/and', 'i/o', 'ci/cd', 'w/o', 'n/a', 'yes/no', 'true/false',
  'on/off', 'read/write', 'input/output', 'either/or', 'tcp/ip', 'client/server',
]);

const URL_LIKE = /^(?:[a-z][a-z0-9+.-]*:\/\/|mailto:|tel:|data:)/i;
const GLOB_CHARS = /[*?[\]{}]/;
/** `@types/node`, `@scope/pkg`: an npm package name, not an import. */
const PACKAGE_SPEC = /^@[\w.-]+\/[\w.-]+$/;

/**
 * Does this string look like a file or directory path we can check against the tree?
 * Conservative on purpose: when unsure, say no.
 * @param {string} s
 * @param {{ isImport?: boolean }} [opts]
 * @returns {boolean}
 */
export function looksLikePath(s, { isImport = false } = {}) {
  if (!s || /\s/.test(s) || s.startsWith('-') || s.startsWith('#')) return false;
  if (URL_LIKE.test(s) || hasPlaceholder(s) || GLOB_CHARS.test(s)) return false;
  if (!/[A-Za-z]/.test(s) || s.includes('//')) return false;
  const bare = s.replace(/:\d+(?::\d+)?$/, '');
  const ext = extensionOf(bare);
  if (bare.includes('/')) {
    if (NOT_PATHS.has(bare.toLowerCase())) return false;
    // `/init`, `/help`: Claude Code slash commands.
    if (/^\/[\w-]+$/.test(bare) && !ext) return false;
    if (!isImport && PACKAGE_SPEC.test(bare) && !ext) return false;
    return true;
  }
  if (!ext) return false;
  const base = bare;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(base)) return false;
  // `Node.js`, `Next.js`: product names, not files.
  if ((ext === 'js' || ext === 'ts') && /^[A-Z]/.test(base) && !/^[A-Z0-9_-]+\.(js|ts)$/.test(base)) {
    return false;
  }
  return true;
}

/**
 * @param {string} s
 * @returns {string | null} lowercase extension if it is one we know
 */
function extensionOf(s) {
  const base = s.slice(s.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return null;
  const ext = base.slice(dot + 1).toLowerCase();
  return KNOWN_EXT.has(ext) ? ext : null;
}

/**
 * Remove a trailing `:12` or `:12:3` line reference.
 * @param {string} s
 * @returns {string}
 */
export function stripLineRef(s) {
  return s.replace(/:\d+(?::\d+)?$/, '');
}

/**
 * @typedef {object} CodeSpan
 * @property {number} start       Index of the opening backtick.
 * @property {number} end         Index after the closing backtick.
 * @property {string} content     Trimmed content.
 * @property {number} col         1-based column of `content`.
 * @property {string} raw         Span including backticks.
 */

/**
 * Single-line inline code spans.
 * @param {string} line
 * @returns {CodeSpan[]}
 */
export function codeSpans(line) {
  const spans = [];
  const re = /(?<!`)(`+)(?!`)(.+?)(?<!`)\1(?!`)/g;
  for (const m of line.matchAll(re)) {
    const inner = m[2];
    const lead = inner.length - inner.trimStart().length;
    const content = inner.trim();
    if (!content) continue;
    spans.push({
      start: m.index,
      end: m.index + m[0].length,
      content,
      col: m.index + m[1].length + lead + 1,
      raw: m[0],
    });
  }
  return spans;
}

/**
 * Mask inline code spans so link and import scans cannot match inside them.
 * @param {string} line
 * @param {CodeSpan[]} spans
 * @returns {string}
 */
export function maskSpans(line, spans) {
  let out = line;
  for (const s of spans) out = blank(out, s.start, s.end);
  return out;
}

/**
 * Path claim for an inline code span, including `@path` imports.
 * @param {CodeSpan} span
 * @param {string} file
 * @param {number} lineNo
 * @returns {import('./util.js').Claim | null}
 */
export function pathFromSpan(span, file, lineNo) {
  const { content } = span;
  if (content.startsWith('@')) {
    const target = content.slice(1);
    if (looksLikePath(content) && looksLikePath(target)) {
      return makeClaim('path', stripLineRef(target), file, lineNo, span.col + 1, span.raw, { via: 'import' });
    }
    return null;
  }
  if (!looksLikePath(content)) return null;
  return makeClaim('path', stripLineRef(content), file, lineNo, span.col, span.raw, { via: 'inline-code' });
}

/**
 * Path claims for `[text](target)` and `![alt](target)` links on a line (code spans already masked).
 * Link targets are explicit references, so any relative, non-URL target counts.
 * @param {string} masked
 * @param {string} file
 * @param {number} lineNo
 * @returns {import('./util.js').Claim[]}
 */
export function pathsFromLinks(masked, file, lineNo) {
  const claims = [];
  const re = /!?\[[^\]]*\]\(\s*(<[^>]+>|[^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;
  for (const m of masked.matchAll(re)) {
    const group = m[1];
    const groupAt = m.index + m[0].indexOf('](') + 2 + (m[0].slice(m[0].indexOf('](') + 2).indexOf(group));
    let target = group.startsWith('<') ? group.slice(1, -1) : group;
    const inner = group.startsWith('<') ? 1 : 0;
    if (URL_LIKE.test(target) || target.startsWith('#') || target.startsWith('//')) continue;
    target = target.replace(/[#?].*$/, '');
    if (!target || hasPlaceholder(target) || GLOB_CHARS.test(target) || /\s/.test(target)) continue;
    claims.push(makeClaim('path', target, file, lineNo, groupAt + inner + 1, m[0], { via: 'link' }));
  }
  return claims;
}

/**
 * `@path/to/file.md` at the start of a line (Claude Code import syntax).
 * @param {string} masked
 * @param {string} file
 * @param {number} lineNo
 * @returns {import('./util.js').Claim | null}
 */
export function importFromLine(masked, file, lineNo) {
  const m = /^(\s*(?:[-*+]\s+|\d+\.\s+)?)@([^\s`]+)/.exec(masked);
  if (!m) return null;
  const target = m[2].replace(/[.,;:!)]+$/, '');
  if (!looksLikePath(target, { isImport: true })) return null;
  return makeClaim('path', stripLineRef(target), file, lineNo, m[1].length + 2, m[0].trimStart(), { via: 'import' });
}
