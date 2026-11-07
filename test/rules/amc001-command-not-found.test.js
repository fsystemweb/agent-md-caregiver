import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { brief, check } from '../helpers/lint-repo.js';

const PKG = JSON.stringify({
  scripts: { test: 'node --test', build: 'tsc', 'lint:check': 'eslint .', dev: 'vite' },
});
const run = (md, extra = {}) => check('AMC001', { 'package.json': PKG, 'AGENTS.md': md, ...extra });

describe('AMC001 fires', () => {
  test('npm run with a missing script: message, position, evidence, available scripts', () => {
    const [f] = run('# A\n\nRun `npm run deploy` to ship.\n');
    assert.equal(f.ruleId, 'AMC001');
    assert.equal(f.severity, 'error');
    assert.equal(f.line, 3);
    assert.equal(f.col, 6);
    assert.equal(f.evidence, '`npm run deploy`');
    assert.equal(f.message, '`npm run deploy`: no such script "deploy" in package.json');
    assert.equal(
      f.suggestion,
      'Add a "deploy" script to package.json or remove this command. Available scripts: build, dev, lint:check, test.',
    );
  });

  test('suggests the closest script: colon suffix and typos', () => {
    assert.equal(run('`npm run test:unit`').at(0).suggestion, 'Did you mean `npm run test`?');
    assert.equal(run('`npm run buidl`').at(0).suggestion, 'Did you mean `npm run build`?');
    assert.equal(run('`npm run lint`').at(0).suggestion, 'Did you mean `npm run lint:check`?');
  });

  test('fenced block: exact line and column, prompts and chains', () => {
    const md = ['```bash', '$ npm run nope', 'npm test && npm run also-nope', '```'].join('\n');
    assert.deepEqual(
      run(md).map((f) => [f.line, f.col, f.evidence]),
      [
        [2, 3, '$ npm run nope'],
        [3, 13, 'npm test && npm run also-nope'],
      ],
    );
  });

  test('flags after the script name do not hide a missing script', () => {
    assert.equal(run('`npm run x --loglevel silent`').length, 1);
    assert.equal(run('`npm run x -- --watch`').length, 1);
  });

  test('npm test / npm start without the script', () => {
    const none = { 'package.json': '{"scripts":{"build":"x"}}' };
    assert.equal(run('`npm test`', none).length, 1);
    assert.equal(run('`npm start`', none).length, 1);
    assert.equal(run('`npm t`', none).length, 1);
  });

  test('pnpm: run form always, shorthand only for script-like names', () => {
    assert.equal(run('`pnpm run deploy`').length, 1);
    assert.equal(run('`pnpm lint:fix`').length, 1);
    assert.equal(run('`pnpm start`').length, 1);
    assert.equal(run('`pnpm buidl`').length, 1); // close to "build"
  });

  test('yarn and bun: conventional or colon names only', () => {
    assert.equal(run('`yarn run format`').length, 1);
    assert.equal(run('`yarn typecheck`').length, 1);
    assert.equal(run('`bun run test:e2e`').length, 1);
  });

  test('make: missing target, with did-you-mean or the list of targets', () => {
    const files = { Makefile: '.PHONY: build\nbuild:\n\techo\ntest:\n\techo\n' };
    const [a] = run('Run `make tests`.', files);
    assert.equal(a.message, '`make tests`: the Makefile has no target "tests"');
    assert.equal(a.suggestion, 'Did you mean `make test`?');
    const [b] = run('`make deploy`', files);
    assert.equal(b.suggestion, 'Add a "deploy" target to the Makefile or remove this command. Available targets: build, test.');
    assert.equal(run('```sh\nmake -j4 build deploy\n```', files).length, 1);
  });

  test('workspaces: unknown workspace and missing script inside one', () => {
    const files = {
      'package.json': JSON.stringify({ workspaces: ['packages/*'], scripts: { test: 'x' } }),
      'packages/web/package.json': JSON.stringify({ name: '@acme/web', scripts: { build: 'x' } }),
      'packages/api/package.json': JSON.stringify({ name: '@acme/api' }),
    };
    const unknown = run('`npm run build -w @acme/wbe`', files)[0];
    assert.equal(unknown.message, '`npm run build -w @acme/wbe`: unknown workspace "@acme/wbe"');
    assert.equal(unknown.suggestion, 'Did you mean workspace "@acme/web"?');
    assert.equal(run('`pnpm --filter nothing run build`', files)[0].suggestion, 'Known workspaces: @acme/api, @acme/web.');
    const missing = run('`npm run dev --workspace=@acme/web`', files)[0];
    assert.equal(missing.message, '`npm run dev --workspace=@acme/web`: workspace "@acme/web" has no script "dev"');
    assert.equal(missing.suggestion, 'Available scripts in "@acme/web": build.');
    assert.equal(run('`yarn workspace @acme/api run build`', files).length, 1);
  });

  test('cd in a block moves the command to that directory', () => {
    const files = { 'frontend/package.json': '{"scripts":{"serve":"x"}}' };
    const md = '```sh\ncd frontend\nnpm run preview\nnpm run serve\n```';
    assert.deepEqual(brief(run(md, files)), [[3, 1, '`npm run preview`: no such script "preview" in package.json']]);
  });
});

