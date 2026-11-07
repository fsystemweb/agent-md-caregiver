import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { createRepoContext, normalizeRepoPath } from '../src/repo/index.js';
import { parseGitignore, matchIgnore } from '../src/repo/gitignore.js';
import { isOpaqueMakefile, parseMakeTargets } from '../src/repo/makefile.js';
import { hasGit, makeRepo } from './helpers/make-repo.js';

const cleanups = [];
after(() => cleanups.forEach((fn) => fn()));
function repo(files, opts) {
  const r = makeRepo(files, opts);
  cleanups.push(r.cleanup);
  return r;
}

const NODE_PROJECT = {
  'package.json': JSON.stringify({
    name: 'demo',
    scripts: { build: 'tsc', test: 'node --test', 'test:ci': 'npm test', bad: 42 },
    engines: { node: '>=20' },
    packageManager: 'pnpm@9.1.0+sha512.abc',
  }),
  'pnpm-lock.yaml': '',
  'src/index.js': '',
  'src/util/helpers.js': '',
  'README.md': '',
  '.gitignore': 'dist/\n*.log\n!keep.log\n/secret.txt\n',
  'dist/out.js': '',
  'debug.log': '',
  'keep.log': '',
  'secret.txt': '',
  'sub/secret.txt': '',
  'node_modules/dep/index.js': '',
};

// The same expectations must hold with git and without it.
const MODES = [
  { name: 'filesystem walk (no git)', git: false },
  ...(hasGit ? [{ name: 'git work tree', git: true }] : []),
];

