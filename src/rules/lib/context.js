import { posix } from 'node:path';
import { normalizeRepoPath } from '../../repo/index.js';

const NEGATIVE = /\b(?:never|don'?t|do not|does not|avoid|must not|shouldn'?t|should not|cannot|can'?t)\b/i;
const HEDGE = /\b(?:e\.g\.|for example|for instance|such as|i\.e\.)|\bexample\b/i;

/**
 * Is the claim mentioned only in passing: "never run X", "e.g. X"? We stay silent there,
 * because X not existing is not a problem for the reader.
 * @param {string} lineText  The full source line.
 * @param {number} col       1-based column where the claim starts.
 * @returns {boolean}
 */
export function isHedged(lineText, col) {
  const before = lineText.slice(0, Math.max(0, col - 1));
  return NEGATIVE.test(before) || HEDGE.test(before);
}

/**
 * Candidate repo-relative locations for a path written in `file`: next to the file first,
 * then each parent directory up to the root. (People write `src/x.js` in a nested file
 * meaning that package, or meaning the repo root; either is fine.)
 * A leading `/` means "from the repo root".
 * @param {string} file    Repo-relative path of the instruction file.
 * @param {string} target  Path as written (no fragment).
 * @returns {string[]} normalized, deduplicated; empty if it cannot be inside the repo
 */
export function candidatePaths(file, target) {
  if (target.startsWith('/')) {
    const n = normalizeRepoPath(target.slice(1));
    return n === null ? [] : [n];
  }
  if (target.startsWith('~') || /^[A-Za-z]:[\\/]/.test(target)) return [];
  const out = new Set();
  let dir = posix.dirname(file);
  for (;;) {
    const n = normalizeRepoPath(posix.join(dir === '.' ? '' : dir, target));
    if (n !== null) out.add(n);
    if (dir === '.' || dir === '/') break;
    dir = posix.dirname(dir);
  }
  return [...out];
}

/**
 * Does `target` exist (or legitimately not exist, because it is ignored) from `file`'s point of view?
 * Returns 'unknown' when it points outside the repo and cannot be checked.
 * @param {import('../../repo/index.js').RepoContext} repo
 * @param {string} file
 * @param {string} target
 * @returns {{ status: 'ok' | 'missing' | 'unknown', normalized: string }}
 */
export function checkPath(repo, file, target) {
  const candidates = candidatePaths(file, target);
  if (candidates.length === 0) return { status: 'unknown', normalized: target };
  const found = candidates.some((c) => c === '' || repo.hasPath(c) || repo.existsOnDisk(c));
  if (found) return { status: 'ok', normalized: candidates[0] };
  const dirHint = target.endsWith('/') ? '/' : '';
  if (candidates.some((c) => c !== '' && repo.isIgnored(c + dirHint))) return { status: 'ok', normalized: candidates[0] };
  return { status: 'missing', normalized: candidates[0] };
}

/**
 * Where did a missing path go? Git rename first, then the closest existing name.
 * @param {import('../../repo/index.js').RepoContext} repo
 * @param {string} normalized
 * @param {(missing: string, files: string[], dirs: string[]) => string | null} closestPath
 * @returns {{ path: string, how: 'git' | 'name' } | null}
 */
export function whereDidItGo(repo, normalized, closestPath) {
  const renamed = repo.findRenamed(normalized);
  if (renamed) return { path: renamed, how: 'git' };
  const guess = closestPath(normalized, repo.files(), repo.dirs());
  return guess ? { path: guess, how: 'name' } : null;
}
