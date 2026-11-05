import { posix } from 'node:path';
import { pmAssertions } from './lib/assertions.js';
import { detectPm, translateCommand } from './lib/pm.js';

/** @type {import('./index.js').Rule} */
export const packageManagerMismatch = {
  id: 'AMC004',
  name: 'package-manager-mismatch',
  severity: 'warn',
  summary: 'The file tells agents to use a package manager other than the one the repo uses.',
  explain: [
    'AMC004 package-manager-mismatch (warn)',
    '',
    'The file says `npm install` (or `yarn build`, "always use pnpm", ...) but the repo is set up',
    'for another package manager. The repo tells us which in two places:',
    '  - the `packageManager` field of package.json (wins when present)',
    '  - the lockfile: package-lock.json, pnpm-lock.yaml, yarn.lock, bun.lock / bun.lockb',
    '',
    'An agent that follows the wrong command writes a second lockfile or fails on a missing binary.',
    '',
    'Only project-level calls count: install, run, test, start, add, remove and conventional script',
    'names. `npx`, `pnpm dlx`, `npm publish`, global installs (`-g`) and `bun run file.ts` are fine',
    'in any repo. Nothing is reported when the repo has several lockfiles or none, when the line',
    'forbids the manager ("never use npm"), or when the nearest package declares its own manager.',
    '',
    'Fix: use the repo\'s manager in the file. If the repo should use the other one, fix the',
    'lockfile or `packageManager` field instead. Suppress with `<!-- amc-ignore-next-line -->`.',
  ].join('\n'),
  check({ file, text, parsed, repo }) {
    const dir = posix.dirname(file) === '.' ? '' : posix.dirname(file);
    const ev = detectPm(repo, dir);
    if (!ev) return [];
    const wrong = pmAssertions(parsed, text.split(/\r?\n/)).filter((a) => a.value !== ev.pm);
    const commandLines = new Set(wrong.filter((a) => a.kind === 'command').map((a) => a.line));
    const findings = [];
    for (const a of wrong) {
      if (a.kind === 'directive' && commandLines.has(a.line)) continue;
      if (a.kind === 'command' && a.command) {
        const fixed = translateCommand(a.command, ev.pm);
        findings.push({
          message: `\`${a.evidence}\`: this repo uses ${ev.pm} (${ev.source}), not ${a.value}`,
          line: a.line,
          col: a.col,
          evidence: a.evidence,
          suggestion: fixed
            ? `Use \`${fixed}\`.`
            : `Use ${ev.pm} instead of ${a.value} here.`,
        });
      } else {
        findings.push({
          message: `Says to use ${a.value}, but this repo uses ${ev.pm} (${ev.source})`,
          line: a.line,
          col: a.col,
          evidence: a.evidence,
          suggestion: `Replace ${a.value} with ${ev.pm}, or change the lockfile if ${a.value} is the intended manager.`,
        });
      }
    }
    return findings;
  },
};
