import { buildHandoff } from '../review/handoff.js';

/**
 * Review handoff for a coding agent: the deterministic findings plus what the rules could not
 * judge, as agent-neutral JSON. Documented in docs/handoff-schema.md.
 * @param {import('../lint.js').LintResult} result
 * @param {import('../repo/index.js').RepoContext} repo
 * @param {{ version: string }} tool
 * @returns {string}
 */
export function formatAgent(result, repo, tool) {
  return `${JSON.stringify(buildHandoff(repo, result, tool), null, 2)}\n`;
}
