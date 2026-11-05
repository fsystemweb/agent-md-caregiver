/**
 * AMC000 started as the pipeline stub from PR 3 and stays as a small real rule: it flags
 * instruction files with no content at all.
 * @type {import('./index.js').Rule}
 */
export const emptyFile = {
  id: 'AMC000',
  name: 'empty-file',
  severity: 'info',
  summary: 'The instruction file has no content.',
  explain: [
    'AMC000 empty-file (info)',
    '',
    'The file is empty or contains only whitespace, so agents get no guidance from it.',
    'Add the exact commands to build and test, a few conventions, and boundaries',
    '(always / ask first / never), or delete the file.',
    '',
    'Run `agent-md-caregiver --init` to print a recommended skeleton.',
  ].join('\n'),
  check({ text }) {
    if (text.trim() !== '') return [];
    return [
      {
        message: 'Instruction file is empty',
        line: 1,
        col: 1,
        evidence: '',
        suggestion: 'Add build and test commands, conventions and boundaries, or delete the file.',
      },
    ];
  },
};
