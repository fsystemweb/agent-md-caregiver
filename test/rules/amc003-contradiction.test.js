import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { check } from '../helpers/lint-repo.js';

const run = (md, files = {}, opts) => check('AMC003', { ...files, 'AGENTS.md': md }, opts);
const msgs = (out) => out.map((f) => [f.line, f.message]);

describe('AMC003 fires', () => {
  test('package manager: directive vs command, with position and evidence', () => {
    const [f] = run('# Rules\n\nAlways use pnpm.\n\n```sh\nnpm install\n```\n');
    assert.equal(f.ruleId, 'AMC003');
    assert.equal(f.severity, 'error');
    assert.equal(f.line, 6);
    assert.equal(f.col, 1);
    assert.equal(f.evidence, 'npm install');
    assert.equal(f.message, 'Contradicts line 3: that says package manager pnpm, this says npm');
    assert.match(f.suggestion, /Pick one package manager/);
  });

  test('suggestion names the real manager when the repo declares one', () => {
    const files = { 'package.json': '{}', 'pnpm-lock.yaml': '' };
    const [f] = run('Use pnpm for everything.\nThen `yarn install`.', files);
    assert.equal(f.suggestion, 'The repo uses pnpm (pnpm-lock.yaml); change the lines that say otherwise.');
  });

  test('two directives', () => {
    assert.deepEqual(msgs(run('Always use yarn.\nPrefer bun for installs.\n')), [
      [2, 'Contradicts line 1: that says package manager yarn, this says bun'],
    ]);
  });

  test('tabs vs spaces', () => {
    assert.deepEqual(msgs(run('- Always indent with tabs.\n- Always use 2 spaces for indentation.\n')), [
      [2, 'Contradicts line 1: that says indentation tabs, this says 2 spaces'],
    ]);
  });

  test('negation flips the meaning: "never tabs" vs "use tabs"', () => {
    assert.equal(run('Use tabs for indentation.\nNever use tabs for indentation.\n').length, 1);
  });

  test('2 spaces vs 4 spaces', () => {
    assert.deepEqual(msgs(run('Always use 2 spaces for indentation.\nAlways use 4 spaces for indentation.\n')), [
      [2, 'Contradicts line 1: that says indentation 2 spaces, this says 4 spaces'],
    ]);
  });

  test('"tabs, not spaces" is read as tabs', () => {
    assert.equal(run('Use tabs, not spaces.\nUse 2 spaces for indentation.\n').length, 1);
  });

  test('test runner', () => {
    assert.deepEqual(msgs(run('Use vitest for tests.\n\nAlways use jest.\n')), [
      [3, 'Contradicts line 1: that says test runner vitest, this says jest'],
    ]);
  });

  test('"never run X" against "run X"', () => {
    const [f] = run('Never run `npm run clean`.\n\n```sh\nnpm run clean\n```\n');
    assert.equal(f.line, 4);
    assert.equal(f.message, 'Contradicts line 1, which says never to run `npm run clean`');
    assert.equal(f.suggestion, 'Remove one of lines 1 and 4, or say when each applies.');
  });

  test('"run X" first, "never run X" later: reported on the later line', () => {
    const [f] = run('Run `make deploy` to ship.\n\nDo not run `make deploy`.\n');
    assert.equal(f.line, 3);
    assert.equal(f.message, 'Contradicts line 1, which tells agents to run `make deploy`');
  });

  test('CLAUDE.md against the AGENTS.md next to it, reported in CLAUDE.md', () => {
    const files = { 'AGENTS.md': 'Always use pnpm.\n', 'CLAUDE.md': '# Claude\n\nUse npm for installs.\n' };
    assert.deepEqual(check('AMC003', files, { target: 'AGENTS.md' }), []);
    const [f] = check('AMC003', files, { target: 'CLAUDE.md' });
    assert.equal(f.line, 3);
    assert.equal(f.message, 'Contradicts AGENTS.md line 1: that says package manager pnpm, this says npm');
    assert.match(f.suggestion, /@AGENTS\.md/);
  });

  test('nested file against the root file', () => {
    const files = { 'AGENTS.md': 'Always use pnpm.\n', 'packages/a/AGENTS.md': 'Use npm here.\n' };
    const [f] = check('AMC003', files, { target: 'packages/a/AGENTS.md' });
    assert.equal(f.message, 'Contradicts AGENTS.md line 1: that says package manager pnpm, this says npm');
    assert.match(f.suggestion, /deliberate/);
  });

  test('nested test runner differs and the package does not use it', () => {
    const files = { 'AGENTS.md': 'Use vitest.\n', 'packages/a/AGENTS.md': 'Use jest.\n', 'packages/a/package.json': '{}' };
    assert.equal(check('AMC003', files, { target: 'packages/a/AGENTS.md' }).length, 1);
  });
});

