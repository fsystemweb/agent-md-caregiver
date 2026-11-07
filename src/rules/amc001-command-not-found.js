import { posix } from 'node:path';
import { CONVENTIONAL_SCRIPTS, makeRef, RUN_PREFIX, scriptRef } from './lib/commands.js';
import { isHedged } from './lib/context.js';
import { pyScriptRef, pytestDeclared, runsPytest } from './lib/python.js';
import { closestName } from './lib/suggest.js';

/** @typedef {import('./index.js').RuleFinding} RuleFinding */

const MAX_LISTED = 8;

/**
 * @param {string[]} names
 * @returns {string}
 */
function list(names) {
  const shown = names.slice(0, MAX_LISTED).join(', ');
  return names.length > MAX_LISTED ? `${shown}, ...` : shown;
}

/**
 * package.json scripts visible from `dir`: that directory's and every parent's up to the
 * root. Commands are often run from a package or from the root, so either counts.
 * @param {import('../repo/index.js').RepoContext} repo
 * @param {string} dir
 * @returns {Record<string, string>[]}
 */
function scriptSources(repo, dir) {
  const out = [];
  for (let d = dir; ; d = posix.dirname(d)) {
    const scripts = repo.scriptsAt(d === '.' ? '' : d);
    if (scripts) out.push(scripts);
    if (d === '.' || d === '' || d === '/') break;
  }
  return out;
}

/**
 * @param {import('../repo/index.js').RepoContext} repo
 * @param {string} dir
 * @returns {{ targets: string[], opaque: boolean }[]}
 */
function makeSources(repo, dir) {
  const out = [];
  for (let d = dir; ; d = posix.dirname(d)) {
    const m = repo.makeAt(d === '.' ? '' : d);
    if (m.exists) out.push(m);
    if (d === '.' || d === '' || d === '/') break;
  }
  return out;
}

/** @type {import('./index.js').Rule} */
export const commandNotFound = {
  id: 'AMC001',
  name: 'command-not-found',
  severity: 'error',
  summary: 'A package script, Makefile target or workspace the file tells agents to run does not exist.',
  explain: [
    'AMC001 command-not-found (error)',
    '',
    'The file tells agents to run a command that cannot work in this repo:',
    '  - `npm run x`, `npm test`, `pnpm run x`, `yarn x`, `bun run x` where package.json has no such script',
    '  - `make x` where the Makefile has no such target',
    '  - a workspace (`npm -w x`, `pnpm --filter x`, `yarn workspace x`) that does not exist',
    '  - `poe x` (or `uv run poe x`) where [tool.poe.tasks] has no task x',
    '  - `uv run x` / `poetry run x` where x is one typo away from a console script in pyproject.toml',
    '  - `pytest` in a Python repo that never mentions pytest (no dependency, config or conftest.py)',
    '',
    'Agents follow these lines, so a dead command wastes a turn and often derails the task.',
    'The finding suggests the closest existing script or target, or lists what is available.',
    '',
    'What it checks: scripts in the nearest package.json at or above the file (and its parents),',
    'honoring `cd dir` earlier in the same code block. `yarn x`, `pnpm x` and `bun run x` can also',
    'run installed binaries, so those are only reported for conventional or colon-style names',
    '(build, test, lint:fix) or when a similarly named script exists.',
    '',
    'What it stays silent on: `npx`, `node x.js`, installs, `--workspaces`, `--if-present`, `--prefix`,',
    'unknown flags, Makefiles that `include` others, commands after "never", "avoid", "e.g.", and',
    'repos with no package.json or Makefile in range.',
    '',
    'Fix: correct the command, add the script or target, or remove the line.',
    'Suppress a deliberate case with `<!-- amc-ignore-next-line -->`.',
  ].join('\n'),
  check({ file, text, parsed, repo }) {
    /** @type {RuleFinding[]} */
    const findings = [];
    const lines = text.split(/\r?\n/);
    const fileDir = posix.dirname(file);

    for (const claim of parsed.claims) {
      if (claim.kind !== 'command' || claim.dir === '?') continue;
      if (claim.via === 'inline-code' && isHedged(lines[claim.line - 1] ?? '', claim.col)) continue;
      const base = claim.dir
        ? posix.normalize(posix.join(fileDir === '.' ? '' : fileDir, claim.dir))
        : fileDir;
      const evidence = claim.raw.trim();
      const at = { line: claim.line, col: claim.col, evidence };

      const ref = scriptRef(claim.text);
      if (ref) {
        const f = checkScript(repo, ref, base, claim.dir !== undefined);
        if (f) findings.push({ ...at, ...f(claim.text) });
        continue;
      }

      const py = checkPython(repo, claim.text, base);
      if (py) {
        findings.push({ ...at, ...py });
        continue;
      }

      const make = makeRef(claim.text);
      if (make) {
        const sources = makeSources(repo, base);
        if (sources.length === 0 || sources.some((s) => s.opaque)) continue;
        const known = new Set(sources.flatMap((s) => s.targets));
        for (const target of make.targets) {
          if (known.has(target) || repo.hasPath(posix.join(base === '.' ? '' : base, target))) continue;
          const close = closestName(target, [...known]);
          findings.push({
            ...at,
            message: `\`${claim.text}\`: the Makefile has no target "${target}"`,
            suggestion: close
              ? `Did you mean \`make ${close}\`?`
              : `Add a "${target}" target to the Makefile or remove this command. Available targets: ${list([...known].sort())}.`,
          });
        }
      }
    }
    return findings;
  },
};

