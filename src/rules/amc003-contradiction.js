import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { parse } from '../parse/index.js';
import {
  commandAssertions,
  indentAssertions,
  indentConflict,
  pmAssertions,
  runnerAssertions,
} from './lib/assertions.js';
import { detectPm, pmEvidenceAt } from './lib/pm.js';
import { detectPyPm, pyAssertions, pyEvidenceAt } from './lib/python.js';

/** @typedef {import('./lib/assertions.js').Assertion} Assertion */

const NAMES = ['AGENTS.md', 'CLAUDE.md', 'codex.md'];

/**
 * @type {{ key: 'pm' | 'pypm' | 'indent' | 'runner', label: string, get: (p: any, lines: string[]) => Assertion[], conflict: (a: string, b: string) => boolean }[]}
 */
const CATEGORIES = [
  { key: 'pm', label: 'package manager', get: (p, lines) => pmAssertions(p, lines).filter((a) => !a.scoped), conflict: (a, b) => a !== b },
  { key: 'pypm', label: 'Python package manager', get: (p, lines) => pyAssertions(p, lines).filter((a) => !a.scoped), conflict: (a, b) => a !== b },
  { key: 'indent', label: 'indentation', get: indentAssertions, conflict: indentConflict },
  { key: 'runner', label: 'test runner', get: runnerAssertions, conflict: (a, b) => a !== b },
];

/** @param {string} file */
const dirOf = (file) => (posix.dirname(file) === '.' ? '' : posix.dirname(file));

/**
 * Instruction files that outrank `file`: the ones above it in the tree, and the sibling
 * files that come earlier in AGENTS.md, CLAUDE.md, codex.md order. Each conflict is reported
 * once, in the lower-ranked file.
 * @param {import('../repo/index.js').RepoContext} repo
 * @param {string} file
 * @returns {string[]}
 */
function outranking(repo, file) {
  const out = [];
  const dir = dirOf(file);
  const rank = NAMES.indexOf(posix.basename(file));
  for (const name of NAMES.slice(0, rank === -1 ? NAMES.length : rank)) {
    const p = dir ? `${dir}/${name}` : name;
    if (p !== file && repo.hasPath(p)) out.push(p);
  }
  for (let d = dir; d !== ''; ) {
    d = dirOf(d);
    for (const name of NAMES) {
      const p = d ? `${d}/${name}` : name;
      if (repo.hasPath(p)) out.push(p);
    }
  }
  return out;
}

