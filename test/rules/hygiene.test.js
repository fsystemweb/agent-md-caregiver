import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { brief, check } from '../helpers/lint-repo.js';

const run = (id, md, files = {}, opts) => check(id, { ...files, 'AGENTS.md': md }, opts);

describe('AMC006 vague-instruction', () => {
  test('"run the tests" with no test command', () => {
    const [f] = run('AMC006', '# Dev\n\n- Install: `npm install`\n- Always run the tests before committing.\n');
    assert.equal(f.severity, 'warn');
    assert.equal(f.line, 4);
    assert.equal(f.col, 10);
    assert.equal(f.message, 'Vague: "run the tests" but the file has no tests command');
    assert.equal(f.suggestion, 'Write the exact test command, e.g. `npm test`.');
  });

  test('linter, build, formatter, type check; each reported once', () => {
    const out = run('AMC006', '`npm install`\nRun the linter.\nRun the linter again.\nBuild the project.\nRun the formatter.\nRun the type checker.\n');
    assert.deepEqual(out.map((f) => f.line), [2, 4, 5, 6]);
  });

  test('no commands at all in a root file', () => {
    const [f] = run('AMC006', '# Notes\n\nBe nice.\n');
    assert.equal(f.message, 'No commands: agents cannot tell how to build, test or lint this project');
    assert.equal(f.line, 1);
    assert.equal(f.evidence, '# Notes');
  });

  test('silent: the file has a matching command', () => {
    assert.deepEqual(run('AMC006', '- Test: `npm test`\n- Always run the tests before committing.\n'), []);
  });

  test('silent: line already has inline code, hedged line, ignore marker, fenced text', () => {
    const md = '`npm test`\nRun the tests with `npm test`.\nNever run the linter by hand.\n<!-- amc-ignore-next-line -->\nRun the linter.\n```text\nrun the formatter\n```\n';
    assert.deepEqual(run('AMC006', md), []);
  });

  test('silent: empty file, import-only file, nested file without commands', () => {
    assert.deepEqual(run('AMC006', ''), []);
    assert.deepEqual(check('AMC006', { 'AGENTS.md': '`npm test`\n', 'CLAUDE.md': '@AGENTS.md\n' }, { target: 'CLAUDE.md' }), []);
    assert.deepEqual(check('AMC006', { 'packages/a/AGENTS.md': 'Be nice.\n' }, { target: 'packages/a/AGENTS.md' }), []);
  });
});

describe('AMC007 too-long', () => {
  const lines = (n) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n') + '\n';

  test('over the default budget of 150', () => {
    const [f] = run('AMC007', lines(152));
    assert.equal(f.message, 'File is 152 lines, over the budget of 150');
    assert.equal(f.line, 151);
    assert.equal(f.evidence, 'line 151');
    assert.match(f.suggestion, /^Cut 2 lines/);
  });

  test('exactly at the budget is fine', () => {
    assert.deepEqual(run('AMC007', lines(150)), []);
  });
});

describe('AMC008 tree-dump', () => {
  const tree = '```\nsrc/\n├── a.js\n├── b.js\n└── c.js\n```\n';

  test('fenced tree', () => {
    const [f] = run('AMC008', `# Layout\n\n${tree}`);
    assert.equal(f.severity, 'info');
    assert.equal(f.line, 3);
    assert.equal(f.message, 'Directory tree of 3 lines will go stale');
  });

  test('silent: two-line tree, no tree, ignored tree', () => {
    assert.deepEqual(run('AMC008', '├── a\n└── b\n'), []);
    assert.deepEqual(run('AMC008', '# Plain\nNo tree here.\n'), []);
    assert.deepEqual(run('AMC008', `<!-- amc-ignore-next-line -->\n${tree}`), []);
  });
});