for (const mode of MODES) {
  describe(`RepoContext: ${mode.name}`, () => {
    const make = (files) => {
      const r = repo(files, { git: mode.git });
      return { r, ctx: createRepoContext(r.root) };
    };

    test('isGit reflects the mode', () => {
      assert.equal(make(NODE_PROJECT).ctx.isGit, mode.git);
    });

    test('file tree respects .gitignore and never lists node_modules or .git', () => {
      const { ctx } = make(NODE_PROJECT);
      assert.deepEqual(ctx.files(), [
        '.gitignore',
        'README.md',
        'keep.log',
        'package.json',
        'pnpm-lock.yaml',
        'src/index.js',
        'src/util/helpers.js',
        'sub/secret.txt',
      ]);
      assert.deepEqual(ctx.dirs(), ['src', 'src/util', 'sub']);
    });

    test('hasPath: files, dirs, trailing slashes, ./ prefixes; ignored and outside paths do not exist', () => {
      const { ctx } = make(NODE_PROJECT);
      for (const p of ['src', 'src/', './src/index.js', 'src/util', 'README.md', 'sub/secret.txt', '.']) {
        assert.equal(ctx.hasPath(p), true, p);
      }
      for (const p of ['dist', 'dist/out.js', 'debug.log', 'secret.txt', 'src/nope.js', '../x', '/etc/passwd', '~/x']) {
        assert.equal(ctx.hasPath(p), false, p);
      }
    });

    test('existsOnDisk sees ignored files but never leaves the root', () => {
      const { ctx } = make(NODE_PROJECT);
      assert.equal(ctx.existsOnDisk('dist/'), true);
      assert.equal(ctx.existsOnDisk('secret.txt'), true);
      assert.equal(ctx.existsOnDisk('nope'), false);
      assert.equal(ctx.existsOnDisk('../'), false);
      assert.equal(ctx.existsOnDisk('/etc/passwd'), false);
    });

    test('package.json: scripts, engines, packageManager, lockfiles', () => {
      const { ctx } = make(NODE_PROJECT);
      assert.deepEqual(ctx.scripts(), { build: 'tsc', test: 'node --test', 'test:ci': 'npm test' });
      assert.deepEqual(ctx.engines(), { node: '>=20' });
      assert.deepEqual(ctx.packageManager(), {
        name: 'pnpm',
        version: '9.1.0',
        raw: 'pnpm@9.1.0+sha512.abc',
      });
      assert.deepEqual(ctx.lockfiles(), [{ file: 'pnpm-lock.yaml', manager: 'pnpm' }]);
    });

    test('no package.json, invalid package.json, no Makefile: empty answers, no throw', () => {
      const none = make({ 'a.txt': '' }).ctx;
      assert.equal(none.packageJson(), null);
      assert.deepEqual(none.scripts(), {});
      assert.equal(none.packageManager(), null);
      assert.deepEqual(none.lockfiles(), []);
      assert.deepEqual(none.workspaces(), []);
      assert.equal(none.makefile(), null);
      assert.deepEqual(none.makeTargets(), []);
      const broken = make({ 'package.json': '{ not json' }).ctx;
      assert.equal(broken.packageJson(), null);
      assert.deepEqual(broken.scripts(), {});
    });

    test('several lockfiles are all reported', () => {
      const { ctx } = make({ 'package-lock.json': '{}', 'yarn.lock': '', 'bun.lockb': '' });
      assert.deepEqual(
        ctx.lockfiles().map((l) => l.manager),
        ['npm', 'yarn', 'bun'],
      );
    });

    test('workspaces from package.json (array and { packages }) with names and scripts', () => {
      const files = {
        'package.json': JSON.stringify({ workspaces: ['packages/*', '!packages/legacy', 'tools/cli'] }),
        'packages/a/package.json': JSON.stringify({ name: '@x/a', scripts: { build: 'x', lint: 'y' } }),
        'packages/b/package.json': JSON.stringify({ name: '@x/b' }),
        'packages/legacy/package.json': JSON.stringify({ name: '@x/legacy' }),
        'packages/docs/readme.md': '',
        'tools/cli/package.json': JSON.stringify({}),
      };
      const { ctx } = make(files);
      assert.deepEqual(ctx.workspaces(), [
        { dir: 'packages/a', name: '@x/a', scripts: ['build', 'lint'] },
        { dir: 'packages/b', name: '@x/b', scripts: [] },
        { dir: 'tools/cli', name: null, scripts: [] },
      ]);
      const obj = make({
        ...files,
        'package.json': JSON.stringify({ workspaces: { packages: ['packages/*'] } }),
      }).ctx;
      assert.equal(obj.workspaces().length, 3);
    });

    test('workspaces from pnpm-workspace.yaml', () => {
      const { ctx } = make({
        'package.json': '{}',
        'pnpm-workspace.yaml': "packages:\n  - 'apps/*'\n  - \"libs/**\"\n  - '!apps/old'\ncatalog:\n  - nope\n",
        'apps/web/package.json': '{"name":"web"}',
        'apps/old/package.json': '{"name":"old"}',
        'libs/core/deep/package.json': '{"name":"core"}',
      });
      assert.deepEqual(ctx.workspacePatterns(), ['apps/*', 'libs/**', '!apps/old']);
      assert.deepEqual(
        ctx.workspaces().map((w) => w.name),
        ['web', 'core'],
      );
    });

    test('Makefile targets', () => {
      const { ctx } = make({
        Makefile: [
          'CC := gcc',
          '.PHONY: all test',
          'all: build test',
          'build test:',
          '\t@echo hi',
          '%.o: %.c',
          '\t$(CC) -c $<',
          '$(BIN): main.o',
          'lint: ## run linter',
          'deploy::',
          '.DEFAULT_GOAL := all',
          '# comment: not a target',
        ].join('\n'),
      });
      assert.equal(ctx.makefile(), 'Makefile');
      assert.deepEqual(ctx.makeTargets(), ['all', 'build', 'deploy', 'lint', 'test']);
    });

    test('isIgnored: patterns, directories, non-existent paths, node_modules', () => {
      const { ctx } = make(NODE_PROJECT);
      for (const p of ['dist', 'dist/', 'dist/out.js', 'dist/not/there.js', 'debug.log', 'a/b/c.log', 'secret.txt', 'node_modules/x', '.git/config']) {
        assert.equal(ctx.isIgnored(p), true, p);
      }
      for (const p of ['src', 'src/index.js', 'keep.log', 'sub/secret.txt', 'README.md', '', '../x', '/abs']) {
        assert.equal(ctx.isIgnored(p), false, p);
      }
    });

    test('isIgnored: nested .gitignore applies below its directory only', () => {
      const { ctx } = make({
        '.gitignore': '',
        'pkg/.gitignore': 'build/\n*.tmp\n',
        'pkg/src/a.js': '',
      });
      assert.equal(ctx.isIgnored('pkg/build/x.js'), true);
      assert.equal(ctx.isIgnored('pkg/src/b.tmp'), true);
      assert.equal(ctx.isIgnored('build/x.js'), false);
      assert.equal(ctx.isIgnored('other/b.tmp'), false);
    });

    test('packageJsonAt / scriptsAt / makeAt for subdirectories', () => {
      const { ctx } = make({
        'package.json': '{"scripts":{"a":"x"}}',
        'web/package.json': '{"scripts":{"b":"y"}}',
        'web/Makefile': 'all:\n\techo\n',
        'lib/Makefile': 'include x.mk\nall:\n\techo\n',
      });
      assert.deepEqual(ctx.scriptsAt(''), { a: 'x' });
      assert.deepEqual(ctx.scriptsAt('web'), { b: 'y' });
      assert.deepEqual(ctx.scriptsAt('web/'), { b: 'y' });
      assert.equal(ctx.scriptsAt('lib'), null);
      assert.equal(ctx.scriptsAt('../up'), null);
      assert.deepEqual(ctx.makeAt('web'), { exists: true, targets: ['all'], opaque: false });
      assert.deepEqual(ctx.makeAt('lib'), { exists: true, targets: ['all'], opaque: true });
      assert.deepEqual(ctx.makeAt(''), { exists: false, targets: [], opaque: false });
    });

    test('results are cached', () => {
      const { r, ctx } = make(NODE_PROJECT);
      assert.equal(ctx.files(), ctx.files());
      r.write('late.txt', '');
      assert.equal(ctx.hasPath('late.txt'), false);
      assert.equal(createRepoContext(r.root).hasPath('late.txt'), true);
    });
  });
}