describe('AMC001 stays silent', () => {
  const silent = (md, extra) => assert.deepEqual(run(md, extra), [], md);

  test('scripts that exist, in every form', () => {
    silent('`npm run build`, `npm test`, `npm run lint:check -- --fix`, `pnpm test`, `pnpm run dev`, `yarn build`, `bun run dev`');
    silent('```sh\nnpm run build && npm test\nCI=1 npm run dev\n```');
  });

  test('non-script commands and binaries', () => {
    silent('`npm install`, `npm ci`, `npx tsc`, `node scripts/x.js`, `pnpm add left-pad`, `pnpm exec tsc`, `yarn add x`');
    silent('`yarn tsc` and `yarn run eslint` and `pnpm vitest` run installed binaries');
    silent('`bun run src/index.ts` and `bun test` and `bun install`');
  });

  test('forms we cannot judge', () => {
    silent('`npm run build --workspaces` and `npm run x --if-present` and `npm run x --prefix sub`');
    silent('`pnpm -r run x` and `pnpm --dir sub run x` and `pnpm --filter "./packages/*" run x`');
  });

  test('no package.json or Makefile in range', () => {
    assert.deepEqual(check('AMC001', { 'AGENTS.md': '`npm run nope` `make nope`' }), []);
  });

  test('placeholders and non-shell fences', () => {
    silent('`npm run <script>` and `make $TARGET`');
    silent('```text\nnpm run nope\n```');
  });

  test('mentioned only in passing: never, avoid, e.g., for example', () => {
    silent('Never run `npm run deploy` by hand.');
    silent('Avoid `npm run clean` here.');
    silent('Scripts (e.g. `npm run lint:fix`) are optional.');
    silent('For example, `npm run release` publishes.');
  });

  test('amc-ignore markers', () => {
    silent('<!-- amc-ignore-next-line -->\nRun `npm run gone`.');
    silent('<!-- amc-ignore -->\n```sh\nnpm run gone\n```');
    silent('Run `npm run gone`. <!-- amc-ignore -->');
  });

  test('npm start falls back to server.js', () => {
    silent('`npm start`', { 'server.js': '', 'package.json': '{"scripts":{}}' });
  });

  test('a script from a parent package.json counts (nested instruction file)', () => {
    const files = { 'packages/a/package.json': '{"scripts":{"only-a":"x"}}', 'packages/a/AGENTS.md': '`npm run only-a` and `npm run build`' };
    assert.deepEqual(check('AMC001', { 'package.json': PKG, ...files }, { target: 'packages/a/AGENTS.md' }), []);
  });

  test('workspaces: found, filters, or none declared', () => {
    const files = {
      'package.json': JSON.stringify({ workspaces: ['packages/*'] }),
      'packages/web/package.json': JSON.stringify({ name: 'web', scripts: { build: 'x' } }),
    };
    silent('`npm run build -w web` and `npm run build -w packages/web` and `pnpm --filter web run build`', files);
    silent('`pnpm --filter "web..." run build` and `pnpm --filter "@a/*" run build`', files);
    silent('`npm run build -w anything`', { 'package.json': PKG }); // no workspaces declared
  });

  test('cd to unknown places', () => {
    silent('```sh\ncd ..\nnpm run nope\n```');
    silent('```sh\ncd $DIR\nnpm run nope\n```');
    silent('```sh\ncd /abs/path\nnpm run nope\n```');
  });

  test('make: found targets, files, includes, other directories', () => {
    const mk = { Makefile: 'build:\n\techo\n', 'main.c': '' };
    silent('`make build` and `make main.c` and `make` and `make -j4 build` and `make VAR=1 build`', mk);
    silent('`make -C sub nope` and `make -f other.mk nope`', mk);
    silent('`make nope`', { Makefile: 'include common.mk\nbuild:\n\techo\n' });
    silent('`make nope`', { Makefile: '%:\n\techo\n' });
  });

  test('a file in the Makefile target list via .PHONY and multi-target rules', () => {
    silent('`make a` `make b` `make c`', { Makefile: '.PHONY: a\nb c:\n\techo\n' });
  });
});

