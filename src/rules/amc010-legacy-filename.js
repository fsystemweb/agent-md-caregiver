import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { hasImport } from './lib/prose.js';

/** Non-blank lines of 20+ characters, normalized. */
function substantial(text) {
  return new Set(
    text
      .split(/\r?\n/)
      .map((l) => l.trim().replace(/\s+/g, ' '))
      .filter((l) => l.length >= 20 && !l.startsWith('#')),
  );
}

/** @type {import('./index.js').Rule} */
export const legacyFilename = {
  id: 'AMC010',
  name: 'legacy-filename',
  severity: 'info',
  summary: 'codex.md is a legacy name, or CLAUDE.md and AGENTS.md are diverging copies.',
  explain: [
    'AMC010 legacy-filename (info)',
    '',
    'AGENTS.md is the shared name that most coding agents read. Two things are reported:',
    '',
    '1. `codex.md`: a legacy name. Rename it to AGENTS.md, or merge it into the AGENTS.md next to it.',
    '2. A CLAUDE.md that is a separate copy of the AGENTS.md next to it: it does not import it and',
    '   shares three or more identical lines with it, so the two will drift apart. (A CLAUDE.md that',
    '   does not import AGENTS.md at all is also reported as an error by AMC005.)',
    '',
    'Fix: keep one source of truth in AGENTS.md and make CLAUDE.md just `@AGENTS.md` plus any',
    'Claude-specific notes.',
  ].join('\n'),
  check({ file, text, parsed, repo }) {
    const name = posix.basename(file);
    const dir = posix.dirname(file) === '.' ? '' : posix.dirname(file);
    const sibling = (n) => (dir ? `${dir}/${n}` : n);
    const first = text.split(/\r?\n/)[0]?.trim() ?? '';

    if (name === 'codex.md') {
      const hasAgents = repo.hasPath(sibling('AGENTS.md'));
      return [
        {
          message: '`codex.md` is a legacy name; AGENTS.md is the shared one',
          line: 1,
          col: 1,
          evidence: first,
          suggestion: hasAgents
            ? `Merge it into ${sibling('AGENTS.md')} and delete it.`
            : `Rename it: \`git mv ${file} ${sibling('AGENTS.md')}\`.`,
        },
      ];
    }

    if (name === 'CLAUDE.md' && repo.hasPath(sibling('AGENTS.md')) && !hasImport(parsed)) {
      let agents;
      try {
        agents = readFileSync(join(repo.root, sibling('AGENTS.md')), 'utf8');
      } catch {
        return [];
      }
      if (agents === text) return [];
      const mine = substantial(text);
      const shared = [...substantial(agents)].filter((l) => mine.has(l)).length;
      if (shared < 3) return [];
      return [
        {
          message: `CLAUDE.md repeats ${shared} lines of ${sibling('AGENTS.md')} without importing it, so the two will drift`,
          line: 1,
          col: 1,
          evidence: first,
          suggestion: 'Keep the shared content in AGENTS.md and reduce CLAUDE.md to `@AGENTS.md` plus Claude-specific notes.',
        },
      ];
    }
    return [];
  },
};
