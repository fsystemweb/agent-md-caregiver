import { parse } from './parse/index.js';
import { readTextInside } from './repo/safe-read.js';
import { RULES } from './rules/index.js';

/** @typedef {import('./rules/index.js').Severity} Severity */

/**
 * @typedef {object} Finding
 * @property {string} ruleId
 * @property {Severity} severity
 * @property {string} message
 * @property {string} file
 * @property {number} line
 * @property {number} col
 * @property {string} evidence
 * @property {string} [suggestion]
 *
 * @typedef {object} LintResult
 * @property {string[]} files     Files checked, sorted.
 * @property {Finding[]} findings Sorted by file, line, column, rule id.
 */

export const SEVERITY_RANK = { info: 1, warn: 2, error: 3 };

/**
 * Run every enabled rule over every file. Pure with respect to the repo: reads files, writes nothing.
 * @param {import('./repo/index.js').RepoContext} repo
 * @param {string[]} files  Repo-relative paths.
 * @param {{ maxLines: number, ruleLevels: Record<string, Severity | 'off'> }} options
 * @returns {LintResult}
 */
export function lint(repo, files, options) {
  /** @type {Finding[]} */
  const findings = [];
  for (const file of files) {
    const text = readTextInside(repo.root, file);
    if (text === null) continue; // unreadable, or a symlink that leaves the repo root
    const parsed = parse(text, { file });
    for (const rule of RULES) {
      const level = options.ruleLevels[rule.id] ?? rule.severity;
      if (level === 'off') continue;
      for (const f of rule.check({ file, text, parsed, repo, options })) {
        findings.push({ ruleId: rule.id, severity: level, file, ...f });
      }
    }
  }
  findings.sort(
    (a, b) =>
      cmp(a.file, b.file) || a.line - b.line || a.col - b.col || cmp(a.ruleId, b.ruleId),
  );
  return { files: [...files], findings };
}

/**
 * @param {string} a
 * @param {string} b
 */
function cmp(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Exit code for a result: 1 if any finding is at or above the threshold, else 0.
 * Errors fail by default; with `strict`, warnings fail too. Info never fails.
 * @param {Finding[]} findings
 * @param {boolean} strict
 * @returns {0 | 1}
 */
export function exitCodeFor(findings, strict) {
  const threshold = strict ? SEVERITY_RANK.warn : SEVERITY_RANK.error;
  return findings.some((f) => SEVERITY_RANK[f.severity] >= threshold) ? 1 : 0;
}
