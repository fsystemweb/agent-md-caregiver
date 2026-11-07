import { posix } from 'node:path';
import { PY_LOCKFILES } from '../../repo/python.js';
import { isHedged } from './context.js';
import { tokenize } from './tokenize.js';

export const PY_MANAGERS = /** @type {const} */ (['pip', 'uv', 'poetry', 'pipenv', 'pdm']);

/** @typedef {'pip' | 'uv' | 'poetry' | 'pipenv' | 'pdm'} PyManager */

/** Matches a Python package manager in prose. */
export const PY_MANAGER_WORD = /\b(pip3?|uv|poetry|pipenv|pdm)\b/gi;
const JS_MANAGER_WORD = /\b(?:npm|pnpm|yarn|bun)\b/i;
const NEGATIVE = /\b(?:never|don'?t|do not|does not|avoid|must not|shouldn'?t|should not|not|no)\b/i;
const NEGATIVE_VERBS = new Set(['never', 'must not', 'do not', "don't"]);

/** @param {string} dir */
const at = (dir, file) => (dir ? `${dir}/${file}` : file);

/**
 * Which Python package manager does `dir` itself declare?
 *  - strong evidence: a lockfile (`uv.lock`, `poetry.lock`, `Pipfile`, `pdm.lock`) or a
 *    `[tool.uv]` / `[tool.poetry]` / `[tool.pdm]` table
 *  - weak evidence: `requirements*.txt` and a pyproject.toml with no `[project]` and no tool table
 * Conflicting evidence, or a pyproject.toml we cannot read, gives `{ pm: null }`: nobody can say.
 * @param {import('../../repo/index.js').RepoContext} repo
 * @param {string} dir  Repo-relative, '' = root.
 * @returns {{ pm: PyManager | null, source: string, weak: boolean } | null}  null: no evidence here.
 */
export function pyEvidenceAt(repo, dir) {
  /** @type {Map<PyManager, string>} */
  const found = new Map();
  for (const [file, pm] of PY_LOCKFILES) {
    if (repo.hasPath(at(dir, file)) && !found.has(pm)) found.set(pm, at(dir, file));
  }
  const hasPyproject = repo.hasPyprojectAt(dir);
  const pp = repo.pyprojectAt(dir);
  if (pp) {
    for (const tool of /** @type {const} */ (['uv', 'poetry', 'pdm'])) {
      if (pp.tools.has(tool) && !found.has(tool)) found.set(tool, `${at(dir, 'pyproject.toml')} [tool.${tool}]`);
    }
  }
  if (found.size > 1) return { pm: null, source: 'conflicting evidence', weak: false };
  if (found.size === 1) {
    const [[pm, source]] = found;
    return { pm, source, weak: false };
  }
  if (hasPyproject && !pp) return { pm: null, source: 'unreadable pyproject.toml', weak: false };
  const reqs = repo.requirementFilesAt(dir);
  if (reqs.length > 0 && !pp?.project) return { pm: 'pip', source: reqs[0], weak: true };
  return null;
}

/**
 * The Python package manager governing `dir`: the nearest directory (walking up) with evidence.
 * @param {import('../../repo/index.js').RepoContext} repo
 * @param {string} dir
 * @returns {{ pm: PyManager, source: string, weak: boolean } | null}
 */
export function detectPyPm(repo, dir) {
  for (let d = dir; ; d = posix.dirname(d)) {
    const here = d === '.' ? '' : d;
    const ev = pyEvidenceAt(repo, here);
    if (ev) return ev.pm ? /** @type {any} */ (ev) : null;
    if (here === '') return null;
  }
}

/** Packages `pip install` is used to bootstrap tooling: not a project dependency. */
const TOOLING = new Set(['pip', 'uv', 'poetry', 'pipenv', 'pdm', 'pipx', 'virtualenv', 'setuptools', 'wheel', 'build', 'twine', 'hatch']);
const PACKAGE_SPEC = /^[A-Za-z][\w.-]*(?:\[[\w,.-]+\])?(?:(?:==|>=|<=|~=|!=|<|>)[\w.*+!-]+)?$/;

const PROJECT_SUBS = {
  uv: new Set(['add', 'remove', 'sync', 'lock']),
  poetry: new Set(['install', 'add', 'remove', 'lock', 'update', 'run']),
  pipenv: new Set(['install', 'uninstall', 'sync', 'lock', 'run']),
  pdm: new Set(['install', 'add', 'remove', 'sync', 'lock', 'update', 'run']),
};