/** @type {import('./index.js').Rule} */
export const contradiction = {
  id: 'AMC003',
  name: 'contradiction',
  severity: 'error',
  summary: 'Two instructions conflict: package managers, tabs vs spaces, test runners, "never X" vs "run X".',
  explain: [
    'AMC003 contradiction (error)',
    '',
    'The file tells agents two incompatible things, so whichever they follow, they break the other:',
    '  - package manager: "Always use pnpm" and later `npm install` (Python too: "use uv" and later `pip install requests`)',
    '  - indentation: "Use tabs" and later "indent with 2 spaces" (or 2 spaces vs 4 spaces)',
    '  - test runner: "Use vitest" and later "Use jest"',
    '  - "Never run `x`" in one place and a command `x` to run in another',
    '',
    'The same checks run between files: CLAUDE.md against AGENTS.md next to it, and a nested file',
    'against the files above it. Each conflict is reported once, in the lower-ranked file.',
    'Nested files may differ on package manager when their directory declares its own (a',
    'lockfile or packageManager field) and on test runner when their package.json uses that runner.',
    '',
    'Deliberately quiet: lines scoped to a language, file type or layer ("tabs in Makefiles",',
    '"vitest for e2e"), lines naming both options ("use pnpm, not npm"), headings that name the',
    'manager ("## Using yarn"), and prohibitions with a condition ("never ... unless", "in CI").',
    '',
    'Fix: keep one rule. Check the lockfile, .editorconfig or formatter config for the real one.',
    'Suppress a deliberate case with `<!-- amc-ignore-next-line -->`.',
  ].join('\n'),
  check({ file, text, parsed, repo }) {
    /** @type {import('./index.js').RuleFinding[]} */
    const findings = [];
    const dir = dirOf(file);
    const real = detectPm(repo, dir);
    const realPy = detectPyPm(repo, dir);
    const lines = text.split(/\r?\n/);

    // 1. Within the file.
    for (const cat of CATEGORIES) {
      const list = cat.get(parsed, lines);
      if (list.length < 2) continue;
      const base = list[0];
      for (const a of list.slice(1)) {
        if (a.line === base.line || !cat.conflict(base.value, a.value)) continue;
        const hint =
          cat.key === 'pypm' && realPy && !realPy.weak
            ? `The repo uses ${realPy.pm} (${realPy.source}); change the lines that say otherwise.`
            : cat.key === 'pypm'
              ? 'Pick one Python package manager and use it everywhere; the lockfile shows which the repo really uses.'
              : cat.key === 'pm' && real
            ? `The repo uses ${real.pm} (${real.source}); change the lines that say otherwise.`
            : cat.key === 'pm'
              ? 'Pick one package manager and use it everywhere; the lockfile shows which the repo really uses.'
              : 'Keep one rule. .editorconfig, the formatter or the test config show which one is real.';
        findings.push({
          message: `Contradicts line ${base.line}: that says ${cat.label} ${base.value}, this says ${a.value}`,
          line: a.line,
          col: a.col,
          evidence: a.evidence,
          suggestion: hint,
        });
      }
    }

    // 2. "Never run X" against "run X".
    const { forbidden, required } = commandAssertions(parsed, lines);
    for (const r of required) {
      const f = forbidden.find((x) => x.value === r.value);
      if (!f || f.line === r.line) continue;
      const later = r.line > f.line ? r : f;
      const other = later === r ? f : r;
      findings.push({
        message:
          later === r
            ? `Contradicts line ${f.line}, which says never to run \`${r.value}\``
            : `Contradicts line ${r.line}, which tells agents to run \`${r.value}\``,
        line: later.line,
        col: later.col,
        evidence: later.evidence,
        suggestion: `Remove one of lines ${other.line} and ${later.line}, or say when each applies.`,
      });
    }

    // 3. Against the files that outrank this one.
    for (const otherFile of outranking(repo, file)) {
      let otherText;
      try {
        otherText = readFileSync(join(repo.root, otherFile), 'utf8');
      } catch {
        continue;
      }
      const other = parse(otherText, { file: otherFile });
      const nested = dirOf(otherFile) !== dir;
      for (const cat of CATEGORIES) {
        if (nested && cat.key === 'indent') continue;
        const theirs = cat.get(other, otherText.split(/\r?\n/));
        if (theirs.length === 0) continue;
        const rep = theirs[0];
        if (theirs.some((t) => cat.conflict(rep.value, t.value))) continue; // it contradicts itself
        if (nested && cat.key === 'pm' && ownsManager(repo, dir, dirOf(otherFile))) continue;
        if (nested && cat.key === 'pypm' && ownsManager(repo, dir, dirOf(otherFile), pyEvidenceAt)) continue;
        if (nested && cat.key === 'runner' && usesRunnerLocally(repo, dir, theirs.concat(cat.get(parsed, lines)))) continue;
        const clash = cat.get(parsed, lines).find((a) => cat.conflict(rep.value, a.value));
        if (!clash) continue;
        findings.push({
          message: `Contradicts ${otherFile} line ${rep.line}: that says ${cat.label} ${rep.value}, this says ${clash.value}`,
          line: clash.line,
          col: clash.col,
          evidence: clash.evidence,
          suggestion: nested
            ? `Make it agree with ${otherFile}, or remove the line from one of the files if the difference is deliberate.`
            : `Make the two files agree; CLAUDE.md can import AGENTS.md with \`@AGENTS.md\` instead of repeating it.`,
        });
      }
    }

    return findings;
  },
};

/**
 * Does a directory between `dir` (inclusive) and `above` (exclusive) declare its own manager?
 * @param {import('../repo/index.js').RepoContext} repo
 * @param {string} dir
 * @param {string} above
 */
function ownsManager(repo, dir, above, evidenceAt = pmEvidenceAt) {
  for (let d = dir; d !== above && d !== ''; d = dirOf(d)) {
    if (evidenceAt(repo, d)) return true;
  }
  return false;
}

/**
 * Does the package.json at `dir` mention one of the test runners named in `assertions`?
 * @param {import('../repo/index.js').RepoContext} repo
 * @param {string} dir
 * @param {Assertion[]} assertions
 */
function usesRunnerLocally(repo, dir, assertions) {
  const pkg = repo.packageJsonAt(dir);
  if (!pkg) return false;
  const blob = JSON.stringify([pkg.dependencies, pkg.devDependencies, pkg.scripts]);
  return assertions.some((a) => blob.includes(a.value));
}
