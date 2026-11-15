import assert from 'node:assert/strict';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { run } from '../src/cli.js';
import { applyIgnores, DEFAULT_IGNORES, invalidIgnorePattern, staleIgnores } from '../src/ignore.js';
import { hasGit, makeRepo } from './helpers/make-repo.js';

const cleanups = [];
after(() => cleanups.forEach((fn) => fn()));

/** Clean, checkable repo file. */
const OWN = '# Repo\n\n`npm test`\n\n## Boundaries\n- Never: commit secrets.\n';
/** A long, self-contradicting third-party file: fires AMC007 and AMC003 wherever it is checked. */
const VENDORED =
  '# Skill\n\n- Always use pnpm.\n- Never use pnpm.\n' +
  Array.from({ length: 300 }, (_, i) => `Use rule ${i} carefully and keep code clean.`).join('\n') +
  '\n';
const PKG = JSON.stringify({ name: 'x', scripts: { test: 'node --test' } });

function cli(argv, files, { git = false, cwd = '' } = {}) {
  const r = makeRepo(files, { git });
  cleanups.push(r.cleanup);
  let stdout = '';
  let stderr = '';
  const code = run(argv, {
    stdout: { write: (s) => (stdout += s) },
    stderr: { write: (s) => (stderr += s) },
    cwd: join(r.root, cwd),
    env: {},
  });
  return { code, stdout, stderr, json: stdout.startsWith('{') ? JSON.parse(stdout) : null };
}

const files = (findings) => [...new Set(findings.map((f) => f.file))];

