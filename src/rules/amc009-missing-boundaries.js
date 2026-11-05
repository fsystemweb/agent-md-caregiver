import { hasImport } from './lib/prose.js';

const BOUNDARY_HEADING = /^\s{0,3}#{1,6}\s+.*\b(?:boundar\w*|guardrails?|always|never|do(?:n'?t|es not)s?|permissions?)\b/im;
const BOUNDARY_LINE = /^\s*(?:[-*+]\s+)?\**(?:always|never|ask first|ask before|ask)\**\s*[:\-–—]/im;
const SECRETS = /\b(?:secrets?|credentials?|api[ _-]?keys?|tokens?|passwords?)\b|\.env\b/i;

/** @type {import('./index.js').Rule} */
export const missingBoundaries = {
  id: 'AMC009',
  name: 'missing-boundaries',
  severity: 'info',
  summary: 'No always / ask first / never section, or no rule about secrets.',
  explain: [
    'AMC009 missing-boundaries (info)',
    '',
    'Good instruction files say what an agent may always do, must ask before doing, and must',
    'never do. Two things are reported, for root files that have content and do not just import',
    'another file:',
    '',
    '1. No boundaries: no heading such as "Boundaries" or "Never", and no "Always:" / "Ask first:" /',
    '   "Never:" lines.',
    '2. No rule about secrets (secrets, credentials, API keys, tokens, passwords, .env).',
    '',
    'Fix: add a section like',
    '  ## Boundaries',
    '  - Always: run the tests before committing.',
    '  - Ask first: adding a dependency, deleting files.',
    '  - Never: commit secrets.',
    '',
    'This is advice, so it is info and never fails a run.',
  ].join('\n'),
  check({ file, text, parsed }) {
    if (file.includes('/') || text.trim() === '' || hasImport(parsed)) return [];
    const first = text.split(/\r?\n/).find((l) => l.trim() !== '') ?? '';
    const findings = [];
    if (!BOUNDARY_HEADING.test(text) && !BOUNDARY_LINE.test(text)) {
      findings.push({
        message: 'No boundaries: nothing says what agents may always do, must ask about, or must never do',
        line: 1,
        col: 1,
        evidence: first,
        suggestion: 'Add a "Boundaries" section with "Always:", "Ask first:" and "Never:" lines.',
      });
    }
    if (!SECRETS.test(text)) {
      findings.push({
        message: 'No rule about secrets',
        line: 1,
        col: 1,
        evidence: first,
        suggestion: 'Add a line such as "Never: commit secrets or read .env files."',
      });
    }
    return findings;
  },
};
