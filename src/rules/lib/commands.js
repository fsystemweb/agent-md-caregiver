import { tokenize } from './tokenize.js';

/**
 * @typedef {object} ScriptRef
 * @property {'npm' | 'pnpm' | 'yarn' | 'bun'} manager
 * @property {string} script
 * @property {string} display      The command as it should be shown, e.g. `npm run build`.
 * @property {'run' | 'shorthand' | 'test' | 'start'} form
 * @property {string | null} workspace  Workspace name or directory the command targets, if any.
 */

const NPM_QUIET_FLAGS = new Set(['-s', '--silent', '-q', '--quiet', '--no-color', '--color']);
const PNPM_QUIET_FLAGS = new Set(['-s', '--silent', '--stream', '--no-color']);

/** Commands `pnpm <x>` handles itself; anything else is a script (or a binary). */
const PNPM_BUILTINS = new Set([
  'add', 'approve-builds', 'audit', 'bin', 'bugs', 'cache', 'catalog', 'ci', 'clean', 'completion',
  'config', 'c', 'create', 'dedupe', 'deploy', 'deprecate', 'dist-tag', 'dlx', 'docs', 'doctor',
  'env', 'exec', 'fetch', 'help', 'ignored-builds', 'import', 'info', 'init', 'install',
  'install-completion', 'install-test', 'i', 'it', 'licenses', 'link', 'ln', 'list', 'ls', 'la',
  'll', 'login', 'logout', 'multi', 'm', 'outdated', 'owner', 'pack', 'patch', 'patch-commit',
  'patch-remove', 'peers', 'ping', 'prune', 'publish', 'purge', 'rebuild', 'rb', 'recursive',
  'remove', 'rm', 'uninstall', 'un', 'repo', 'root', 'run', 'run-script', 'sbom', 'search',
  'self-update', 'server', 'setup', 'show', 'star', 'stars', 'store', 'team', 'token', 'unlink',
  'unpublish', 'update', 'up', 'upgrade', 'version', 'view', 'v', 'whoami', 'why', 'with',
]);

/** Commands `yarn <x>` handles itself (v1 and Berry). */
const YARN_BUILTINS = new Set([
  'add', 'audit', 'autoclean', 'bin', 'cache', 'check', 'config', 'constraints', 'create', 'dedupe',
  'dlx', 'exec', 'explain', 'generate-lock-entry', 'global', 'help', 'import', 'info', 'init',
  'install', 'licenses', 'link', 'list', 'login', 'logout', 'node', 'npm', 'outdated', 'owner',
  'pack', 'patch', 'patch-commit', 'plugin', 'rebuild', 'remove', 'run', 'search', 'set', 'stage',
  'tag', 'team', 'unlink', 'unplug', 'up', 'upgrade', 'upgrade-interactive', 'version', 'versions',
  'why', 'workspace', 'workspaces',
]);

/** How to write "run script X" for each package manager, for suggestions. */
export const RUN_PREFIX = { npm: 'npm run', pnpm: 'pnpm run', yarn: 'yarn', bun: 'bun run' };

/** Script names so conventional that a missing one is a real problem even without `run`. */
export const CONVENTIONAL_SCRIPTS = new Set([
  'build', 'check', 'clean', 'dev', 'format', 'lint', 'prepare', 'serve', 'start', 'test',
  'typecheck', 'watch',
]);

/**
 * Which package.json script does this command invoke? Returns null for anything that is
 * not a script call (installs, `npx`, `node x.js`) and for forms we cannot judge safely
 * (`--workspaces`, `--prefix`, `--if-present`, unknown flags): silence beats a false alarm.
 * @param {string} text  A command claim's text.
 * @returns {ScriptRef | null}
 */
export function scriptRef(text) {
  const toks = tokenize(text).map((t) => t.value);
  const tool = toks[0];
  if (tool === 'npm') return npmRef(toks.slice(1));
  if (tool === 'pnpm') return pnpmRef(toks.slice(1));
  if (tool === 'yarn') return yarnRef(toks.slice(1));
  if (tool === 'bun') return bunRef(toks.slice(1));
  return null;
}

