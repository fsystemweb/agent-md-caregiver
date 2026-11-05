import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { brief, check } from '../helpers/lint-repo.js';

const PNPM = { 'package.json': '{"scripts":{"build":"x","test":"y"}}', 'pnpm-lock.yaml': '' };
const run = (md, files = PNPM, opts) => check('AMC004', { ...files, 'AGENTS.md': md }, opts);

describe('AMC004 fires', () => {
  test('npm command in a pnpm repo: message, position, suggestion', () => {
    const [f] = run('# Dev\n\n- Build: `npm run build`\n');
    assert.equal(f.ruleId, 'AMC004');
    assert.equal(f.severity, 'warn');
    assert.equal(f.line, 3);
    assert.equal(f.col, 11);
    assert.equal(f.evidence, 'npm run build');
    assert.equal(f.message, '`npm run build`: this repo uses pnpm (pnpm-lock.yaml), not npm');
    assert.equal(f.suggestion, 'Use `pnpm run build`.');
  });

  test('fenced commands, each one reported', () => {
    const out = run('```sh\nnpm install\nnpm test\nyarn build\n```\n');
    assert.deepEqual(
      out.map((f) => [f.line, f.suggestion]),
      [
        [2, 'Use `pnpm install`.'],
        [3, 'Use `pnpm test`.'],
        [4, 'Use `pnpm run build`.'],
      ],
    );
  });

  test('packageManager field wins over the lockfile', () => {
    const files = { 'package.json': '{"packageManager":"yarn@4.1.0"}', 'package-lock.json': '{}' };
    const [f] = run('Run `pnpm install`.', files);
    assert.match(f.message, /this repo uses yarn \(packageManager field: yarn@4\.1\.0\), not pnpm/);
  });

  test('npm repo: bun add package maps to npm install', () => {
    const files = { 'package.json': '{}', 'package-lock.json': '{}' };
    assert.equal(run('`bun add left-pad`', files)[0].suggestion, 'Use `npm install left-pad`.');
  });

  test('directive naming one manager', () => {
    const [f] = run('# Rules\n\nAlways use yarn for dependencies.\n');
    assert.equal(f.message, 'Says to use yarn, but this repo uses pnpm (pnpm-lock.yaml)');
    assert.equal(f.line, 3);
    assert.equal(f.col, 1);
  });

  test('command and directive on the same line: reported once', () => {
    assert.equal(run('Always use `npm install` here.').length, 1);
  });

  test('flags: generic suggestion instead of a guess', () => {
    assert.equal(run('`npm install --save-dev vitest`')[0].suggestion, 'Use pnpm instead of npm here.');
  });

  test('nested file in a repo with a root lockfile', () => {
    const out = check('AMC004', { ...PNPM, 'packages/a/AGENTS.md': 'Run `npm test`.' }, { target: 'packages/a/AGENTS.md' });
    assert.equal(out.length, 1);
  });
});

describe('AMC004 stays silent', () => {
  test('matching manager', () => {
    assert.deepEqual(run('`pnpm install` then `pnpm run build`'), []);
  });

  test('no evidence: no lockfile, no packageManager', () => {
    assert.deepEqual(run('`npm install`', { 'package.json': '{}' }), []);
  });

  test('conflicting lockfiles: nobody can say', () => {
    const files = { 'package.json': '{}', 'pnpm-lock.yaml': '', 'yarn.lock': '' };
    assert.deepEqual(run('`npm install`', files), []);
  });

  test('npx, dlx, publish, login and global installs are fine anywhere', () => {
    const md = '`npx tsc`\n`npm publish`\n`npm login`\n`npm install -g typescript`\n`yarn dlx foo`\n`npm view left-pad`\n';
    assert.deepEqual(run(md), []);
  });

  test('bun as a runtime and bun test are not package-manager calls', () => {
    assert.deepEqual(run('`bun run src/index.ts` and `bun test`'), []);
  });

  test('prohibitions and hedged mentions', () => {
    const md = 'Never use `npm install` here.\nDon\'t use npm.\ne.g. `yarn build` works too.\nAvoid yarn.\n';
    assert.deepEqual(run(md), []);
  });

  test('two managers named in one sentence', () => {
    assert.deepEqual(run('Use pnpm, not npm.'), []);
  });

  test('illustrative blocks and ignore markers', () => {
    assert.deepEqual(run('```text\nnpm install\n```\n<!-- amc-ignore-next-line -->\n`npm install`\n'), []);
  });

  test('nested directory that declares its own manager', () => {
    const files = { ...PNPM, 'packages/a/package-lock.json': '{}', 'packages/a/package.json': '{}' };
    const out = check('AMC004', { ...files, 'packages/a/AGENTS.md': 'Run `npm test`.' }, { target: 'packages/a/AGENTS.md' });
    assert.deepEqual(out, []);
  });

  test('script lookups that are not managers', () => {
    assert.deepEqual(brief(run('`make test` and `node build.js`')), []);
  });
});