/**
 * @typedef {object} PyCommand
 * @property {PyManager} pm
 * @property {string} sub
 * @property {string[]} args     Everything after the subcommand.
 */

/**
 * Is this command a project-level call of a Python package manager?
 * `python -m venv`, `pip install -r requirements.txt`, `pip install -e .`, `uvx`, `pipx`, `uv pip ...`,
 * `uv tool`, `uv venv`, `uv python` and installs of tooling are valid in any repo, so they never count.
 * Only `pip install <package>` (bare names, no flags), and the add/remove/sync/lock/install/run family
 * of uv, poetry, pipenv and pdm do.
 * @param {string} text  A command claim's text.
 * @returns {PyCommand | null}
 */
export function pyProjectCommand(text) {
  const toks = tokenize(text).map((t) => t.value);
  /** @type {PyManager} */
  let pm;
  let rest;
  if ((toks[0] === 'python' || toks[0] === 'python3') && toks[1] === '-m' && toks[2] === 'pip') {
    pm = 'pip';
    rest = toks.slice(3);
  } else if (toks[0] === 'pip' || toks[0] === 'pip3') {
    pm = 'pip';
    rest = toks.slice(1);
  } else if (toks[0] === 'uv' || toks[0] === 'poetry' || toks[0] === 'pipenv' || toks[0] === 'pdm') {
    pm = toks[0];
    rest = toks.slice(1);
  } else {
    return null;
  }
  const sub = rest[0];
  if (!sub || sub.startsWith('-')) return null;
  const args = rest.slice(1);
  if (pm === 'pip') {
    if (sub !== 'install' || args.length === 0) return null;
    if (!args.every((a) => PACKAGE_SPEC.test(a) && !TOOLING.has(a.toLowerCase()))) return null;
    return { pm, sub, args };
  }
  if (!PROJECT_SUBS[pm].has(sub)) return null;
  return { pm, sub, args };
}

/**
 * Rewrite a Python package-manager command for another manager, or null when the mapping is
 * not obvious (flags, extras, `pip` has no equivalent for sync/lock). A wrong suggestion is worse
 * than a generic one.
 * @param {PyCommand} cmd
 * @param {PyManager} to
 * @returns {string | null}
 */
export function translatePyCommand(cmd, to) {
  if (cmd.args.some((a) => a.startsWith('-'))) return null;
  const { sub, args } = cmd;
  const list = args.join(' ');
  const adds = sub === 'add' || (cmd.pm === 'pip' && sub === 'install' && args.length > 0);
  if (adds) {
    if (to === 'pip') return `pip install ${list}`;
    if (to === 'pipenv') return `pipenv install ${list}`;
    return `${to} add ${list}`;
  }
  if (sub === 'install' && args.length === 0 && cmd.pm !== 'pip') {
    if (to === 'uv') return 'uv sync';
    if (to === 'pdm') return 'pdm install';
    if (to === 'poetry' || to === 'pipenv') return `${to} install`;
    return null;
  }
  if (sub === 'sync' && args.length === 0) {
    if (to === 'uv' || to === 'pdm') return `${to} sync`;
    if (to === 'poetry') return 'poetry install';
    if (to === 'pipenv') return 'pipenv sync';
    return null;
  }
  if (sub === 'run' && args.length > 0 && to !== 'pip') return `${to} run ${list}`;
  return null;
}

/**
 * @param {import('../../parse/index.js').ParseResult} parsed
 * @param {number} line
 * @returns {string}
 */
function headingAt(parsed, line) {
  let found = '';
  for (const h of parsed.structure.headings) {
    if (h.line > line) break;
    found = h.text;
  }
  return found;
}

/**
 * Python package manager the file tells agents to use: project-level commands and positive
 * directives that name exactly one manager (and no JavaScript one).
 * @param {import('../../parse/index.js').ParseResult} parsed
 * @param {string[]} lines
 * @returns {(import('./assertions.js').Assertion & { command?: PyCommand })[]}
 */