/**
 * @param {import('../repo/index.js').RepoContext} repo
 * @param {import('./lib/commands.js').ScriptRef} ref
 * @param {string} base      Directory the command runs in, relative to the root.
 * @param {boolean} hasCd    A `cd` put the command in another directory.
 * @returns {((commandText: string) => { message: string, suggestion: string }) | null}
 */
function checkScript(repo, ref, base, hasCd) {
  const prefix = RUN_PREFIX[ref.manager];

  if (ref.workspace !== null) {
    if (hasCd) return null;
    const spaces = repo.workspaces();
    if (spaces.length === 0) return null; // cannot know what the workspaces are
    if (/[*?[\]{}!.^~]/.test(ref.workspace)) return null; // a filter expression, not a name
    const ws = spaces.find((w) => w.name === ref.workspace || w.dir === ref.workspace.replace(/^\.\//, ''));
    if (!ws) {
      const names = spaces.map((w) => w.name ?? w.dir);
      const close = closestName(ref.workspace, names);
      return (cmd) => ({
        message: `\`${cmd}\`: unknown workspace "${ref.workspace}"`,
        suggestion: close
          ? `Did you mean workspace "${close}"?`
          : `Known workspaces: ${list(names.sort())}.`,
      });
    }
    if (ws.scripts.includes(ref.script)) return null;
    if (!confident(ref, ws.scripts)) return null;
    const close = closestName(ref.script, ws.scripts);
    return (cmd) => ({
      message: `\`${cmd}\`: workspace "${ws.name ?? ws.dir}" has no script "${ref.script}"`,
      suggestion: close
        ? `Did you mean script "${close}"?`
        : `Available scripts in "${ws.name ?? ws.dir}": ${ws.scripts.length ? list(ws.scripts) : '(none)'}.`,
    });
  }

  const sources = scriptSources(repo, base);
  if (sources.length === 0) return null; // no package.json in range: nothing to compare with
  if (sources.some((s) => ref.script in s)) return null;
  if (ref.form === 'start' && repo.hasPath(posix.join(base === '.' ? '' : base, 'server.js'))) return null;
  const names = [...new Set(sources.flatMap((s) => Object.keys(s)))].sort();
  if (!confident(ref, names)) return null;
  const close = closestName(ref.script, names);
  return (cmd) => ({
    message: `\`${cmd}\`: no such script "${ref.script}" in package.json`,
    suggestion: close
      ? `Did you mean \`${prefix} ${close}\`?`
      : names.length
        ? `Add a "${ref.script}" script to package.json or remove this command. Available scripts: ${list(names)}.`
        : `Add a "${ref.script}" script to package.json or remove this command. package.json has no scripts.`,
  });
}

/**
 * `npm run x` and `pnpm run x` only ever run scripts, so a miss is certain. Shorthand and
 * `yarn`/`bun` forms may run an installed binary instead, so only report when the name
 * looks like a script.
 * @param {import('./lib/commands.js').ScriptRef} ref
 * @param {string[]} names
 * @returns {boolean}
 */
function confident(ref, names) {
  if (ref.manager === 'npm') return true;
  if (ref.manager === 'pnpm' && ref.form !== 'shorthand') return true;
  return (
    ref.script.includes(':') ||
    CONVENTIONAL_SCRIPTS.has(ref.script) ||
    closestName(ref.script, names, { strict: true }) !== null
  );
}

/**
 * Python commands: Poe tasks, console scripts one typo away, pytest that nothing declares.
 * @param {import('../repo/index.js').RepoContext} repo
 * @param {string} text
 * @param {string} base  Directory the command runs in, relative to the root.
 * @returns {{ message: string, suggestion: string } | null}
 */
function checkPython(repo, text, base) {
  const ref = pyScriptRef(text);
  const viaScript = ref ? checkPyScript(repo, text, base, ref) : null;
  if (viaScript) return viaScript;

  if (runsPytest(text)) {
    const found = pytestDeclared(repo, base);
    if (!found || found.declared) return null;
    return {
      message: `\`${text}\`: nothing in this repo mentions pytest (no dependency, config or conftest.py)`,
      suggestion: 'Add pytest to the dev dependencies, or use the test command the repo really uses.',
    };
  }
  return null;
}

/**
 * @param {import('../repo/index.js').RepoContext} repo
 * @param {string} text
 * @param {string} base
 * @param {NonNullable<ReturnType<typeof pyScriptRef>>} ref
 * @returns {{ message: string, suggestion: string } | null}
 */
function checkPyScript(repo, text, base, ref) {
  const sources = [];
  for (let d = base; ; d = posix.dirname(d)) {
    const pp = repo.pyprojectAt(d === '.' ? '' : d);
    if (pp) sources.push(pp);
    if (d === '.' || d === '' || d === '/') break;
  }
  if (sources.length === 0) return null;
  if (ref.kind === 'poe') {
    if (repo.files().some((f) => /(^|\/)poe_tasks\./.test(f))) return null; // tasks live in another file
    const configured = sources.filter((s) => s.poeTasks !== null);
    if (configured.length === 0) return null;
    const tasks = [...new Set(configured.flatMap((s) => s.poeTasks ?? []))].sort();
    if (tasks.includes(ref.name)) return null;
    const close = closestName(ref.name, tasks);
    return {
      message: `\`${text}\`: no Poe task "${ref.name}" in pyproject.toml`,
      suggestion: close
        ? `Did you mean \`${ref.launcher} ${close}\`?`
        : `Add a "${ref.name}" task under [tool.poe.tasks] or remove this command. Available tasks: ${list(tasks)}.`,
    };
  }
  const scripts = [...new Set(sources.flatMap((s) => s.scripts))].sort();
  if (scripts.includes(ref.name)) return null;
  const close = closestName(ref.name, scripts, { strict: true });
  if (!close) return null; // could be any installed tool
  return {
    message: `\`${text}\`: no console script "${ref.name}" in pyproject.toml`,
    suggestion: `Did you mean \`${ref.launcher} ${close}\`?`,
  };
}
