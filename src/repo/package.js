import { compileGlob } from './glob.js';

/** Lockfile name → package manager. */
export const LOCKFILES = /** @type {const} */ ([
  ['package-lock.json', 'npm'],
  ['npm-shrinkwrap.json', 'npm'],
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lockb', 'bun'],
  ['bun.lock', 'bun'],
]);

/**
 * Parse the `packageManager` field, e.g. `pnpm@9.1.0+sha512.abc`.
 * @param {unknown} value
 * @returns {{ name: string, version: string | null, raw: string } | null}
 */
export function parsePackageManager(value) {
  if (typeof value !== 'string') return null;
  const m = /^([a-z][a-z0-9-]*)(?:@([^+\s]+))?(?:\+.*)?$/i.exec(value.trim());
  return m ? { name: m[1].toLowerCase(), version: m[2] ?? null, raw: value } : null;
}

/**
 * Workspace glob patterns from package.json (`workspaces` array or `{ packages }`)
 * plus `packages:` in pnpm-workspace.yaml.
 * @param {any} pkg
 * @param {string | null} pnpmYaml
 * @returns {string[]}
 */
export function workspacePatterns(pkg, pnpmYaml) {
  /** @type {string[]} */
  let patterns = [];
  const ws = pkg?.workspaces;
  if (Array.isArray(ws)) patterns = ws;
  else if (Array.isArray(ws?.packages)) patterns = ws.packages;
  patterns = patterns.filter((p) => typeof p === 'string');
  if (pnpmYaml) patterns = patterns.concat(pnpmPackages(pnpmYaml));
  return [...new Set(patterns)];
}

/**
 * The `packages:` list of a pnpm-workspace.yaml (the only part we need; no YAML parser).
 * @param {string} yaml
 * @returns {string[]}
 */
function pnpmPackages(yaml) {
  const out = [];
  let inPackages = false;
  for (const line of yaml.split(/\r?\n/)) {
    if (/^packages\s*:/.test(line)) {
      inPackages = true;
      continue;
    }
    if (!inPackages) continue;
    const item = /^\s+-\s*(['"]?)(.+?)\1\s*(?:#.*)?$/.exec(line);
    if (item) out.push(item[2]);
    else if (line.trim() && !/^\s*#/.test(line)) inPackages = false;
  }
  return out;
}

/**
 * Directories (relative, no trailing slash) matching workspace patterns. A pattern
 * starting with `!` excludes. Only directories that contain a package.json qualify.
 * @param {string[]} patterns
 * @param {string[]} candidateDirs  Directories that contain a package.json.
 * @returns {string[]}
 */
export function matchWorkspaceDirs(patterns, candidateDirs) {
  const compile = (/** @type {string} */ p) =>
    compileGlob(p.replace(/^\.\//, '').replace(/\/+$/, ''));
  const include = patterns.filter((p) => !p.startsWith('!')).map(compile);
  const exclude = patterns.filter((p) => p.startsWith('!')).map((p) => compile(p.slice(1)));
  return candidateDirs
    .filter((d) => include.some((re) => re.test(d)) && !exclude.some((re) => re.test(d)))
    .sort();
}