describe('AMC003 stays silent', () => {
  test('consistent rules', () => {
    assert.deepEqual(run('Always use pnpm.\n`pnpm install`\nUse 2 spaces for indentation.\nIndent with 2 spaces.\nUse vitest.\n'), []);
  });

  test('"use pnpm, not npm" names both and is not a contradiction', () => {
    assert.deepEqual(run('Use pnpm, not npm.\n`pnpm install`\n'), []);
  });

  test('prohibitions agree with the rest', () => {
    assert.deepEqual(run('Always use pnpm.\nNever use npm.\nDon\'t run `npm install`.\n`pnpm install`\n'), []);
  });

  test('one command per task: npx, publish and global installs are not manager claims', () => {
    assert.deepEqual(run('Always use pnpm.\n`npx tsc`\n`npm publish`\n`npm i -g x`\n'), []);
  });

  test('sections that name their manager are alternatives, not a conflict', () => {
    const md = '## Using npm\n\n`npm install`\n\n## Using yarn\n\n`yarn install`\n';
    assert.deepEqual(run(md), []);
  });

  test('scoped indentation: per language or file type', () => {
    const md = 'Use 2 spaces for indentation in JS.\nUse tabs for indentation in Makefiles and Go.\n';
    assert.deepEqual(run(md), []);
  });

  test('scoped test runners', () => {
    assert.deepEqual(run('Use vitest for unit tests.\nUse playwright for e2e tests.\nUse jest for the legacy package.\n'), []);
  });

  test('a lone "tabs" or "spaces" is not about indentation', () => {
    assert.deepEqual(run('Open the docs in new tabs.\nUse indentation of 2 spaces.\nSeparate words with spaces.\n'), []);
  });

  test('conditional prohibitions', () => {
    assert.deepEqual(run('Never run `npm start` in CI.\n\n```sh\nnpm start\n```\n'), []);
    assert.deepEqual(run('Don\'t run `make deploy` unless asked.\n```sh\nmake deploy\n```\n'), []);
  });

  test('similar but different commands', () => {
    assert.deepEqual(run('Never run `git push --force`.\n```sh\ngit push --force-with-lease\n```\n'), []);
  });

  test('hedged examples and ignore markers', () => {
    const md = 'Always use pnpm.\ne.g. `npm install` is what others do.\n<!-- amc-ignore-next-line -->\nUse npm for the docs site.\n';
    assert.deepEqual(run(md), []);
  });

  test('a file that contradicts itself is not also reported against its parent', () => {
    const files = { 'AGENTS.md': 'Use pnpm.\nUse yarn.\n', 'packages/a/AGENTS.md': 'Use npm.\n' };
    assert.deepEqual(check('AMC003', files, { target: 'packages/a/AGENTS.md' }), []);
  });

  test('nested directory with its own lockfile may use another manager', () => {
    const files = {
      'AGENTS.md': 'Always use pnpm.\n',
      'packages/a/AGENTS.md': 'Use npm here.\n',
      'packages/a/package.json': '{}',
      'packages/a/package-lock.json': '{}',
    };
    assert.deepEqual(check('AMC003', files, { target: 'packages/a/AGENTS.md' }), []);
  });

  test('nested package that uses its own test runner', () => {
    const files = {
      'AGENTS.md': 'Use vitest.\n',
      'packages/a/AGENTS.md': 'Use jest.\n',
      'packages/a/package.json': '{"devDependencies":{"jest":"^29"}}',
    };
    assert.deepEqual(check('AMC003', files, { target: 'packages/a/AGENTS.md' }), []);
  });

  test('nested indentation is not compared with the root', () => {
    const files = { 'AGENTS.md': 'Indent with tabs.\n', 'packages/a/AGENTS.md': 'Indent with 2 spaces.\n' };
    assert.deepEqual(check('AMC003', files, { target: 'packages/a/AGENTS.md' }), []);
  });

  test('CLAUDE.md that only imports AGENTS.md, and identical copies', () => {
    const same = 'Always use pnpm.\n';
    assert.deepEqual(check('AMC003', { 'AGENTS.md': same, 'CLAUDE.md': '@AGENTS.md\n' }, { target: 'CLAUDE.md' }), []);
    assert.deepEqual(check('AMC003', { 'AGENTS.md': same, 'CLAUDE.md': same }, { target: 'CLAUDE.md' }), []);
  });
});
