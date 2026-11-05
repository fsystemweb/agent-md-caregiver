/** @type {import('./index.js').Rule} */
export const treeDump = {
  id: 'AMC008',
  name: 'tree-dump',
  severity: 'info',
  summary: 'A big directory-tree listing goes stale and tells agents little.',
  explain: [
    'AMC008 tree-dump (info)',
    '',
    'A pasted directory tree (the `├──` / `└──` kind, three or more lines) is out of date after',
    'the next rename, and agents can list the directory themselves.',
    '',
    'Fix: describe only the directories whose purpose is not obvious, one line each, e.g.',
    '"`src/rules/`: one file per lint rule". Suppress with `<!-- amc-ignore-next-line -->`.',
  ].join('\n'),
  check({ text, parsed }) {
    const lines = text.split(/\r?\n/);
    const marked = (line) =>
      /<!--\s*amc-ignore\s*-->/.test(lines[line - 1] ?? '') ||
      /<!--\s*amc-ignore-next-line\s*-->/.test(lines[line - 2] ?? '');
    return parsed.structure.treeDumps.filter((t) => !marked(t.line)).map((t) => ({
      message: `Directory tree of ${t.lines} lines will go stale`,
      line: t.line,
      col: 1,
      evidence: (lines[t.line - 1] ?? '').trim(),
      suggestion: 'Replace it with one line per non-obvious directory, or link to the docs.',
    }));
  },
};
