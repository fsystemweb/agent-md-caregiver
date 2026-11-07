import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { hasGit } from '../helpers/make-repo.js';
import { check } from '../helpers/lint-repo.js';

const TREE = {
  'src/routes/user.ts': '',
  'src/utils/format.ts': 'x'.repeat(200),
  'docs/setup.md': '',
  'README.md': '',
  'scripts/build.js': '',
  'tests/test_api.py': '',
  '.gitignore': 'dist/\n.env\ncoverage/\n',
};
const run = (md, extra = {}, opts) => check('AMC002', { ...TREE, 'AGENTS.md': md, ...extra }, opts);

describe('AMC002 stays silent when unsure (#11)', () => {
  test('subfolder-relative file and directory', () => {
    const files = { 'frontend/src/main.tsx': '', 'backend/appsettings.json': '{}' };
    assert.deepEqual(run('Entry is `main.tsx`; settings in `appsettings.json`; also `utils/format.ts`.', files), []);
    assert.deepEqual(run('See `routes/user.ts`.'), []);
    assert.deepEqual(run('See `./main.tsx`.', files), []);
  });

  test('package specifiers', () => {
    assert.deepEqual(run('Import from `three@0.160.0/examples/jsm/`, `@scope/pkg@1.2.3/dist/x.js`.'), []);
  });

  test('still fires when nothing ends with the path', () => {
    assert.equal(run('`main.tsx`')[0].message, '`main.tsx` does not exist');
    assert.equal(run('`app/main.tsx`', { 'src/main.tsx': '' }).length, 1);
  });
});

describe('AMC002 fires', () => {
  test('missing file: message, position, evidence', () => {
    const [f] = run('# A\n\nHandlers live in `src/routes/users.ts`.\n');
    assert.equal(f.ruleId, 'AMC002');
    assert.equal(f.severity, 'error');
    assert.equal(f.line, 3);
    assert.equal(f.col, 19);
    assert.equal(f.evidence, '`src/routes/users.ts`');
    assert.equal(f.message, '`src/routes/users.ts` does not exist');
    assert.equal(f.suggestion, 'Did you mean `src/routes/user.ts`?');
  });

  test('suggestions: unique basename elsewhere, case difference, nothing close', () => {
    assert.equal(run('`lib/format.ts`')[0].suggestion, 'Did you mean `src/utils/format.ts`?');
    assert.equal(run('`readme.md`')[0].suggestion, 'Did you mean `README.md`?');
    assert.equal(run('`src/other/thing.ts`')[0].suggestion, 'Fix the path or remove the reference.');
  });

  test('missing directory (trailing slash) and a dir whose parent exists', () => {
    assert.equal(run('See `src/handlers/`.').length, 1);
    assert.equal(run('See `src/handlers`.').length, 1);
  });

  test('file arguments of node, python and pytest', () => {
    const md = ['```sh', 'node scripts/deploy.js', 'python3 tools/run.py --fast', 'pytest tests/test_nope.py::test_x', '```'].join('\n');
    assert.deepEqual(
      run(md).map((f) => [f.line, f.col, f.message]),
      [
        [2, 6, '`scripts/deploy.js` does not exist'],
        [3, 9, '`tools/run.py` does not exist'],
        [4, 8, '`tests/test_nope.py` does not exist'],
      ],
    );
  });

  test('strips :line references', () => {
    assert.equal(run('`src/routes/users.ts:42`')[0].message, '`src/routes/users.ts` does not exist');
  });

  test('nested instruction file: relative to it or to the repo root, neither exists', () => {
    const files = { 'packages/a/AGENTS.md': '`src/x.ts` `README.md` `local.ts`', 'packages/a/local.ts': '' };
    const out = check('AMC002', { ...TREE, ...files }, { target: 'packages/a/AGENTS.md' });
    assert.deepEqual(out.map((f) => f.message), ['`src/x.ts` does not exist']);
  });

  test('after cd, file arguments resolve from that directory', () => {
    const md = '```sh\ncd scripts\nnode build.js\nnode nope.js\n```';
    assert.deepEqual(run(md).map((f) => f.message), ['`nope.js` does not exist']);
  });
});