describe('RepoContext: rename history', { skip: !hasGit && 'git not installed' }, () => {
  test('follows a file rename', () => {
    const r = repo({ 'docs/setup.md': 'x'.repeat(200), 'keep.txt': '' }, { git: true });
    r.mv('docs/setup.md', 'docs/install.md');
    r.commit('rename');
    const ctx = createRepoContext(r.root);
    assert.deepEqual(ctx.renames(), [{ from: 'docs/setup.md', to: 'docs/install.md' }]);
    assert.equal(ctx.findRenamed('docs/setup.md'), 'docs/install.md');
    assert.equal(ctx.findRenamed('./docs/setup.md'), 'docs/install.md');
    assert.equal(ctx.findRenamed('keep.txt'), null);
    assert.equal(ctx.findRenamed('never/existed.md'), null);
  });

  test('follows a chain a → b → c to where the file lives now', () => {
    const r = repo({ 'a.md': 'y'.repeat(200) }, { git: true });
    r.mv('a.md', 'b.md');
    r.commit('a to b');
    r.mv('b.md', 'c.md');
    r.commit('b to c');
    const ctx = createRepoContext(r.root);
    assert.deepEqual(
      ctx.renames().map((x) => `${x.from}>${x.to}`),
      ['a.md>b.md', 'b.md>c.md'],
    );
    assert.equal(ctx.findRenamed('a.md'), 'c.md');
    assert.equal(ctx.findRenamed('b.md'), 'c.md');
  });

  test('a renamed file that was deleted afterwards is not suggested', () => {
    const r = repo({ 'a.md': 'z'.repeat(200) }, { git: true });
    r.mv('a.md', 'b.md');
    r.commit('rename');
    r.mv('b.md', 'c.md');
    r.commit('rename again');
    const ctx = createRepoContext(r.root);
    assert.equal(ctx.findRenamed('a.md'), 'c.md');
    const gone = repo({ 'a.md': 'q'.repeat(200) }, { git: true });
    gone.mv('a.md', 'b.md');
    gone.commit('rename');
    gone.write('b.md', ''); // still there
    assert.equal(createRepoContext(gone.root).findRenamed('a.md'), 'b.md');
  });

  test('follows a directory move', () => {
    const r = repo(
      { 'scripts/a.sh': 'a'.repeat(200), 'scripts/b.sh': 'b'.repeat(200), 'other.md': '' },
      { git: true },
    );
    r.mv('scripts/a.sh', 'tools/a.sh');
    r.mv('scripts/b.sh', 'tools/b.sh');
    r.commit('move dir');
    const ctx = createRepoContext(r.root);
    assert.equal(ctx.findRenamed('scripts'), 'tools');
    assert.equal(ctx.findRenamed('scripts/'), 'tools');
  });

  test('without git history there are no renames', () => {
    const r = repo({ 'a.md': 'x'.repeat(200) });
    r.mv('a.md', 'b.md');
    assert.deepEqual(createRepoContext(r.root).renames(), []);
    assert.equal(createRepoContext(r.root).findRenamed('a.md'), null);
  });

  test('useGit: false forces the filesystem walk', () => {
    const r = repo({ 'a.md': 'x'.repeat(200), '.gitignore': 'x\n' }, { git: true });
    r.mv('a.md', 'b.md');
    r.commit('rename');
    const ctx = createRepoContext(r.root, { useGit: false });
    assert.equal(ctx.isGit, false);
    assert.deepEqual(ctx.renames(), []);
    assert.deepEqual(ctx.files(), ['.gitignore', 'b.md']);
  });
});