describe('AMC009 missing-boundaries', () => {
  test('neither boundaries nor secrets', () => {
    assert.deepEqual(brief(run('AMC009', '# P\n\nRun `npm test`.\n')), [
      [1, 1, 'No boundaries: nothing says what agents may always do, must ask about, or must never do'],
      [1, 1, 'No rule about secrets'],
    ]);
  });

  test('boundaries lines without a secrets rule', () => {
    assert.deepEqual(brief(run('AMC009', '# P\n- Always: test.\n- Never: push to main.\n')), [[1, 1, 'No rule about secrets']]);
  });

  test('silent with a Boundaries heading and a secrets rule', () => {
    assert.deepEqual(run('AMC009', '# P\n\n## Boundaries\n- Keep .env out of git.\n'), []);
  });

  test('silent: empty, import-only and nested files', () => {
    assert.deepEqual(run('AMC009', ''), []);
    assert.deepEqual(check('AMC009', { 'AGENTS.md': 'x\n', 'CLAUDE.md': '@AGENTS.md\n' }, { target: 'CLAUDE.md' }), []);
    assert.deepEqual(check('AMC009', { 'packages/a/AGENTS.md': 'Use tabs.\n' }, { target: 'packages/a/AGENTS.md' }), []);
  });
});

describe('AMC010 legacy-filename', () => {
  test('codex.md alone: rename suggestion', () => {
    const [f] = check('AMC010', { 'codex.md': '# Hi\n' }, { target: 'codex.md' });
    assert.equal(f.message, '`codex.md` is a legacy name; AGENTS.md is the shared one');
    assert.equal(f.suggestion, 'Rename it: `git mv codex.md AGENTS.md`.');
  });

  test('codex.md next to AGENTS.md: merge suggestion, nested path', () => {
    const files = { 'packages/a/codex.md': 'x\n', 'packages/a/AGENTS.md': 'y\n' };
    const [f] = check('AMC010', files, { target: 'packages/a/codex.md' });
    assert.equal(f.suggestion, 'Merge it into packages/a/AGENTS.md and delete it.');
  });

  const shared = 'Always run the full test suite first.\nNever commit directly to the main branch.\nUse two spaces for indentation everywhere.\n';

  test('CLAUDE.md that copies AGENTS.md instead of importing it', () => {
    const files = { 'AGENTS.md': `# A\n${shared}`, 'CLAUDE.md': `# C\n${shared}Claude only.\n` };
    const [f] = check('AMC010', files, { target: 'CLAUDE.md' });
    assert.equal(f.message, 'CLAUDE.md repeats 3 lines of AGENTS.md without importing it, so the two will drift');
  });

  test('silent: importing, identical, unrelated or alone', () => {
    assert.deepEqual(check('AMC010', { 'AGENTS.md': shared, 'CLAUDE.md': `@AGENTS.md\n${shared}` }, { target: 'CLAUDE.md' }), []);
    assert.deepEqual(check('AMC010', { 'AGENTS.md': shared, 'CLAUDE.md': shared }, { target: 'CLAUDE.md' }), []);
    assert.deepEqual(check('AMC010', { 'AGENTS.md': shared, 'CLAUDE.md': 'Totally different notes about Claude only.\n' }, { target: 'CLAUDE.md' }), []);
    assert.deepEqual(check('AMC010', { 'CLAUDE.md': shared }, { target: 'CLAUDE.md' }), []);
  });
});

describe('AMC011 duplicate-instruction', () => {
  test('same line twice, ignoring list marker, case and punctuation', () => {
    const [f] = run('AMC011', '- Always run the tests first.\n\nOther text here for spacing purposes.\n* always RUN the tests first\n');
    assert.equal(f.severity, 'info');
    assert.equal(f.line, 4);
    assert.equal(f.col, 1);
    assert.equal(f.message, 'Same instruction as line 1');
    assert.equal(f.suggestion, 'Delete this line or line 1.');
  });

  test('silent: short lines, headings, tables, code and ignored lines', () => {
    const md = '# Test\n# Test\nUse tabs.\nUse tabs.\n| a | b c d e |\n| a | b c d e |\n```sh\nrun all of the tests now\nrun all of the tests now\n```\nKeep this line as it is.\n<!-- amc-ignore-next-line -->\nKeep this line as it is.\n';
    assert.deepEqual(run('AMC011', md), []);
  });
});