export function pyAssertions(parsed, lines) {
  const out = [];
  const scoped = (line) => new RegExp(PY_MANAGER_WORD.source, 'i').test(headingAt(parsed, line));
  for (const c of parsed.claims) {
    if (c.kind === 'command') {
      const cmd = pyProjectCommand(c.text);
      if (!cmd || isHedged(lines[c.line - 1] ?? '', c.col)) continue;
      out.push({
        value: cmd.pm,
        line: c.line,
        col: c.col,
        evidence: c.text,
        kind: /** @type {const} */ ('command'),
        scoped: scoped(c.line),
        command: cmd,
      });
    } else if (c.kind === 'directive' && c.subject === 'package-manager') {
      if (NEGATIVE_VERBS.has(c.verb ?? '') || NEGATIVE.test(c.text) || /\be\.g\./i.test(c.text)) continue;
      if (JS_MANAGER_WORD.test(c.text)) continue;
      const names = new Set([...c.text.matchAll(PY_MANAGER_WORD)].map((m) => m[1].toLowerCase().replace('pip3', 'pip')));
      if (names.size !== 1) continue;
      out.push({
        value: [...names][0],
        line: c.line,
        col: c.col,
        evidence: c.text,
        kind: /** @type {const} */ ('directive'),
        scoped: scoped(c.line),
      });
    }
  }
  return out;
}

const LAUNCHERS = new Set(['uv', 'poetry', 'pdm', 'pipenv']);

/**
 * What does a `uv run x`, `poetry run x`, `poe x` command invoke?
 * `kind: 'poe'` is a Poe the Poet task (only Poe can run it, so a miss is certain);
 * `kind: 'script'` may be a console script or any installed tool, so only near-misses count.
 * Anything with a flag or a path in the name is skipped.
 * @param {string} text
 * @returns {{ kind: 'poe' | 'script', name: string, launcher: string | null } | null}
 */
export function pyScriptRef(text) {
  const toks = tokenize(text).map((t) => t.value);
  /** @type {string | null} */
  let launcher = null;
  let rest = toks;
  if (LAUNCHERS.has(toks[0]) && toks[1] === 'run') {
    launcher = `${toks[0]} run`;
    rest = toks.slice(2);
  }
  const first = rest[0];
  if (!first || first.startsWith('-') || /[/\\.]/.test(first)) return null;
  if (first === 'poe' || first === 'poethepoet') {
    const task = rest[1];
    if (!task || task.startsWith('-') || /[/\\.=]/.test(task)) return null;
    return { kind: 'poe', name: task, launcher: launcher ? `${launcher} ${first}` : first };
  }
  if (!launcher) return null;
  return { kind: 'script', name: first, launcher };
}

/**
 * Does this command run pytest? `pytest ...`, `python -m pytest`, `uv run pytest`.
 * @param {string} text
 * @returns {boolean}
 */
export function runsPytest(text) {
  const toks = tokenize(text).map((t) => t.value);
  if (toks[0] === 'pytest') return true;
  if ((toks[0] === 'python' || toks[0] === 'python3') && toks[1] === '-m' && toks[2] === 'pytest') return true;
  return LAUNCHERS.has(toks[0]) && toks[1] === 'run' && toks[2] === 'pytest';
}

const MANIFESTS = [
  'pyproject.toml', 'setup.py', 'setup.cfg', 'tox.ini', 'pytest.ini', 'noxfile.py', 'Pipfile',
  'Pipfile.lock', 'uv.lock', 'poetry.lock', 'pdm.lock', 'environment.yml', 'Makefile',
];

/**
 * Is this a Python project, and does anything in it mention pytest (a dependency, config,
 * conftest.py)? `declared: null` when it is not clearly a Python project, so nobody can say.
 * Looks in `dir` and every parent up to the root.
 * @param {import('../../repo/index.js').RepoContext} repo
 * @param {string} dir
 * @returns {{ declared: boolean } | null}
 */
export function pytestDeclared(repo, dir) {
  if (repo.files().some((f) => posix.basename(f) === 'conftest.py' || posix.basename(f) === 'pytest.ini')) {
    return { declared: true };
  }
  let isPython = false;
  for (let d = dir; ; d = posix.dirname(d)) {
    const here = d === '.' ? '' : d;
    const files = [...MANIFESTS.map((m) => at(here, m)), ...repo.requirementFilesAt(here)];
    for (const f of files) {
      const text = repo.textAt(f);
      if (text === null) continue;
      if (!/^(Makefile)$/.test(posix.basename(f))) isPython = true;
      if (/pytest/i.test(text)) return { declared: true };
    }
    if (here === '') break;
  }
  return isPython ? { declared: false } : null;
}
