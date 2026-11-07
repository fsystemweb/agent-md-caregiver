import { parseArgs } from 'node:util';
import { ALL_FORMATS } from './report/index.js';
import { findRule, RULES } from './rules/index.js';

export const DEFAULT_MAX_LINES = 150;
export const DOCS_URL = 'https://fsystemweb.github.io/agent-md-caregiver/';
const LEVELS = ['off', 'info', 'warn', 'error'];

/** A mistake in how the tool was invoked. The CLI prints the message and exits 2. */
export class UsageError extends Error {}

/**
 * @typedef {object} CliOptions
 * @property {string[]} paths
 * @property {string | undefined} root
 * @property {string} format
 * @property {number | undefined} maxLines  Undefined when not given, so the config file or the default applies.
 * @property {Record<string, import('./rules/index.js').Severity | 'off'>} ruleLevels
 * @property {boolean} strict
 * @property {boolean} init
 * @property {boolean} write
 * @property {string | undefined} explain
 * @property {boolean} docs
 * @property {boolean} help
 * @property {boolean} version
 * @property {boolean} noColor
 */

/**
 * @param {string[]} argv  Arguments after the program name.
 * @returns {CliOptions}
 * @throws {UsageError}
 */
export function parseCli(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        root: { type: 'string' },
        format: { type: 'string', default: 'pretty' },
        'max-lines': { type: 'string' },
        rule: { type: 'string', multiple: true },
        strict: { type: 'boolean' },
        init: { type: 'boolean' },
        write: { type: 'boolean' },
        explain: { type: 'string' },
        docs: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
        'no-color': { type: 'boolean' },
      },
    });
  } catch (e) {
    throw new UsageError(/** @type {Error} */ (e).message);
  }
  const { values, positionals } = parsed;

  const format = values.format ?? 'pretty';
  if (!ALL_FORMATS.includes(format)) {
    throw new UsageError(`--format must be one of ${ALL_FORMATS.join(', ')} (got "${format}")`);
  }

  let maxLines;
  if (values['max-lines'] !== undefined) {
    if (!/^[1-9]\d*$/.test(values['max-lines'])) {
      throw new UsageError(`--max-lines must be a positive integer (got "${values['max-lines']}")`);
    }
    maxLines = Number(values['max-lines']);
  }

  /** @type {CliOptions['ruleLevels']} */
  const ruleLevels = {};
  for (const spec of values.rule ?? []) {
    const m = /^([^=]+)=(.+)$/.exec(spec);
    if (!m) throw new UsageError(`--rule expects <id>=<off|info|warn|error> (got "${spec}")`);
    const rule = findRule(m[1]);
    if (!rule) {
      throw new UsageError(`unknown rule "${m[1]}". Known rules: ${RULES.map((r) => r.id).join(', ')}`);
    }
    const level = m[2].toLowerCase();
    if (!LEVELS.includes(level)) {
      throw new UsageError(`--rule ${rule.id}: level must be one of ${LEVELS.join(', ')} (got "${m[2]}")`);
    }
    ruleLevels[rule.id] = /** @type {any} */ (level);
  }

  if (values.write && !values.init) throw new UsageError('--write only makes sense with --init');

  return {
    paths: positionals,
    root: values.root,
    format,
    maxLines,
    ruleLevels,
    strict: Boolean(values.strict),
    init: Boolean(values.init),
    write: Boolean(values.write),
    explain: values.explain,
    docs: Boolean(values.docs),
    help: Boolean(values.help),
    version: Boolean(values.version),
    noColor: Boolean(values['no-color']),
  };
}

export const HELP = `agent-md-caregiver: check AGENTS.md, CLAUDE.md and codex.md against your repo.

Usage:
  agent-md-caregiver [paths...] [options]

With no paths, finds AGENTS.md, CLAUDE.md and codex.md in the repo, including nested ones.
A directory path checks the instruction files inside it.

Options:
  --root <dir>         Repo root (default: current directory)
  --format <name>      pretty (default), json, github (Actions annotations), sarif or agent
                       (agent: findings plus what the rules could not judge, for a coding agent to review)
  --max-lines <n>      Line budget for instruction files (default: ${DEFAULT_MAX_LINES})
  --rule <id>=<level>  Override a rule: off, info, warn or error. Repeatable.
  --strict             Warnings fail the run too
  --init               Print the recommended AGENTS.md skeleton (writes nothing)
  --write              With --init: create AGENTS.md at the root if it does not exist
  --explain <id>       Show what a rule checks and how to fix it
  --docs               Print the documentation URL
  --no-color           Disable colors (NO_COLOR is also respected)
  -v, --version        Print the version
  -h, --help           Show this help

Config: an optional .agentmdcaregiver.json in the repo root can set maxLines, strict and rules
(for example {"rules": {"AMC008": "off"}}). Command-line options win over it.

Exit codes:
  0  clean (info findings never fail the run)
  1  findings at or above the threshold (errors; with --strict, warnings too)
  2  usage or internal error

Rules:
${RULES.map((r) => `  ${r.id}  ${r.name.padEnd(24)} ${r.summary}`).join('\n')}

Docs: ${DOCS_URL}
`;