/** @param {string[]} t */
function npmRef(t) {
  let i = 0;
  /** @type {string | null} */
  let workspace = null;
  const flags = () => {
    while (i < t.length && t[i].startsWith('-') && t[i] !== '--') {
      const f = t[i];
      if (f === '-w' || f === '--workspace') {
        if (i + 1 >= t.length) return false;
        workspace = t[i + 1];
        i += 2;
      } else if (f.startsWith('--workspace=')) {
        workspace = f.slice('--workspace='.length);
        i++;
      } else if (NPM_QUIET_FLAGS.has(f)) {
        i++;
      } else {
        return false; // --if-present, --workspaces, --prefix, -C, unknown value flags...
      }
    }
    return true;
  };
  if (!flags()) return null;
  const sub = t[i++];
  if (sub === 'run' || sub === 'run-script' || sub === 'rum' || sub === 'urn') {
    if (!flags()) return null;
    const script = t[i];
    if (!script || script.startsWith('-')) return null;
    // npm accepts its own flags after the script name too (up to `--`).
    for (let j = i + 1; j < t.length && t[j] !== '--'; j++) {
      const f = t[j];
      if (f === '-w' || f === '--workspace') {
        if (j + 1 >= t.length) return null;
        workspace = t[++j];
      } else if (f.startsWith('--workspace=')) {
        workspace = f.slice('--workspace='.length);
      } else if (['--workspaces', '-ws', '--if-present', '--include-workspace-root', '--prefix', '-C'].includes(f)) {
        return null;
      }
    }
    return { manager: 'npm', script, display: `npm ${sub} ${script}`, form: 'run', workspace };
  }
  if (sub === 'test' || sub === 't' || sub === 'tst') {
    return { manager: 'npm', script: 'test', display: `npm ${sub}`, form: 'test', workspace };
  }
  if (sub === 'start') {
    return { manager: 'npm', script: 'start', display: 'npm start', form: 'start', workspace };
  }
  return null;
}

/** @param {string[]} t */
function pnpmRef(t) {
  let i = 0;
  /** @type {string | null} */
  let workspace = null;
  while (i < t.length && t[i].startsWith('-')) {
    const f = t[i];
    if (f === '-F' || f === '--filter') {
      if (i + 1 >= t.length) return null;
      workspace = t[i + 1];
      i += 2;
    } else if (f.startsWith('--filter=')) {
      workspace = f.slice('--filter='.length);
      i++;
    } else if (PNPM_QUIET_FLAGS.has(f) || (f.startsWith('--') && f.includes('='))) {
      i++;
    } else {
      return null; // -r, -w, --dir, --if-present, --parallel...
    }
  }
  const sub = t[i++];
  if (!sub) return null;
  if (sub === 'run' || sub === 'run-script') {
    while (i < t.length && (PNPM_QUIET_FLAGS.has(t[i]) || (t[i].startsWith('--') && t[i].includes('=')))) i++;
    const script = t[i];
    if (!script || script.startsWith('-')) return null;
    return { manager: 'pnpm', script, display: `pnpm run ${script}`, form: 'run', workspace };
  }
  if (sub === 'test' || sub === 't' || sub === 'tst') {
    return { manager: 'pnpm', script: 'test', display: `pnpm ${sub}`, form: 'test', workspace };
  }
  if (sub === 'start') {
    return { manager: 'pnpm', script: 'start', display: 'pnpm start', form: 'start', workspace };
  }
  if (PNPM_BUILTINS.has(sub) || /[./\\]/.test(sub)) return null;
  return { manager: 'pnpm', script: sub, display: `pnpm ${sub}`, form: 'shorthand', workspace };
}

/** @param {string[]} t */
function yarnRef(t) {
  let i = 0;
  /** @type {string | null} */
  let workspace = null;
  if (t[0] === 'workspace') {
    if (!t[1] || t[1].startsWith('-')) return null;
    workspace = t[1];
    i = 2;
  }
  while (i < t.length && (t[i] === '--silent' || t[i] === '-s')) i++;
  const sub = t[i++];
  if (!sub || sub.startsWith('-')) return null;
  if (sub === 'run') {
    const script = t[i];
    if (!script || script.startsWith('-')) return null;
    return { manager: 'yarn', script, display: `yarn run ${script}`, form: 'run', workspace };
  }
  if (YARN_BUILTINS.has(sub) || /[./\\]/.test(sub)) return null;
  return { manager: 'yarn', script: sub, display: `yarn ${sub}`, form: 'shorthand', workspace };
}

/** @param {string[]} t */
function bunRef(t) {
  if (t[0] !== 'run') return null;
  const script = t[1];
  if (!script || script.startsWith('-') || /[./\\]/.test(script)) return null; // file or flag
  return { manager: 'bun', script, display: `bun run ${script}`, form: 'run', workspace: null };
}

/**
 * Make targets named by a `make` command, or null when we cannot tell
 * (`-C`, `-f`, other directories or files) or no explicit target is given.
 * @param {string} text
 * @returns {{ targets: string[] } | null}
 */
export function makeRef(text) {
  const toks = tokenize(text).map((t) => t.value);
  if (toks[0] !== 'make') return null;
  const targets = [];
  for (let i = 1; i < toks.length; i++) {
    const t = toks[i];
    if (t === '-j' || t === '-l') {
      if (/^\d+$/.test(toks[i + 1] ?? '')) i++;
    } else if (/^-[a-zA-Z]*[jl]\d*$/.test(t) || ['-s', '-k', '-n', '-B', '-w', '-i', '-e', '-q', '-r', '-R', '-S', '--silent', '--keep-going', '--always-make', '--dry-run'].includes(t)) {
      continue;
    } else if (t.startsWith('-')) {
      return null; // -C, -f, --directory, --file, anything else we do not model
    } else if (t.includes('=')) {
      continue; // VAR=value
    } else {
      targets.push(t);
    }
  }
  return targets.length ? { targets } : null;
}
