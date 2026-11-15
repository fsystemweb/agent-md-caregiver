import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildDemoSvg, parseAnsi, SVG_PATH } from '../scripts/demo-svg.js';
import { hasGit } from './helpers/make-repo.js';

test('assets/demo.svg is the real session for the current CLI and README', { skip: !hasGit && 'git not installed' }, () => {
  const svg = buildDemoSvg();
  assert.ok(svg.includes('1 file checked: 4 error(s), 0 warning(s), 0 info.'), 'first run shows the four errors');
  assert.ok(svg.includes('1 file checked, no problems found.'), 'the run after the fix is clean');
  assert.equal(readFileSync(SVG_PATH, 'utf8'), svg, 'assets/demo.svg is stale: run `npm run demo`');
});

test('demo renderer: parses the SGR codes the pretty format emits', () => {
  assert.deepEqual(parseAnsi('plain'), [{ text: 'plain' }]);
  const spans = parseAnsi('\u001b[1mAGENTS.md\u001b[0m x \u001b[31merror\u001b[0m');
  assert.deepEqual(spans.map((s) => [s.text, Boolean(s.bold), Boolean(s.color)]), [
    ['AGENTS.md', true, false],
    [' x ', false, false],
    ['error', false, true],
  ]);
});
