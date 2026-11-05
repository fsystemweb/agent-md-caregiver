import { proseLines } from './lib/prose.js';

/** @param {string} line */
function normalize(line) {
  return line
    .replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/, '')
    .replace(/[*_]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[\s.;:!]+$/, '')
    .trim();
}

/** @type {import('./index.js').Rule} */
export const duplicateInstruction = {
  id: 'AMC011',
  name: 'duplicate-instruction',
  severity: 'info',
  summary: 'The same instruction appears twice in one file.',
  explain: [
    'AMC011 duplicate-instruction (info)',
    '',
    'The same line (ignoring list markers, case and trailing punctuation) appears twice in the',
    'file. Repeats waste context and drift apart when only one copy is edited.',
    '',
    'Headings, tables, quotes, code blocks and short lines (under four words) are not compared.',
    '',
    'Fix: delete one copy. Suppress with `<!-- amc-ignore-next-line -->`.',
  ].join('\n'),
  check({ text }) {
    const findings = [];
    const seen = new Map();
    for (const { n, text: line } of proseLines(text)) {
      if (/^\s*(?:#|>|\|)/.test(line)) continue;
      const key = normalize(line);
      if (key.split(' ').length < 4) continue;
      const earlier = seen.get(key);
      if (earlier === undefined) {
        seen.set(key, n);
        continue;
      }
      findings.push({
        message: `Same instruction as line ${earlier}`,
        line: n,
        col: line.length - line.trimStart().length + 1,
        evidence: line.trim(),
        suggestion: `Delete this line or line ${earlier}.`,
      });
    }
    return findings;
  },
};
