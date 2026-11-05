import { spawnSync } from 'node:child_process';
import { lstatSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Run a fixed, read-only git command. Never goes through a shell, never touches the network.
 * @param {string} cwd
 * @param {string[]} args
 * @returns {string | null} stdout, or null if git is missing or the command failed
 */
export function git(cwd, args) {
  const r = spawnSync('git', ['-c', 'core.quotepath=false', ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 15000,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
  });
  if (r.error || r.status !== 0) return null;
  return r.stdout;
}

/**
 * Like `git`, but also reports the exit status (for commands where 1 means "no").
 * @param {string} cwd
 * @param {string[]} args
 * @returns {{ status: number | null, stdout: string }}
 */
export function gitStatus(cwd, args) {
  const r = spawnSync('git', ['-c', 'core.quotepath=false', ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 15000,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
  });
  return { status: r.error ? null : r.status, stdout: r.stdout ?? '' };
}

/** @param {string} root */
export function isGitRepo(root) {
  return git(root, ['rev-parse', '--is-inside-work-tree'])?.trim() === 'true';
}

/**
 * Tracked plus untracked-but-not-ignored files, as git sees them. Files deleted from
 * disk but still in the index are dropped; submodule directories are returned separately.
 * @param {string} root
 * @returns {{ files: string[], dirs: string[] } | null}
 */
export function gitFiles(root) {
  const out = git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
  if (out === null) return null;
  const files = [];
  const dirs = [];
  for (const rel of new Set(out.split('\0').filter(Boolean))) {
    if (/(^|\/)node_modules(\/|$)/.test(rel)) continue; // never repo content, even if not ignored
    let st;
    try {
      st = lstatSync(join(root, rel));
    } catch {
      continue; // deleted in the working tree
    }
    (st.isDirectory() ? dirs : files).push(rel);
  }
  return { files: files.sort(), dirs: dirs.sort() };
}

/**
 * @typedef {object} Rename
 * @property {string} from
 * @property {string} to
 */

/**
 * File renames in history, newest first. Paths are relative to `root`.
 * @param {string} root
 * @returns {Rename[]}
 */
export function gitRenames(root) {
  const out = git(root, [
    'log', '--relative', '--diff-filter=R', '-M', '--name-status', '--format=',
  ]);
  if (!out) return [];
  const renames = [];
  for (const line of out.split('\n')) {
    const parts = line.split('\t');
    if (parts.length === 3 && parts[0].startsWith('R')) {
      renames.push({ from: parts[1], to: parts[2] });
    }
  }
  return renames;
}