describe('RepoContext: git-specific file tree', { skip: !hasGit && 'git not installed' }, () => {
  test('files deleted from disk but still tracked are not listed', () => {
    const r = repo({ 'a.txt': '', 'b.txt': '' }, { git: true });
    r.mv('b.txt', 'c.txt'); // staged rename, then delete c.txt on disk
    rmSync(join(r.root, 'c.txt'));
    assert.deepEqual(createRepoContext(r.root).files(), ['a.txt']);
  });

  test('untracked files that are not ignored are listed', () => {
    const r = repo({ 'a.txt': '', '.gitignore': 'ignored.txt\n' }, { git: true });
    r.write('new.txt', '');
    r.write('ignored.txt', '');
    assert.deepEqual(createRepoContext(r.root).files(), ['.gitignore', 'a.txt', 'new.txt']);
  });
});

describe('gitignore matcher', () => {
  const ignored = (patterns, path, isDir = false) =>
    matchIgnore(parseGitignore(patterns), path, isDir) === true;

  test('basics', () => {
    assert.equal(ignored('*.log', 'a.log'), true);
    assert.equal(ignored('*.log', 'deep/er/a.log'), true);
    assert.equal(ignored('*.log', 'a.txt'), false);
    assert.equal(ignored('# c\n\n', 'c'), false);
  });

  test('anchoring and directory-only', () => {
    assert.equal(ignored('/build', 'build', true), true);
    assert.equal(ignored('/build', 'src/build', true), false);
    assert.equal(ignored('build/', 'build', true), true);
    assert.equal(ignored('build/', 'build', false), false);
    assert.equal(ignored('docs/_site', 'docs/_site', true), true);
    assert.equal(ignored('docs/_site', 'x/docs/_site', true), false);
  });

  test('negation: last match wins', () => {
    assert.equal(ignored('*.log\n!keep.log', 'keep.log'), false);
    assert.equal(ignored('!keep.log\n*.log', 'keep.log'), true);
  });

  test('double star and character classes', () => {
    assert.equal(ignored('a/**/z', 'a/z'), true);
    assert.equal(ignored('a/**/z', 'a/b/c/z'), true);
    assert.equal(ignored('logs/**', 'logs/x/y'), true);
    assert.equal(ignored('file?.txt', 'file1.txt'), true);
    assert.equal(ignored('file?.txt', 'file12.txt'), false);
    assert.equal(ignored('[ab].txt', 'a.txt'), true);
    assert.equal(ignored('[!ab].txt', 'a.txt'), false);
    assert.equal(ignored('\\#hash', '#hash'), true);
  });
});

describe('isOpaqueMakefile', () => {
  test('include and catch-all rules make the target list untrustworthy', () => {
    assert.equal(isOpaqueMakefile('include common.mk\n'), true);
    assert.equal(isOpaqueMakefile('-include common.mk\n'), true);
    assert.equal(isOpaqueMakefile('%:\n\t@echo\n'), true);
    assert.equal(isOpaqueMakefile('.DEFAULT:\n\t@echo\n'), true);
    assert.equal(isOpaqueMakefile('build:\n\techo include\n'), false);
    assert.equal(isOpaqueMakefile('%.o: %.c\n'), false);
  });
});

describe('parseMakeTargets', () => {
  test('ignores assignments, recipes, comments and pattern rules', () => {
    const text = 'A = b\nB ?= c\nC += d\nD ::= e\n\ttarget_in_recipe: x\n# t: y\n%.o: %.c\nreal: dep VAR=1\n';
    assert.deepEqual(parseMakeTargets(text), ['real']);
  });
});

describe('normalizeRepoPath', () => {
  test('normalizes and rejects', () => {
    assert.equal(normalizeRepoPath('./a//b/../c/'), 'a/c');
    assert.equal(normalizeRepoPath('.'), '');
    assert.equal(normalizeRepoPath('a\\b.md'), 'a/b.md');
    for (const bad of ['', '/abs', '~/x', '../up', 'a/../../up', 'C:\\x']) {
      assert.equal(normalizeRepoPath(bad), null, bad);
    }
  });
});

describe('git pathspec magic in a path written in a checked file is taken literally (security audit hardening)', () => {
  test('`:(top)secret.txt` is not treated as the ignored file `secret.txt`', { skip: !hasGit }, () => {
    const r = makeRepo({ '.gitignore': 'secret.txt\n', 'secret.txt': 'x', 'AGENTS.md': '# A\n' }, { git: true });
    try {
      const repo = createRepoContext(r.root);
      assert.equal(repo.isIgnored('secret.txt'), true);
      assert.equal(repo.isIgnored(':(top)secret.txt'), false);
    } finally {
      r.cleanup();
    }
  });
});
