import { statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

/** File names that count as agent instruction files. */
export const INSTRUCTION_FILES = new Set(['AGENTS.md', 'CLAUDE.md', 'codex.md']);

/**
 * Instruction files anywhere in the tree (root and nested), sorted. Respects .gitignore.
 * @param {import('./repo/index.js').RepoContext} repo
 * @param {string} [dir]  Limit to this directory, relative to the root ('' = whole repo).
 * @returns {string[]}
 */
export function discover(repo, dir = '') {
  const prefix = dir ? `${dir}/` : '';
  return repo
    .files()
    .filter((f) => f.startsWith(prefix) && INSTRUCTION_FILES.has(f.slice(f.lastIndexOf('/') + 1)))
    .sort();
}

/**
 * Turn command-line paths into repo-relative instruction file paths. A directory means
 * "discover inside it"; a file is taken as given, whatever its name.
 * @param {import('./repo/index.js').RepoContext} repo
 * @param {string[]} paths  As typed, relative to `cwd`.
 * @param {string} cwd
 * @returns {string[]} sorted, unique
 * @throws {Error} if a path does not exist or is outside the repo root
 */
export function resolveTargets(repo, paths, cwd) {
  const out = new Set();
  for (const p of paths) {
    const abs = resolve(cwd, p);
    const rel = relative(repo.root, abs);
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new Error(`${p}: outside the repo root (${repo.root})`);
    }
    let st;
    try {
      st = statSync(abs);
    } catch {
      throw new Error(`${p}: no such file or directory`);
    }
    const posixRel = rel.split(sep).join('/');
    if (st.isDirectory()) discover(repo, posixRel).forEach((f) => out.add(f));
    else out.add(posixRel);
  }
  return [...out].sort();
}
