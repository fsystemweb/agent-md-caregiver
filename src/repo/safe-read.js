import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';

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
 * @returns {string | null}  null when unreadable or outside the root.
 */
export function readTextInside(root, rel) {
  const real = realInside(root, rel);
  if (real === null) return null;
  try {
    return readFileSync(real, 'utf8');
  } catch {
    return null;
  }
}
