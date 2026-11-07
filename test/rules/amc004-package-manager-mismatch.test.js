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

const UV = { 'pyproject.toml': '[project]\nname = "a"\n[tool.uv]\n', 'uv.lock': '' };
const pyRun = (md, files = UV, opts) => run(md, files, opts);

describe('AMC004 Python (#14) fires', () => {
  test('pip install in a uv repo: translated to uv add', () => {
    const [f] = pyRun('# Dev\n\n- Add deps: `pip install requests`\n');
    assert.equal(f.severity, 'warn');
    assert.equal(f.message, '`pip install requests`: this repo uses uv (uv.lock), not pip');
    assert.equal(f.suggestion, 'Use `uv add requests`.');
  });

  test('python -m pip, pip3, versions and extras', () => {
    const out = pyRun('```sh\npython -m pip install "httpx[http2]>=0.27"\npip3 install rich\n```\n');
    assert.deepEqual(out.map((f) => f.suggestion), ['Use `uv add httpx[http2]>=0.27`.', 'Use `uv add rich`.']);
  });

  test('directive: "use pip" in a uv repo', () => {
    const [f] = pyRun('Always use pip for dependencies.\n');
    assert.equal(f.message, 'Says to use pip, but this repo uses uv (uv.lock)');
  });

  test('[tool.poetry] and poetry.lock mean poetry; uv sync suggests poetry install', () => {
    const [f] = pyRun('`uv sync`', { 'pyproject.toml': '[tool.poetry]\nname="a"\n' });
    assert.equal(f.suggestion, 'Use `poetry install`.');
    assert.equal(pyRun('`pip install x`', { 'poetry.lock': '', 'pyproject.toml': '[project]\nname="a"\n' })[0].suggestion, 'Use `poetry add x`.');
  });

  test('uv project commands in a requirements-only repo', () => {
    const files = { 'requirements.txt': 'requests\n' };
    const out = pyRun('```sh\nuv add requests\nuv sync\n```\n', files);
    assert.deepEqual(out.map((f) => f.suggestion), ['Use `pip install requests`.', 'Use pip instead of uv here.']);
    assert.equal(out[0].message, '`uv add requests`: this repo uses pip (requirements.txt), not uv');
  });
});

describe('AMC004 Python stays silent', () => {
  test('commands valid in any repo', () => {
    const md = [
      '```sh',
      'python -m venv .venv',
      'pip install -r requirements.txt',
      'pip install -e .',
      'pip install .',
      'pip install --upgrade pip',
      'pip install uv',
      'python -m pip install -U pip',
      'uvx ruff check',
      'pipx install poetry',
      'uv pip install requests',
      'uv tool install ruff',
      'uv venv',
      '```',
    ].join('\n');
    assert.deepEqual(pyRun(md), []);
    assert.deepEqual(pyRun(md, { 'poetry.lock': '' }), []);
  });

  test('requirements-only repo: uv pip, "use uv" and plain pip are fine', () => {
    const files = { 'requirements.txt': 'x\n' };
    assert.deepEqual(pyRun('Use uv. `uv run pytest`. `pip install x`.', files), []);
  });

  test('matching manager, conflicting evidence, unreadable pyproject, no evidence', () => {
    assert.deepEqual(pyRun('`uv add requests` `uv sync`'), []);
    assert.deepEqual(pyRun('`pip install x`', { 'uv.lock': '', 'poetry.lock': '' }), []);
    assert.deepEqual(pyRun('`pip install x`', { 'pyproject.toml': '{{{', 'requirements.txt': '' }), []);
    assert.deepEqual(pyRun('`uv add x`', { 'pyproject.toml': '[project]\nname="a"\n' }), []);
    assert.deepEqual(pyRun('`pip install x`', {}), []);
  });

  test('a line naming both ecosystems, a negation, a hedge, a scoped heading', () => {
    assert.deepEqual(pyRun('Use pnpm for the frontend and pip for scripts.\n', { ...UV, ...PNPM }), []);
    assert.deepEqual(pyRun('Never use pip here.\n'), []);
    assert.deepEqual(pyRun('For example, `pip install requests`.\n'), []);
  });

  test('JavaScript behavior is unchanged in a mixed repo', () => {
    const files = { ...UV, ...PNPM };
    assert.equal(pyRun('`npm run build`', files)[0].suggestion, 'Use `pnpm run build`.');
    assert.equal(pyRun('`pip install x`', files)[0].suggestion, 'Use `uv add x`.');
  });
});
