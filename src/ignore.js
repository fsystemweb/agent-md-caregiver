import { compileGlob, isValidGlob, MAX_GLOB_LENGTH } from './repo/glob.js';

/**
 * Directories that hold third-party content: installed agent skills, editor and tool folders,
 * vendored code. Instruction files inside them were not written for this repo, so they are never
 * checked. Matched at any depth.
 */
export const DEFAULT_IGNORES = [
  '.agent/skills/',
  '.claude/skills/',
  '.cursor/',
  '.codex/',
  'vendor/',
  'third_party/',
  'third-party/',
  'node_modules/',
];

/**
 * @typedef {object} Skipped
 * @property {string} file    Repo-relative path.
 * @property {string} reason  Which default or which `ignore` pattern excluded it.
 *
 * @typedef {object} IgnoreRule
 * @property {string} reason
 * @property {(file: string) => boolean} test
 */

/**
 * Does `matcher` match the file, or one of the directories it sits in?
 * @param {{ test(s: string): boolean }} matcher
 * @param {string} file
 */
function matchesFileOrParent(matcher, file) {
  if (matcher.test(file)) return true;
  for (let i = file.indexOf('/'); i !== -1; i = file.indexOf('/', i + 1)) {
    if (matcher.test(file.slice(0, i))) return true;
  }
  return false;
}

/** @type {IgnoreRule[]} */
const DEFAULT_RULES = DEFAULT_IGNORES.map((dir) => {
  const matcher = compileGlob(`${dir}**`, { floating: true });
  return { reason: `vendored or tool directory (${dir})`, test: (f) => matcher.test(f) };
});

/**
 * Why a user `ignore` pattern is unusable, or null if it is fine.
 * @param {unknown} pattern
 * @returns {string | null}
 */
export function invalidIgnorePattern(pattern) {
  if (typeof pattern !== 'string') return 'must be a string';
  if (pattern.trim() === '') return 'must not be empty';
  if (pattern.length > MAX_GLOB_LENGTH) return `is longer than ${MAX_GLOB_LENGTH} characters`;
  if (pattern.startsWith('!')) return 'negation ("!") is not supported';
  if (pattern.startsWith('/') || /^[A-Za-z]:/.test(pattern)) return 'must be relative to the repo root';
  if (pattern.split('/').includes('..')) return 'must not contain ".."';
  if (!isValidGlob(pattern)) return 'is not a valid glob';
  return null;
}

/**
 * Compile a user `ignore` pattern (already validated). Anchored at the repo root, `/` separated;
 * a trailing `/` is optional. A pattern that names a directory excludes everything under it.
 * @param {string} pattern
 * @returns {IgnoreRule}
 */
export function compileIgnore(pattern) {
  const matcher = compileGlob(pattern.replace(/\/+$/, ''));
  return { reason: `ignore pattern "${pattern}" in .agentmdcaregiver.json`, test: (f) => matchesFileOrParent(matcher, f) };
}

/**
 * Split instruction files into the ones to check and the ones to skip. The built-in vendor
 * directories always apply; `patterns` are the config's `ignore` entries.
 * @param {string[]} files  Repo-relative paths.
 * @param {string[]} [patterns]
 * @returns {{ files: string[], skipped: Skipped[] }}
 */
export function applyIgnores(files, patterns = []) {
  const rules = [...DEFAULT_RULES, ...patterns.map(compileIgnore)];
  /** @type {string[]} */
  const kept = [];
  /** @type {Skipped[]} */
  const skipped = [];
  for (const file of files) {
    const hit = rules.find((r) => r.test(file));
    if (hit) skipped.push({ file, reason: hit.reason });
    else kept.push(file);
  }
  return { files: kept, skipped };
}

/**
 * `ignore` patterns that match none of `files`. A stale entry is reported rather than kept, so
 * the config never quietly carries rules for files that are gone.
 * @param {string[]} files  Every instruction file in the repo.
 * @param {string[]} patterns
 * @returns {string[]}
 */
export function staleIgnores(files, patterns) {
  return patterns.filter((p) => {
    const rule = compileIgnore(p);
    return !files.some((f) => rule.test(f));
  });
}
