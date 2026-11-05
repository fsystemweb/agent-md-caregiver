import { readFileSync, realpathSync } from 'node:fs';
import { posix } from 'node:path';
import { checkPath, whereDidItGo } from './lib/context.js';
import { closestPath } from './lib/suggest.js';

/** @typedef {import('./index.js').RuleFinding} RuleFinding */

/** @param {string} s */
function decode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** @type {import('./index.js').Rule} */
export const brokenImport = {
  id: 'AMC005',
  name: 'broken-import',
  severity: 'error',
  summary: 'An `@` import or relative link points nowhere, or CLAUDE.md does not import AGENTS.md.',
  explain: [
    'AMC005 broken-import (error)',
    '',
    'Two problems, both silent failures for the agent:',
    '',
    '1. An `@path/to/file.md` import, or a relative Markdown link, whose target does not exist.',
    '   Claude Code loads imports into context; a broken one loads nothing and says nothing.',
    '   The finding suggests the renamed or closest path, as AMC002 does.',
    '',
    '2. A CLAUDE.md next to an AGENTS.md that does not import it. Claude Code reads only CLAUDE.md,',
    '   so everything in AGENTS.md is invisible to it. Start CLAUDE.md with `@AGENTS.md` and keep',
    '   only Claude-specific notes below. A symlink or an identical copy is fine.',
    '',
    'Targets are looked up next to the file, then in each parent directory up to the root; a leading',
    '`/` means the repo root. URLs, `#anchors` and paths ignored by .gitignore are not reported.',
    '',
    'Fix: correct the target, remove the import or link, or add `@AGENTS.md` to CLAUDE.md.',
    'Suppress a deliberate case with `<!-- amc-ignore-next-line -->`.',
  ].join('\n'),
  check({ file, text, parsed, repo }) {
    /** @type {RuleFinding[]} */
    const findings = [];

    for (const claim of parsed.claims) {
      if (claim.kind !== 'path' || (claim.via !== 'import' && claim.via !== 'link')) continue;
      const target = claim.via === 'link' ? decode(claim.text) : claim.text;
      const { status, normalized } = checkPath(repo, file, target);
      if (status !== 'missing') continue;
      const where = whereDidItGo(repo, normalized, closestPath);
      const what = claim.via === 'import' ? 'Import' : 'Link target';
      let suggestion = claim.via === 'import' ? 'Fix the path or remove the import.' : 'Fix the link or remove it.';
      if (where?.how === 'git') suggestion = `Renamed to \`${where.path}\` in git history. Update the ${claim.via}.`;
      else if (where) suggestion = `Did you mean \`${where.path}\`?`;
      findings.push({
        message: `${what} \`${target}\` does not exist`,
        line: claim.line,
        col: claim.col,
        evidence: claim.raw.trim(),
        suggestion,
      });
    }

    if (posix.basename(file) === 'CLAUDE.md') {
      const dir = posix.dirname(file);
      const sibling = dir === '.' ? 'AGENTS.md' : `${dir}/AGENTS.md`;
      if (repo.hasPath(sibling) && !importsOrMirrors(repo, file, sibling, text, parsed)) {
        const first = text.split(/\r?\n/).find((l) => l.trim()) ?? '';
        findings.push({
          message: `CLAUDE.md does not import ${sibling}, so Claude Code never sees it`,
          line: 1,
          col: 1,
          evidence: first,
          suggestion: `Start CLAUDE.md with \`@AGENTS.md\` and keep only Claude-specific notes below it.`,
        });
      }
    }
    return findings;
  },
};

/**
 * Does CLAUDE.md pull in its sibling AGENTS.md: via `@AGENTS.md`, as a symlink to it,
 * or as an identical copy?
 * @param {import('../repo/index.js').RepoContext} repo
 * @param {string} file
 * @param {string} sibling
 * @param {string} text
 * @param {import('../parse/index.js').ParseResult} parsed
 * @returns {boolean}
 */
function importsOrMirrors(repo, file, sibling, text, parsed) {
  const dir = posix.dirname(file);
  const imported = parsed.claims.some(
    (c) =>
      c.kind === 'path' &&
      c.via === 'import' &&
      posix.normalize(posix.join(dir === '.' ? '' : dir, c.text)) === sibling,
  );
  if (imported) return true;
  try {
    const a = realpathSync(`${repo.root}/${file}`);
    const b = realpathSync(`${repo.root}/${sibling}`);
    if (a === b) return true;
    return readFileSync(b, 'utf8').trim() === text.trim();
  } catch {
    return false;
  }
}
