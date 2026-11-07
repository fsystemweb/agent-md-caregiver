import { inlineTableKeys, namesUnder, parseToml } from './toml.js';

/** Lock and manifest files that tell which Python tool manages a directory. */
export const PY_LOCKFILES = /** @type {const} */ ([
  ['uv.lock', 'uv'],
  ['poetry.lock', 'poetry'],
  ['Pipfile.lock', 'pipenv'],
  ['Pipfile', 'pipenv'],
  ['pdm.lock', 'pdm'],
]);

/** `requirements.txt`, `requirements-dev.txt`, `requirements.in`, ... */
export const REQUIREMENTS_FILE = /^requirements[\w.-]*\.(?:txt|in)$/;

/**
 * @typedef {object} PyProject  The parts of a pyproject.toml the rules use.
 * @property {boolean} project       Has a `[project]` table.
 * @property {Set<string>} tools     Names under `[tool.*]`: `uv`, `poetry`, `pytest`, ...
 * @property {string[]} scripts      Console scripts: `[project.scripts]`, Poetry and PDM scripts.
 * @property {string[] | null} poeTasks  Poe the Poet tasks, or null when it is not configured.
 */

/**
 * @param {string} text  Contents of a pyproject.toml.
 * @returns {PyProject | null}  null when the file is not something the small reader understands.
 */
export function parsePyproject(text) {
  const toml = parseToml(text);
  if (!toml) return null;
  const tools = new Set();
  for (const name of toml.tables.keys()) {
    if (name.startsWith('tool.')) tools.add(name.split('.')[1]);
  }
  const scripts = new Set();
  for (const table of ['project.scripts', 'project.gui-scripts', 'tool.poetry.scripts', 'tool.pdm.scripts']) {
    for (const n of namesUnder(toml, table) ?? []) scripts.add(n);
  }
  const inlineScripts = toml.tables.get('project')?.get('scripts');
  for (const n of (inlineScripts && inlineTableKeys(inlineScripts)) || []) scripts.add(n);

  let poeTasks = namesUnder(toml, 'tool.poe.tasks');
  const inlineTasks = toml.tables.get('tool.poe')?.get('tasks');
  if (inlineTasks) {
    const keys = inlineTableKeys(inlineTasks);
    if (keys) poeTasks = [...new Set([...(poeTasks ?? []), ...keys])].sort();
  }
  return {
    project: toml.tables.has('project') || [...toml.tables.keys()].some((t) => t.startsWith('project.')),
    tools,
    scripts: [...scripts].sort(),
    poeTasks,
  };
}
