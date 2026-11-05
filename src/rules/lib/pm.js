import { posix } from 'node:path';
import { LOCKFILES, parsePackageManager } from '../../repo/package.js';
import { CONVENTIONAL_SCRIPTS } from './commands.js';
import { tokenize } from './tokenize.js';

export const MANAGERS = /** @type {const} */ (['npm', 'pnpm', 'yarn', 'bun']);

/** @typedef {'npm' | 'pnpm' | 'yarn' | 'bun'} Manager */

/**
 * Which package manager does `dir` itself declare? Looks only at that directory: the
 * `packageManager` field of its package.json, else its lockfile.
 * `{ pm: null }` means the directory has conflicting lockfiles, so nobody can say.
 * @param {import('../../repo/index.js').RepoContext} repo
 * @param {string} dir  Repo-relative, '' = root.
 * @returns {{ pm: Manager | null, source: string } | null}  null: no evidence in this directory.
 */
export function pmEvidenceAt(repo, dir) {
  const field = parsePackageManager(repo.packageJsonAt(dir)?.packageManager);
  if (field && MANAGERS.includes(/** @type {any} */ (field.name))) {
    return { pm: /** @type {Manager} */ (field.name), source: `packageManager field: ${field.raw}` };
  }
  const found = LOCKFILES.filter(([file]) => repo.hasPath(dir ? `${dir}/${file}` : file));
  if (found.length === 0) return null;
  const managers = new Set(found.map(([, m]) => m));
  if (managers.size > 1) return { pm: null, source: 'conflicting lockfiles' };
  const [file, pm] = found[0];
  return { pm, source: dir ? `${dir}/${file}` : file };
}

/**
 * The package manager that governs `dir`: the nearest directory (walking up) that declares one.
 * Null when nothing declares one or the evidence conflicts.
 * @param {import('../../repo/index.js').RepoContext} repo
 * @param {string} dir  Repo-relative, '' = root.
 * @returns {{ pm: Manager, source: string } | null}
 */
export function detectPm(repo, dir) {
  for (let d = dir; ; d = posix.dirname(d)) {
    const here = d === '.' ? '' : d;
    const ev = pmEvidenceAt(repo, here);
    if (ev) return ev.pm ? /** @type {any} */ (ev) : null;
    if (here === '') return null;
  }
}

/** Subcommands that mean "work on this project" for every manager. */
const PROJECT_SUBS = new Set([
  'run', 'run-script', 'install', 'i', 'ci', 'add', 'remove', 'rm', 'uninstall', 'update', 'up',
  'test', 't', 'start', 'stop', 'restart', 'rebuild', 'install-test', 'it',
]);

/**
 * Is this command a project-level call of a package manager (install, run a script, ...)?
 * `npx`, `dlx`, `publish`, `login`, `-g` installs and `bun run file.ts` are not: they are fine
 * in any repo, so they never count.
 * @param {string} text  A command claim's text.
 * @returns {{ pm: Manager, sub: string, tokens: string[] } | null}
 */
export function projectCommand(text) {
  const tokens = tokenize(text).map((t) => t.value);
  const pm = /** @type {Manager} */ (tokens[0]);
  if (!MANAGERS.includes(pm)) return null;
  const rest = tokens.slice(1);
  if (rest.some((t) => t === '-g' || t === '--global' || t === 'global')) return null;
  const sub = rest.find((t) => !t.startsWith('-'));
  if (!sub) return null;
  if (pm === 'bun' && (sub === 'test' || (sub === 'run' && /[/.]/.test(rest[rest.indexOf(sub) + 1] ?? '')))) {
    return null;
  }
  const isScript = pm !== 'npm' && (CONVENTIONAL_SCRIPTS.has(sub) || sub.includes(':'));
  if (!PROJECT_SUBS.has(sub) && !isScript) return null;
  return { pm, sub, tokens };
}

/**
 * Rewrite a package-manager command for another manager, or null when the mapping is not
 * obvious (flags, `--`, `ci`). A wrong suggestion is worse than a generic one.
 * @param {{ pm: Manager, sub: string, tokens: string[] }} cmd
 * @param {Manager} to
 * @returns {string | null}
 */
export function translateCommand(cmd, to) {
  const rest = cmd.tokens.slice(1);
  if (rest.some((t) => t.startsWith('-'))) return null;
  const args = rest.slice(rest.indexOf(cmd.sub) + 1);
  const { sub } = cmd;
  const installs = sub === 'install' || sub === 'i' || sub === 'add';
  if (installs) {
    if (args.length === 0) return sub === 'add' ? null : `${to} install`;
    return to === 'npm' ? `npm install ${args.join(' ')}` : `${to} add ${args.join(' ')}`;
  }
  if (sub === 'run' || sub === 'run-script') return args.length ? `${to} run ${args.join(' ')}` : null;
  if (sub === 'test' || sub === 't') return to === 'bun' ? 'bun run test' : `${to} test`;
  if (sub === 'start') return `${to} start`;
  if (sub === 'ci' || PROJECT_SUBS.has(sub)) return null;
  return [`${to} run`, sub, ...args].join(' ');
}
