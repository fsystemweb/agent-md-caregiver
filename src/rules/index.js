import { emptyFile } from './amc000-empty-file.js';
import { commandNotFound } from './amc001-command-not-found.js';
import { pathMissing } from './amc002-path-missing.js';
import { brokenImport } from './amc005-broken-import.js';

/**
 * @typedef {'info' | 'warn' | 'error'} Severity
 *
 * @typedef {object} RuleFinding  What a rule reports; the runner adds `ruleId`, `severity` and `file`.
 * @property {string} message
 * @property {number} line   1-based.
 * @property {number} col    1-based.
 * @property {string} evidence  The offending source text (may be empty).
 * @property {string} [suggestion]  A concrete fix an agent can apply without guessing.
 *
 * @typedef {object} RuleContext
 * @property {string} file   Path relative to the repo root, '/' separated.
 * @property {string} text   Raw file contents.
 * @property {import('../parse/index.js').ParseResult} parsed
 * @property {import('../repo/index.js').RepoContext} repo
 * @property {{ maxLines: number }} options
 *
 * @typedef {object} Rule
 * @property {string} id
 * @property {string} name
 * @property {Severity} severity  Default severity.
 * @property {string} summary
 * @property {string} explain     Text printed by `--explain <id>`.
 * @property {(ctx: RuleContext) => RuleFinding[]} check
 */

/** @type {Rule[]} All rules, in id order. */
export const RULES = [emptyFile, commandNotFound, pathMissing, brokenImport];

/**
 * @param {string} id  Case-insensitive.
 * @returns {Rule | undefined}
 */
export function findRule(id) {
  return RULES.find((r) => r.id === id.toUpperCase());
}
