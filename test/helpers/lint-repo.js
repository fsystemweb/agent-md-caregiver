import { after } from 'node:test';
import { lint } from '../../src/lint.js';
import { createRepoContext } from '../../src/repo/index.js';
import { makeRepo } from './make-repo.js';

const cleanups = [];
after(() => cleanups.forEach((fn) => fn()));

/**
 * Build a throwaway repo, lint one instruction file, return the findings of one rule.
 * @param {string} ruleId
 * @param {Record<string, string>} files
 * @param {{ target?: string, git?: boolean, setup?: (r: ReturnType<typeof makeRepo>) => void }} [opts]
 */
export function check(ruleId, files, { target = 'AGENTS.md', git = false, setup } = {}) {
  const r = makeRepo(files, { git });
  cleanups.push(r.cleanup);
  if (setup) setup(r);
  const repo = createRepoContext(r.root);
  const { findings } = lint(repo, [target], { maxLines: 150, ruleLevels: {} });
  return findings.filter((f) => f.ruleId === ruleId);
}

/** Compact view for readable assertions. */
export const brief = (findings) => findings.map((f) => [f.line, f.col, f.message]);