const PY = {
  'pyproject.toml':
    '[project]\nname = "a"\n[project.scripts]\nserve = "a:main"\nmigrate-db = "a:m"\n[tool.poe.tasks]\ntest = "pytest"\nlint = "ruff check"\n',
  'tests/test_a.py': 'import pytest\n',
};
const pyRun = (md, extra = PY) => check('AMC001', { ...extra, 'AGENTS.md': md });

describe('AMC001 Python (#14) fires', () => {
  test('poe task that does not exist, with did-you-mean', () => {
    const [f] = pyRun('# A\n\n- Test: `poe tests`\n');
    assert.equal(f.severity, 'error');
    assert.equal(f.message, '`poe tests`: no Poe task "tests" in pyproject.toml');
    assert.equal(f.suggestion, 'Did you mean `poe test`?');
    assert.equal(pyRun('`uv run poe deploy`')[0].suggestion, 'Add a "deploy" task under [tool.poe.tasks] or remove this command. Available tasks: lint, test.');
  });

  test('uv run / poetry run of a console script one typo away', () => {
    const [f] = pyRun('`uv run serv`');
    assert.equal(f.message, '`uv run serv`: no console script "serv" in pyproject.toml');
    assert.equal(f.suggestion, 'Did you mean `uv run serve`?');
    assert.equal(pyRun('`poetry run migrate_db`').length, 1);
    assert.equal(pyRun('```sh\npoetry run migrate-dbs\n```').length, 1);
  });

  test('pytest in a Python repo that never mentions it', () => {
    const files = { 'pyproject.toml': '[project]\nname="a"\ndependencies=["requests"]\n', 'requirements.txt': 'requests\n' };
    const [f] = pyRun('Run `pytest -q`.', files);
    assert.equal(f.message, '`pytest -q`: nothing in this repo mentions pytest (no dependency, config or conftest.py)');
    assert.equal(pyRun('`python -m pytest`', files).length, 1);
    assert.equal(pyRun('`uv run pytest`', files).length, 1);
  });
});

describe('AMC001 Python stays silent', () => {
  test('existing poe tasks and console scripts', () => {
    assert.deepEqual(pyRun('`poe test` `uv run poe lint` `uv run serve` `poetry run migrate-db`'), []);
  });

  test('tools that are not console scripts, flags, paths, no pyproject', () => {
    assert.deepEqual(pyRun('`uv run ruff check` `uv run python app.py` `uv run --frozen pytest` `uv run ./scripts/x.sh` `poe --help`'), []);
    assert.deepEqual(pyRun('`uv run serv` `poe nothing`', {}), []);
  });

  test('poe tasks defined elsewhere or poe not configured', () => {
    assert.deepEqual(pyRun('`poe anything`', { ...PY, 'poe_tasks.toml': '' }), []);
    assert.deepEqual(pyRun('`poe anything`', { 'pyproject.toml': '[project]\nname="a"\n' }), []);
  });

  test('pytest declared by dependency, config, conftest or lockfile; not a Python repo', () => {
    const base = { 'pyproject.toml': '[project]\nname="a"\n' };
    assert.deepEqual(pyRun('`pytest`', { 'pyproject.toml': '[dependency-groups]\ndev = ["pytest>=8"]\n' }), []);
    assert.deepEqual(pyRun('`pytest`', { ...base, 'pytest.ini': '' }), []);
    assert.deepEqual(pyRun('`pytest`', { ...base, 'tests/conftest.py': '' }), []);
    assert.deepEqual(pyRun('`pytest`', { ...base, 'requirements-dev.txt': 'pytest\n' }), []);
    assert.deepEqual(pyRun('`pytest`', { ...base, 'uv.lock': 'name = "pytest"' }), []);
    assert.deepEqual(pyRun('`pytest`', { 'package.json': '{}' }), []);
  });
});
