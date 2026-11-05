import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeRef, scriptRef } from '../../src/rules/lib/commands.js';
import { closestName, closestPath, distance } from '../../src/rules/lib/suggest.js';
import { tokenize } from '../../src/rules/lib/tokenize.js';
import { isHedged } from '../../src/rules/lib/context.js';

test('tokenize: words, quotes, offsets', () => {
  assert.deepEqual(tokenize('npm  run "a b" \'c d\' e'), [
    { value: 'npm', start: 0 },
    { value: 'run', start: 5 },
    { value: 'a b', start: 9 },
    { value: 'c d', start: 15 },
    { value: 'e', start: 21 },
  ]);
  assert.deepEqual(tokenize('   '), []);
});

test('distance: edits and adjacent swaps', () => {
  assert.equal(distance('build', 'build'), 0);
  assert.equal(distance('buidl', 'build'), 1);
  assert.equal(distance('kitten', 'sitting'), 3);
  assert.equal(distance('', 'abc'), 3);
});

test('closestName', () => {
  const scripts = ['build', 'dev', 'lint:check', 'test'];
  assert.equal(closestName('test:unit', scripts), 'test');
  assert.equal(closestName('lint', scripts), 'lint:check');
  assert.equal(closestName('buidl', scripts), 'build');
  assert.equal(closestName('BUILD', scripts), 'build');
  assert.equal(closestName('deploy', scripts), null);
  assert.equal(closestName('vitest', scripts), 'test');
  assert.equal(closestName('vitest', scripts, { strict: true }), null);
  assert.equal(closestName('x', []), null);
});

test('closestPath', () => {
  const files = ['src/utils/format.ts', 'docs/a/index.md', 'docs/b/index.md', 'README.md', 'src/routes/user.ts'];
  const dirs = ['src', 'src/utils', 'docs', 'docs/a', 'docs/b'];
  assert.equal(closestPath('lib/format.ts', files, dirs), 'src/utils/format.ts');
  assert.equal(closestPath('readme.md', files, dirs), 'README.md');
  assert.equal(closestPath('src/routes/users.ts', files, dirs), 'src/routes/user.ts');
  assert.equal(closestPath('docs/a/index.md', files, dirs), 'docs/a/index.md');
  assert.equal(closestPath('other/index.md', files, dirs), null); // two equally good candidates
  assert.equal(closestPath('src/util', files, dirs), 'src/utils');
  assert.equal(closestPath('nothing/here.ts', files, dirs), null);
});

test('isHedged', () => {
  assert.equal(isHedged('Never run `x`', 11), true);
  assert.equal(isHedged("Don't run `x`", 11), true);
  assert.equal(isHedged('Tools (e.g. `x`)', 13), true);
  assert.equal(isHedged('Run `x` then never mind', 5), false);
  assert.equal(isHedged('Run `x`', 5), false);
});

test('scriptRef: npm', () => {
  const r = (t) => scriptRef(t);
  assert.deepEqual(r('npm run build'), { manager: 'npm', script: 'build', display: 'npm run build', form: 'run', workspace: null });
  assert.equal(r('npm run-script build').script, 'build');
  assert.equal(r('npm run -s build').script, 'build');
  assert.equal(r('npm run build -w web').workspace, 'web');
  assert.equal(r('npm -w web run build').workspace, 'web');
  assert.equal(r('npm run build --workspace=web').workspace, 'web');
  assert.equal(r('npm test').script, 'test');
  assert.equal(r('npm t').form, 'test');
  assert.equal(r('npm start').form, 'start');
  for (const none of ['npm install', 'npm ci', 'npm run', 'npm', 'npm run build --workspaces', 'npm run -ws build', 'npm run x --if-present', 'npm --prefix sub run x', 'npm stop']) {
    assert.equal(r(none), null, none);
  }
});

test('scriptRef: pnpm, yarn, bun', () => {
  assert.equal(scriptRef('pnpm run build').form, 'run');
  assert.equal(scriptRef('pnpm build').form, 'shorthand');
  assert.equal(scriptRef('pnpm --filter web run build').workspace, 'web');
  assert.equal(scriptRef('pnpm -F web build').workspace, 'web');
  assert.equal(scriptRef('pnpm test').form, 'test');
  for (const none of ['pnpm install', 'pnpm add x', 'pnpm exec tsc', 'pnpm dlx x', 'pnpm -r run x', 'pnpm --dir a run x', 'pnpm ./scripts/x.sh']) {
    assert.equal(scriptRef(none), null, none);
  }
  assert.equal(scriptRef('yarn build').script, 'build');
  assert.equal(scriptRef('yarn run build').form, 'run');
  assert.equal(scriptRef('yarn workspace web build').workspace, 'web');
  assert.equal(scriptRef('yarn workspace web run build').script, 'build');
  for (const none of ['yarn', 'yarn install', 'yarn add x', 'yarn workspaces foreach x', 'yarn ./x.js']) {
    assert.equal(scriptRef(none), null, none);
  }
  assert.equal(scriptRef('bun run dev').script, 'dev');
  for (const none of ['bun run src/index.ts', 'bun test', 'bun install', 'bun x tsc']) {
    assert.equal(scriptRef(none), null, none);
  }
  assert.equal(scriptRef('node x.js'), null);
});

test('makeRef', () => {
  assert.deepEqual(makeRef('make build test'), { targets: ['build', 'test'] });
  assert.deepEqual(makeRef('make -j4 -s build VAR=1'), { targets: ['build'] });
  assert.deepEqual(makeRef('make -j 4 build'), { targets: ['build'] });
  for (const none of ['make', 'make -C sub build', 'make -f x.mk build', 'make --directory=sub x', 'npm run x']) {
    assert.equal(makeRef(none), null, none);
  }
});
