import { compileGlob, isValidGlob } from './repo/glob.js';

/**
 * Folders where AI coding agents keep installed skills and their own settings. Instruction files
 * in them come from the agent or a third party, not from this repo, so they are skipped by
 * default at any depth. `--include-skills`, or naming the path on the command line, checks them.
 */
export const SKILL_DIRS = ['.claude/skills/', '.agent/skills/', '.agents/skills/', '.codex/', '.cursor/', '.gemini/'];

/**
 * @typedef {object} Skipped
 * @property {string} file    Repo-relative path.
 * @property {string} reason  Which skill folder or which `ignore` pattern excluded it.
 */

/**
 * Why a user `ignore` pattern is unusable, or null if it is fine.
 * @param {unknown} pattern
 * @returns {string | null}
 */
export function invalidIgnorePattern(pattern) {
  if (typeof pattern !== 'string' || pattern.trim() === '') return 'must be a non-empty string';
  if (!isValidGlob(pattern)) return 'is not a valid glob';
  return null;
}

/**
 * Build the "why is this path skipped?" check.
 * @param {string[]} ignore  The config's `ignore` globs, relative to the repo root.
 * @param {{ includeSkills?: boolean }} [opts]
 * @returns {(path: string) => string | null}  The reason, or null when the path is checked.
 */
export function skipper(ignore, { includeSkills = false } = {}) {
  const rules = [
    ...(includeSkills ? [] : SKILL_DIRS.map((dir) => ({ m: compileGlob(`${dir}**`, { floating: true }), reason: `agent skill or tool folder (${dir})` }))),
    ...ignore.map((p) => ({ m: compileGlob(p.replace(/^\/+|\/+$/g, '')), reason: `ignore pattern "${p}" in .agentmdcaregiver.json` })),
  ];
  return (path) => {
    // A pattern matches the path itself or any folder above it, so `examples` skips `examples/a/AGENTS.md`.
    const parts = path.split('/');
    for (const { m, reason } of rules) {
      for (let i = 1; i <= parts.length; i++) {
        if (m.test(parts.slice(0, i).join('/'))) return reason;
      }
    }
    return null;
  };
}

/**
 * Split instruction files into the ones to check and the ones to skip. A path the user named on
 * the command line is a request to check it: if it is itself inside a skipped area, everything
 * under it is checked.
 * @param {string[]} files  Repo-relative paths, sorted.
 * @param {(path: string) => string | null} skip
 * @param {string[]} [named]  Repo-relative paths given on the command line.
 * @returns {{ files: string[], skipped: Skipped[] }}
 */
export function splitFiles(files, skip, named = []) {
  const forced = named.filter((p) => p !== '' && skip(`${p}/`) !== null);
  const kept = [];
  /** @type {Skipped[]} */
  const skipped = [];
  for (const file of files) {
    const reason = forced.some((p) => file === p || file.startsWith(`${p}/`)) ? null : skip(file);
    if (reason) skipped.push({ file, reason });
    else kept.push(file);
  }
  return { files: kept, skipped };
}
