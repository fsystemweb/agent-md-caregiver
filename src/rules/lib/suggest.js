import { posix } from 'node:path';

const MAX_NAME = 100;

/**
 * Edit distance where swapping two adjacent characters ("buidl" / "build") counts as one edit.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function distance(a, b) {
  if (a === b) return 0;
  // Names come from the checked files. Nothing that long is a typo of something else, and the table below is len(a) x len(b).
  if (a.length > MAX_NAME || b.length > MAX_NAME) return Math.max(a.length, b.length);
  /** @type {number[][]} */
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

/**
 * Closest name for a script or Makefile target. `test:unit` ~ `test` counts (one is the
 * other plus a `:suffix`), then small edit distances. Ties go to the alphabetically first.
 * @param {string} name
 * @param {string[]} candidates
 * @param {{ strict?: boolean }} [opts]  `strict`: allow one edit at most (used to decide whether to speak up at all).
 * @returns {string | null}
 */
export function closestName(name, candidates, { strict = false } = {}) {
  const lower = name.toLowerCase();
  const limit = strict ? 1 : Math.max(1, Math.floor(name.length / 3));
  /** @type {{ cand: string, score: number } | null} */
  let best = null;
  for (const cand of [...candidates].sort()) {
    const c = cand.toLowerCase();
    let score;
    if (c === lower) score = 0;
    else if (lower.startsWith(`${c}:`) || c.startsWith(`${lower}:`)) score = 0.5;
    else {
      const d = distance(lower, c);
      if (d > limit) continue;
      score = d;
    }
    if (!best || score < best.score) best = { cand, score };
  }
  return best ? best.cand : null;
}

/**
 * Best guess for where a missing path went, from the files and directories that exist now.
 * Prefers an exact basename match (case-insensitive) with the most path in common, then a
 * single near-miss basename. Returns null when it would be a guess.
 * @param {string} missing  Normalized repo-relative path.
 * @param {string[]} files
 * @param {string[]} dirs
 * @returns {string | null}
 */
export function closestPath(missing, files, dirs) {
  const base = posix.basename(missing).toLowerCase();
  const pool = missing.includes('.') && /\.[A-Za-z0-9]+$/.test(base) ? files : [...files, ...dirs];
  const same = pool.filter((p) => posix.basename(p).toLowerCase() === base);
  if (same.length === 1) return same[0];
  if (same.length > 1) {
    const want = missing.toLowerCase().split('/').reverse();
    const common = (/** @type {string} */ p) => {
      const have = p.toLowerCase().split('/').reverse();
      let n = 0;
      while (n < want.length && n < have.length && want[n] === have[n]) n++;
      return n;
    };
    const ranked = same.map((p) => ({ p, n: common(p) })).sort((x, y) => y.n - x.n || (x.p < y.p ? -1 : 1));
    return ranked[0].n > ranked[1].n ? ranked[0].p : null;
  }
  const limit = Math.max(1, Math.floor(base.length / 4));
  const near = pool.filter((p) => distance(base, posix.basename(p).toLowerCase()) <= limit);
  return near.length === 1 ? near[0] : null;
}