describe('AMC002 uses git history', { skip: !hasGit && 'git not installed' }, () => {
  test('a rename is reported as a rename', () => {
    const f = run('Read `docs/setup.md`.', { 'docs/setup.md': 'content '.repeat(40) }, {
      git: true,
      setup: (r) => {
        r.mv('docs/setup.md', 'docs/install.md');
        r.commit('rename');
      },
    });
    assert.equal(f.length, 1);
    assert.equal(f[0].suggestion, 'Renamed to `docs/install.md` in git history. Replace the path.');
  });

  test('git ignores are honored too', () => {
    assert.deepEqual(run('`dist/out.js` `coverage/index.html` `.env`', {}, { git: true }), []);
  });
});

describe('AMC002 stays silent', () => {
  const silent = (md, extra) => assert.deepEqual(run(md, extra), [], md);

  test('paths that exist', () => {
    silent('`src/routes/user.ts`, `src/routes`, `src/routes/`, `./README.md`, `scripts/build.js:3`, `docs/`');
    silent('```sh\nnode scripts/build.js\npython tests/test_api.py\npytest tests/test_api.py::test_ok\n```');
  });

  test('ignored by .gitignore, even when not on disk', () => {
    silent('`dist/index.js`, `dist/`, `.env`, `coverage/lcov.info`');
  });

  test('on disk but not tracked', () => {
    assert.deepEqual(
      check('AMC002', { ...TREE, 'AGENTS.md': '`tmp/cache.json`' }, { setup: (r) => r.write('tmp/cache.json', '{}') }),
      [],
    );
  });

  test('things that are not repo paths', () => {
    silent('`/etc/hosts`, `~/.config/x.json`, `C:\\Users\\x.txt`, `/init`, `/api/users`');
    silent('`https://example.com/a/b.md`, `src/**/*.ts`, `path/to/<name>.md`, `path/to/file.js`, `$HOME/x.js`');
    silent('`Node.js`, `Next.js`, `and/or`, `@types/node`, `node_modules/x/index.js`');
  });

  test('extensionless names under a directory that does not exist look like routes', () => {
    silent('Call `api/users` or `v1/orders/list`.');
  });

  test('mentioned only in passing', () => {
    silent('Never edit `src/legacy/old.ts`.');
    silent("Don't touch `src/gone.ts`.");
    silent('Layouts vary (e.g. `src/features/x.ts`).');
    silent('For example, `config/app.yml`.');
  });

  test('links and imports belong to AMC005', () => {
    silent('[guide](docs/nope.md) and\n@docs/nope.md');
  });

  test('non-shell fences, quotes, ignore markers', () => {
    silent('```text\nnode nope.js\n```');
    silent('> see `nope/x.ts`');
    silent('<!-- amc-ignore-next-line -->\nSee `nope/x.ts`.');
    silent('See `nope/x.ts`. <!-- amc-ignore -->');
  });

  test('node -e and python -m are code, not files', () => {
    silent('```sh\nnode -e "require(\'x\')"\npython -m pytest tests/\nnode --require ./scripts/build.js scripts/build.js\n```');
  });

  test('unknown cd target', () => {
    silent('```sh\ncd ..\nnode nope.js\n```');
  });
});

describe('AMC002 Python layouts (#14)', () => {
  const files = {
    'pyproject.toml': '[project]\nname="a"\n',
    'src/app/__init__.py': '',
    'src/app/models.py': '',
    'src/app/api/routes.py': '',
    'tests/test_models.py': '',
  };
  test('src/ layout: package paths written without src/ stay silent', () => {
    assert.deepEqual(run('Models are in `app/models.py`, routes in `app/api/routes.py`, package `app/`.', files), []);
  });

  test('__init__.py and file arguments of python and pytest', () => {
    assert.deepEqual(run('`src/app/__init__.py`\n\n```sh\npytest tests/test_models.py::test_x\npython -m app.cli\n```\n', files), []);
  });

  test('still fires for a module that does not exist', () => {
    assert.equal(run('`app/missing.py`', files)[0].message, '`app/missing.py` does not exist');
    assert.equal(run('```sh\npytest tests/test_nope.py\n```', files).length, 1);
  });
});
