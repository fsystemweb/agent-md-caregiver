import { readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';

/** Files bigger than this are not read: no real instruction file or manifest comes close, and it bounds parser work. */
export const MAX_TEXT_BYTES = 2 * 1024 * 1024;

/** Lines longer than this are cut when scanning: the checked repo is untrusted, and parsers run regexes per line. */
export const MAX_LINE_LENGTH = 2000;

/**
 * Cut every line to `max` characters. The number of lines (and so every line number) is unchanged.
 * @param {string} text
 * @param {number} [max]
 * @returns {string}
 */
export function clampLines(text, max = MAX_LINE_LENGTH) {
  if (text.length <= max) return text;
  let longest = 0;
  let start = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || text.charCodeAt(i) === 10) {
      if (i - start > longest) longest = i - start;
      start = i + 1;
    }
  }
  if (longest <= max) return text;
  return text.split('\n').map((l) => (l.length > max ? l.slice(0, max) : l)).join('\n');
}

/**
 * Real path of `rel` under `root`, or null when it does not exist or resolves outside the root
 * (a symlink in the checked repo pointing at `/etc/passwd`, a file in a parent directory...).
 * The root itself may be reached through a symlink; only where the target ends up counts.
 * @param {string} root
 * @param {string} rel  Repo-relative path.
 * @returns {string | null}
 */
export function realInside(root, rel) {
  try {
    const real = realpathSync(join(root, rel));
    const r = relative(realpathSync(root), real);
    if (r === '..' || r.startsWith(`..${sep}`) || isAbsolute(r)) return null;
    return real;
  } catch {
    return null;
  }
}

/**
 * Read a text file from the checked repo, but never one that resolves outside the repo root:
 * the repo is untrusted input, so a symlink must not make the tool read (and echo) other files.
 * @param {string} root
 * @param {string} rel
 * @returns {string | null}  null when unreadable, outside the root, or larger than MAX_TEXT_BYTES.
 */
export function readTextInside(root, rel) {
  const real = realInside(root, rel);
  if (real === null) return null;
  try {
    if (statSync(real).size > MAX_TEXT_BYTES) return null;
    return readFileSync(real, 'utf8');
  } catch {
    return null;
  }
}
