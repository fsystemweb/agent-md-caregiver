/** @type {import('./index.js').Rule} */
export const tooLong = {
  id: 'AMC007',
  name: 'too-long',
  severity: 'warn',
  summary: 'The file is longer than the line budget (default 150).',
  explain: [
    'AMC007 too-long (warn)',
    '',
    'Instruction files are loaded into every conversation, so each line costs context and the',
    'important ones get lost in a long file. The default budget is 150 lines.',
    '',
    'Change the budget with `--max-lines <n>` or `"maxLines"` in .agentmdcaregiver.json,',
    'or turn the rule off with `--rule AMC007=off`.',
    '',
    'Fix: keep commands, conventions and boundaries here; move detail into docs and link it',
    '(or import it with `@docs/file.md`).',
  ].join('\n'),
  check({ text, parsed, options }) {
    const total = parsed.structure.lineCount;
    if (total <= options.maxLines) return [];
    const first = text.split(/\r?\n/)[options.maxLines] ?? '';
    return [
      {
        message: `File is ${total} lines, over the budget of ${options.maxLines}`,
        line: options.maxLines + 1,
        col: 1,
        evidence: first.trim(),
        suggestion: `Cut ${total - options.maxLines} lines: keep commands, conventions and boundaries, and link longer docs instead of inlining them.`,
      },
    ];
  },
};