describe('vendored instruction files', () => {
  const repo = {
    'package.json': PKG,
    'AGENTS.md': OWN,
    'packages/a/AGENTS.md': OWN,
    '.agent/skills/react-best-practices/AGENTS.md': VENDORED,
    '.claude/skills/pdf/CLAUDE.md': VENDORED,
    'vendor/lib/AGENTS.md': VENDORED,
    'src/third_party/x/codex.md': VENDORED,
  };

  test('fires: the same long, contradictory file outside a vendor directory is checked', () => {
    const { json } = cli(['--format', 'json'], { ...repo, 'docs/AGENTS.md': VENDORED });
    assert.deepEqual(files(json.findings), ['docs/AGENTS.md']);
    const ids = json.findings.map((f) => f.ruleId);
    assert.ok(ids.includes('AMC007') && ids.includes('AMC003'), ids.join(','));
  });

  test('stays silent: vendored files are not parsed and produce no findings or handoff items', () => {
    const json = cli(['--format', 'json', '--strict'], repo);
    assert.equal(json.code, 0);
    assert.deepEqual(json.json.files, ['AGENTS.md', 'packages/a/AGENTS.md']);
    assert.deepEqual(json.json.findings, []);
    assert.deepEqual(json.json.skipped.map((s) => s.file), [
      '.agent/skills/react-best-practices/AGENTS.md',
      '.claude/skills/pdf/CLAUDE.md',
      'src/third_party/x/codex.md',
      'vendor/lib/AGENTS.md',
    ]);
    assert.match(json.json.skipped[0].reason, /\.agent\/skills\//);

    const agent = JSON.parse(cli(['--format', 'agent'], repo).stdout);
    assert.deepEqual(agent.skipped, json.json.skipped);
    assert.ok(agent.items.every((i) => !i.file.includes('skills') && !i.file.includes('vendor')));
  });

  test('tracked by git: still skipped', { skip: !hasGit && 'git not installed' }, () => {
    const { json } = cli(['--format', 'json'], repo, { git: true });
    assert.deepEqual(json.files, ['AGENTS.md', 'packages/a/AGENTS.md']);
    assert.equal(json.skipped.length, 4);
  });

  test('an explicit path or directory into a vendor directory is skipped too, and listed', () => {
    const one = cli(['.agent/skills/react-best-practices/AGENTS.md', '--format', 'json'], repo).json;
    assert.deepEqual(one.files, []);
    assert.deepEqual(one.findings, []);
    assert.deepEqual(one.skipped.map((s) => s.file), ['.agent/skills/react-best-practices/AGENTS.md']);
    const dir = cli(['.agent', '--format', 'json'], repo).json;
    assert.equal(dir.skipped.length, 1);
  });

  test('the pretty report says how many files were skipped', () => {
    const { stdout } = cli([], repo);
    assert.match(stdout, /Skipped 4 vendored or ignored files/);
    assert.match(stdout, /2 files checked, no problems found/);
    assert.match(cli(['vendor'], repo).stdout, /No instruction files to check\./);
  });

  test('a name that only looks like a vendor directory is still checked', () => {
    const { json } = cli(['--format', 'json'], { 'AGENTS.md': OWN, 'vendors/AGENTS.md': OWN, 'my-vendor/AGENTS.md': OWN, '.agent/AGENTS.md': OWN });
    assert.deepEqual(json.files, ['.agent/AGENTS.md', 'AGENTS.md', 'my-vendor/AGENTS.md', 'vendors/AGENTS.md']);
    assert.deepEqual(json.skipped, []);
  });
});

describe('"ignore" in .agentmdcaregiver.json', () => {
  const repo = (ignore) => ({
    'package.json': PKG,
    'AGENTS.md': OWN,
    'packages/a/AGENTS.md': OWN,
    'tools/skills/x/AGENTS.md': VENDORED,
    'tools/skills/y/CLAUDE.md': VENDORED,
    'examples/demo/AGENTS.md': VENDORED,
    '.agentmdcaregiver.json': JSON.stringify({ ignore }),
  });

  test('fires: without the pattern the files are checked', () => {
    const { json } = cli(['--format', 'json'], { ...repo([]) });
    assert.ok(files(json.findings).includes('tools/skills/x/AGENTS.md'));
  });

  test('stays silent: globs, directory names and exact files exclude what they match', () => {
    const { json, code } = cli(['--format', 'json', '--strict'], repo(['tools/skills/**', 'examples/demo/']));
    assert.equal(code, 0);
    assert.deepEqual(json.files, ['AGENTS.md', 'packages/a/AGENTS.md']);
    assert.deepEqual(json.skipped, [
      { file: 'examples/demo/AGENTS.md', reason: 'ignore pattern "examples/demo/" in .agentmdcaregiver.json' },
      { file: 'tools/skills/x/AGENTS.md', reason: 'ignore pattern "tools/skills/**" in .agentmdcaregiver.json' },
      { file: 'tools/skills/y/CLAUDE.md', reason: 'ignore pattern "tools/skills/**" in .agentmdcaregiver.json' },
    ]);
    const exact = cli(['--format', 'json'], repo(['tools', 'examples/*/AGENTS.md'])).json;
    assert.deepEqual(exact.files, ['AGENTS.md', 'packages/a/AGENTS.md']);
    const anyDepth = cli(['--format', 'json'], repo(['**/CLAUDE.md', 'tools/skills/x', 'examples'])).json;
    assert.deepEqual(anyDepth.skipped.map((s) => s.file), ['examples/demo/AGENTS.md', 'tools/skills/x/AGENTS.md', 'tools/skills/y/CLAUDE.md']);
  });

  test('patterns are anchored at the repo root', () => {
    // "skills" does not match tools/skills/..., so it matches nothing and is reported as stale.
    const r = cli(['--format', 'json'], repo(['skills', 'examples']));
    assert.equal(r.code, 2);
    assert.match(r.stderr, /"ignore" entry "skills" match/);
  });

  test('a pattern that matches no instruction file is an error (exit 2)', () => {
    const r = cli(['--format', 'json'], repo(['tools/skills/**', 'tools/old-skill/**', 'nope.md']));
    assert.equal(r.code, 2);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /\.agentmdcaregiver\.json: "ignore" entries "tools\/old-skill\/\*\*", "nope\.md" match no instruction file/);
  });

  test('a pattern that only matches a vendored file is not stale', () => {
    assert.equal(cli([], { 'AGENTS.md': OWN, 'vendor/x/AGENTS.md': VENDORED, '.agentmdcaregiver.json': '{"ignore": ["vendor/x"]}' }).code, 0);
  });

  test('broken entries are a usage error (exit 2)', () => {
    const cases = [
      ['"tools"', /"ignore" must be an array/],
      ['[3]', /entry 3 must be a string/],
      ['[""]', /must not be empty/],
      ['["!tools/**"]', /negation/],
      ['["/tools/**"]', /relative to the repo root/],
      ['["../x/**"]', /must not contain "\.\."/],
      ['["tools/[z-a]"]', /not a valid glob/],
      [JSON.stringify(['x'.repeat(2000)]), /longer than 1024/],
    ];
    for (const [ignore, re] of cases) {
      const r = cli([], { 'AGENTS.md': OWN, '.agentmdcaregiver.json': `{"ignore": ${ignore}}` });
      assert.equal(r.code, 2, ignore);
      assert.match(r.stderr, re, ignore);
    }
  });
});

describe('ignore helpers', () => {
  test('default list covers the directories from the issue', () => {
    for (const d of ['.agent/skills/', '.claude/skills/', '.cursor/', '.codex/', 'vendor/', 'third_party/', 'node_modules/']) {
      assert.ok(DEFAULT_IGNORES.includes(d), d);
    }
  });

  test('applyIgnores keeps order and gives the first matching reason', () => {
    const out = applyIgnores(['AGENTS.md', 'vendor/AGENTS.md', 'x/AGENTS.md'], ['x']);
    assert.deepEqual(out.files, ['AGENTS.md']);
    assert.deepEqual(out.skipped.map((s) => s.file), ['vendor/AGENTS.md', 'x/AGENTS.md']);
  });

  test('staleIgnores and invalidIgnorePattern', () => {
    assert.deepEqual(staleIgnores(['a/AGENTS.md'], ['a', 'b/**']), ['b/**']);
    assert.equal(invalidIgnorePattern('a/**'), null);
    assert.equal(invalidIgnorePattern(null), 'must be a string');
  });
});
